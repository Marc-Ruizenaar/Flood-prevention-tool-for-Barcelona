# API contract v0.2 (FROZEN)

Owner: Agent 5. Updated: 2026-10-09 (Europe/Madrid). Review: `docs/reviews/contract_v0.2_review.md`
(Agent 4, R1–R8 applied). Machine-readable spec: `openapi_v0.2.json`.
Models are imported from `bcnflood.schemas.contract_v02` (Agent 4): `DailySummaryV02`,
`CellOutputV02`, `GateStatus`, `GateReport`. The API keeps no duplicates. The API-local models are
`TimeseriesV02` and `TimeseriesPointV02` (`api/contract.py`).
Run the server and see examples in `docs/api/server.md`. Streets schema: `docs/api.md`.

## Rules
1. Every numeric output is a `Quantity` = `{value: float|null, unit: str, kind: ValueKind}`.
   `kind` is one of measurement / estimate / assumption / simulated / observed_outcome.
2. No invented values. A missing value is `null`. Row status INCOMPLETE/NOT_RUN means all values
   are null; SIMULATED means all values are present (enforced by the schema).
3. Errors use `ErrorBody` `{error, detail, status_code}`: `not_found` 404, `not_available` 409,
   `not_implemented` 501.
4. Daily outputs are keyed by local day (Europe/Madrid). `window_utc` is the UTC window [start, end):
   23 h or 25 h on DST days (via `bcnflood.data.timewindows`).
5. **Gating** (`docs/release_gates.json`, maintained only by Agent 4):
   - Non-synthetic (Barcelona) run data: **409** while any gate G1–G8 is not PASSED. Once all gates
     pass, the data is served (no 501).
   - SYNTHETIC runs (`synthetic: true` in run meta) are always served and labelled `synthetic: true`.
   - `POST /runs`: 409 while gates are closed, then 501 (runs are produced offline into the run store).

## Run store
**Primary layout (run_grid).** Agent 2's launcher writes `<out>/<scenario>/` containing
`outputs.npz` (max depth, max_speed_m_s, time above 0.10/0.30 m, per-day `day{i}_*`, hourly
`snap_*`), `summary.json` (mass balance incl. clip_m3, daily budgets, snapshot_ledger_columns) and
`inputs.pkl`. `runstore.register_launch_run(run_id, scenario_dir, x0_m=, y0_m=, synthetic=,
drainage_scenarios=)` writes `<store>/<run_id>/meta.json` pointing at that dir. Cell size and CRS
are read from `inputs.pkl`, never hardcoded (for example 30 m). Only the upper-left corner has to be
given. Daily budgets, including clip, come from `summary.json`. All cumulative ledger columns are
kept. `max_velocity` = per-day `max_speed_m_s` in m/s, null where max depth < 0.01 m.

**Legacy layout:**
`$BCNFLOOD_RUNS` (default `outputs/runs/`, gitignored) holds `<run_id>/meta.json` and
`snapshots.npz` (t [s], storage [m3], cumulative ledger [m3], max_depth [m], h [m] per snapshot),
written by `bcnflood.api.runstore.save_run` from solver `Snapshot`s. The expected id of the real
3–7 Oct run is `bcn-2026-10-03_07`.

## Endpoints
| Method | Path | Response |
|---|---|---|
| GET | /health, /datasets | unchanged (M1) |
| GET | /gates | `GateReport` (read-only; POST/PUT return 405) |
| POST | /runs | 409 (gates closed), then 501 |
| GET | /runs | list of stored runs |
| GET | /runs/{id} | run metadata, or 404 |
| GET | /runs/{id}/daily, /daily?run_id= | `list[DailySummaryV02]` |
| GET | /runs/{id}/cells?date=, /cells?run_id=&date=&threshold_m=0.10&min_depth_m=0.01 | `list[CellOutputV02]` |
| GET | /runs/{id}/timeseries?row=&col=, /timeseries?run_id=&row=&col= | `TimeseriesV02` |
| GET | /runs/{id}/export/geojson?date= | GeoJSON FeatureCollection (cell polygons in WGS84) |
| GET | /runs/{id}/export/geotiff?date= | float32 GeoTIFF of daily max depth [m] in the run CRS |
| GET | /simulations/{id}/streets?date= | street GeoJSON (M2-A5-04, see `docs/api.md`) |
| GET/POST | /simulations/{id}/mitigation | per-day street deltas vs baseline via solver.mitigation (M2-A5-05). Non-synthetic runs return 501 until the domain is stored |
| | /simulations/... | aliases of /runs/... |

`run_id` defaults to `bcn-2026-10-03_07`. With gates open and no such run stored, `/daily` returns
NOT_RUN rows for 2–7 Oct (R8). Legacy M1 `/days/*` and `/exports/{fmt}` are unchanged.

## DailySummaryV02
| Field | Type | Unit | Kind |
|---|---|---|---|
| contract_version | "0.2.0" | — | — |
| run_id, timezone | str | — | — |
| date_local | date | — | — |
| window_utc | [datetime, datetime) UTC | — | — |
| rainfall_volume, infiltration_volume, boundary_outflow_volume, storage_start, storage_end | Quantity | m3 | simulated |
| drainage_volume | Quantity | m3 | **assumption** (ASSUMPTION drainage scenario; capacity in `warnings`) |
| mass_balance_error_rel | Quantity | 1 | simulated |
| max_depth | Quantity | m | simulated |
| data_completeness | Quantity, 0..1 | 1 | **assumption** (placeholder 1.0 plus `DATA_COMPLETENESS_PROVISIONAL_WARNING` in warnings) |
| status | SIMULATED / INCOMPLETE / NOT_RUN | — | — |
| synthetic | bool | — | — |
| warnings | list[str] | — | — |

Mapping: solver SIMULATED becomes SIMULATED (values copied verbatim). Any other solver state becomes
INCOMPLETE (all null). No run executed gives NOT_RUN (all null).

## CellOutputV02
| Field | Type | Unit | Kind |
|---|---|---|---|
| cell_id | str `r{row}c{col}` | — | — |
| x, y | Quantity (cell centre) | m | simulated (grid geometry), CRS in `crs` |
| crs | str | — | — |
| date_local | date | — | — |
| max_depth | Quantity | m | simulated |
| max_velocity | Quantity: run_grid `max_speed_m_s` (null where depth < 0.01 m or for legacy runs) | m/s | simulated |
| time_of_max_utc | datetime or null | — | — |
| duration_above_threshold | Quantity: step-exact time above `threshold` (run_grid supports 0.10 and 0.30 m; others return 409) | s | simulated |
| threshold | Quantity | m | assumption |
| uncertainty, provenance_run_id | str | — | — |

## TimeseriesV02
`run_id, cell_id, x, y (Quantity m, simulated), crs, synthetic, warnings`, and
`points[] = {time_utc, depth: Quantity m simulated, domain_storage: Quantity m3 simulated}`.

## GateReport
`source, source_found, all_passed` (true only when the file is found and all 8 gates are PASSED), and
`gates[] = {id G1..G8, name, status PASSED|FAILED|PENDING|UNKNOWN, evidence}`. A missing file, missing
gate, or unrecognised or lowercase status is reported as UNKNOWN.
