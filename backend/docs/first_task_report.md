# Barcelona Flood Physics Engine — First-Task Report (Milestone 1)

Generated 2026-10-09 (Europe/Madrid). All probes run from the build box; raw responses are in `docs/probes/`, summary in `docs/probes/results.txt`.

## 1. Architecture and folder structure

```
bcn-flood/
  pyproject.toml            # deps, ruff, pytest config
  manifests/datasets.json   # dataset inventory (Agent 1) - source for GET /datasets
  src/bcnflood/
    schemas/                # shared Pydantic schemas (Agent 4 gatekeeps changes)
    data/                   # adapters, validation, preprocessing (Agent 1) - empty in M1
    solver/                 # NumPy physics, no API/IO imports (Agent 2)
      local_inertial.py     # solver, Green-Ampt, drainage sink, outlet, mass ledger
      daily.py              # daily aggregation over a continuous run
    api/main.py             # FastAPI (Agent 5)
  tests/                    # scientific + API tests (Agent 3 owns test_solver.py)
  docs/                     # this report, probe evidence
  evaluation/ (future)      # isolated observed-flood evaluation data; never imported by src/
```
Data flows one way: adapters -> validated rasters/vectors (EPSG:25831, metres) -> SimulationConfig -> solver -> run store -> API. The solver never imports the API or the evaluation folder.

## 2. Datasets and actual availability (probed 2026-10-09 ~22:55–23:05 CEST)

| Dataset | Probe | HTTP | Status | Data for 3–7 Oct 2026? |
|---|---|---|---|---|
| Meteocat XEMA API `api.meteo.cat/xema/v1` | metadades, mesurades/35 | 403 `Forbidden` (no key) | MISSING (needs API key) | not verifiable |
| XEMA open data (Socrata `nzvn-apee`, var 35 precip, 30 min) | aggregate query | 429 at first (rate limit), then 200 | CONDITIONAL | **Yes.** X4 Raval 240/240 records, 265.0 mm; X8 Zona Universitària 240/240, 228.3 mm; D5 Fabra 236/240, 203.6 mm; WU Badalona 240/240, 228.9 mm |
| XEMA station metadata (`yqwd-vj5e`) | | 200 | CONDITIONAL | X4, D5, X8 operational; X2 Zoo and AN Lluís Companys dismantled |
| Meteocat radar QPE | not found publicly | – | MISSING | – |
| ICGC DEM/LiDAR | 3 geoserveis/www URLs | 404, 404, 404; datacloud timeout | PENDING (correct endpoint not found) | static |
| IGN MDT WCS (fallback DEM) | GetCapabilities | 200 | PENDING (resolution over BCN not checked) | static |
| Catastro INSPIRE buildings WFS | GetCapabilities | 400, then timeout | PENDING | static |
| CORINE CLC2018 | MapServer f=json | 200 | CONDITIONAL (100 m, too coarse for urban) | static |
| SIOSE (IDEE WMS) | GetCapabilities | 200 | PENDING (WMS only gives images; vectors needed) | static |
| SoilGrids v2 | point query sand 0–5 cm | 200 | CONDITIONAL (250 m global) | static |
| Barcelona Open Data CKAN (sewer, roads) | package_search | timeout x3 (homepage 302) | PENDING | – |
| Drainage capacities (BCASA) | no public source found | – | MISSING | – |
| AEMET OpenData | daily climatology | 200 empty body (no key) | MISSING (needs key) | – |
| Roads (Barcelona/OSM) | not probed | – | not in manifest yet | – |

Daily totals from the open-data mirror (sum of 30-min values per calendar day of the `data_lectura` timestamp, timezone **not yet verified**, assumed UTC):

| Station | 3 Oct | 4 Oct | 5 Oct | 6 Oct | 7 Oct |
|---|---|---|---|---|---|
| X4 Raval | 190.8 | 2.0 | 43.8 | 28.3 | 0.1 |
| X8 Zona Univ. | 170.3 | 3.6 | 28.1 | 26.0 | 0.3 |
| D5 Fabra | 104.3 (44/48 records) | 8.9 | 74.8 | 15.4 | 0.2 |

These are retrieved values (MEASUREMENT, provisional). Quality flags have not been checked yet. Units are assumed to be mm per 30 min and still need confirming against Meteocat variable metadata. They are **not** used by any model code yet.

## 3. Solver proposal: local-inertial (Bates et al. 2010; de Almeida et al. 2012)

Regular square grid with spacing Δx [m]. Cell depth h [m], bed z [m], surface η = z + h. Unit-width face discharge q [m² s⁻¹], Manning n [s m⁻¹ᐟ³], g = 9.81 m s⁻².

- Face flow depth: h_f = max(η_i, η_j) − max(z_i, z_j)
- Momentum (semi-implicit friction): q^{n+1} = (q^n − g h_f Δt ∂η/∂x) / (1 + g Δt n² |q^n| / h_f^{7/3})
- Continuity: h^{n+1} = h^n − Δt(∂q_x/∂x + ∂q_y/∂y) + Δt(r − f − d)
- CFL: Δt = α Δx / √(g h_max), with α = 0.7 by default and Δt ≤ Δt_max. Steps are clipped so the model lands exactly on output times and midnights.
- Infiltration: Green-Ampt, f_p = K_s(1 + ψΔθ/F) [m s⁻¹], limited by the water available. Cumulative F carries over between days.
- Drainage: a per-cell sink with capacity d_max [m s⁻¹]. This is a placeholder for a future 1D sewer coupling.
- Boundaries: closed by default. Outlet cells act as free-outfall sinks booked as boundary outflow.
- Positivity: outgoing fluxes are scaled so no cell loses more water than it holds. The scheme stays conservative.
- Mass ledger: ΔStorage = R − I − D − O, with relative error |ΔS − (R−I−D−O)| / max(R, S₀).

**Limitations:** The scheme drops the convective acceleration terms, so it is unsuitable for supercritical or Fr > ~0.5 steep flows, where it can oscillate (Bates 2010, de Almeida 2013). The friction formula is Manning. It has no sub-grid building porosity, no sewer surcharge, no inflow from culverts or the sea, and no momentum through buildings. Buildings will be represented as raised or blocked cells, which depends on resolution. Accuracy cannot be better than the DEM and rainfall inputs. A small output cell does not mean street-level accuracy.

## 4. Schemas (`src/bcnflood/schemas/__init__.py`)

`DatasetEntry` / `DatasetInventory` (statuses APPROVED/CONDITIONAL/REJECTED/MISSING/PENDING, probes with HTTP code + timestamp, CRS, vertical datum, resolution, warnings). `SimulationConfig` (EPSG:25831, dx, UTC window, output interval, α, Manning n, Green-Ampt params, drainage capacity, report timezone). `CellOutput` (Quantity = value + unit + kind ∈ measurement/estimate/assumption/simulated/observed_outcome). `DailySummary` (local date, UTC window, volume budget, mass-balance error, completeness, status SIMULATED/INCOMPLETE/NOT_RUN). `AgentReport` (the spec's 11 fields). `ErrorBody` {error, detail, status_code}.

## 5. Agents, ownership, and communication

The spec text I received had a gap in the Agent 3 and Agent 5 descriptions. I **assumed** Agent 3 = Scientific Validation/Audit and Agent 5 = API/Visualization.

| Agent | Owns | Must not |
|---|---|---|
| 1 Data & Geospatial | `src/bcnflood/data/`, `manifests/` | predict floods or use flood reports |
| 2 Hydrology & Maths | `src/bcnflood/solver/` | edit manifests or API |
| 3 Scientific Audit | `tests/test_solver.py`, audit reports | change solver to pass tests without a review |
| 4 Orchestrator | `schemas/`, release gate, merges | release while any gate fails |
| 5 API/Viz | `src/bcnflood/api/`, `tests/test_api.py` | compute physics or invent values |

Each agent hands off work as an `AgentReport` JSON with statuses NOT_STARTED / IN_PROGRESS / BLOCKED / REVIEW_REQUIRED / PASSED / FAILED. Any schema change goes through Agent 4.

## 6. Test plan and tolerances (implemented: 16 tests)

- Mass balance: relative error < **1e-9**. The scheme is conservative by construction, so round-off is ~1e-15. Measured values: flat 3.8e-15, slope 6.7e-16, depression 4.7e-15, extreme 1.7e-16.
- Flat uniform rain: h = r·t, matching to rtol 1e-12 (20 mm after 1 h at 20 mm/h). Fluxes stay below 1e-12.
- Sloping plane: all qx ≥ 0, depth increases downslope, outflow > 0.
- Depression with an outlet: the water surface settles to the sill level, 0.5 m, within ±0.02 m. Measured 0.5007 m.
- Infiltration lowers outflow and storage. Impervious surfaces raise outflow and give zero infiltration. Drainage lowers the maximum depth.
- Obstacle: a full wall leaves the downstream side at exactly 0. A gap lets flow through.
- No negative depth under steep, low-friction, intense rain.
- Bit-identical reruns. Rainfall sensitivity is monotonic.
- 2-day run with a storm across midnight: a restart from the midnight state matches the continuous run exactly at midnight, and matches the end state within 1e-12. Daily rain and outflow sum to the run totals (rel 1e-12). Day-1 end storage equals day-2 start storage. Each day's mass-balance error is < 1e-9.
- API: /health, /datasets validates against the schema, filters work, stubs return 404/409/501.
- Planned for later: grid-resolution and time-step convergence, comparison with an analytic Thacker or kinematic-wave solution, and a benchmark against EA 2D benchmark test 8A once there is a reference.

## 7. Assumptions and missing information

- XEMA open-data timestamps are assumed UTC (not verified). Units are assumed to be mm per 30 min. Quality flags have not been inspected.
- No API keys exist for Meteocat or AEMET.
- No DEM endpoint is verified for ICGC. The IGN fallback has not been evaluated.
- Drainage capacity is MISSING. Any drainage run will be a labelled ASSUMPTION scenario.
- Soil data is coarse (250 m). Green-Ampt parameters will be pedotransfer ESTIMATES.
- Barcelona Open Data and Catastro were unreachable from the box (timeouts). They need a retry, or another network path.
- No Barcelona simulation has been run, and the release gate is CLOSED.
- All test rainfall and terrain is synthetic.
