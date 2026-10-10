# Gate audit G1–G6 (Agent 3), 2026-10-09 ~23:40 CEST

Repo HEAD at audit time: 48ec2a2 plus uncommitted work by other agents (listed where relevant). No Barcelona run was made. Verdicts are PASS / CONDITIONAL / FAIL.

| Gate | Verdict | Summary |
|---|---|---|
| G1 Rainfall | **FAIL** | XEMA open data is still CONDITIONAL. TZ, units and QC are not verified, and the licence is "SEE_TERMS_OF_USE" |
| G2 Terrain | **FAIL** | no DEM file exists in the repo or on the box. MDT05 is not in the manifest |
| G3 Surface params | **FAIL** | no OSM, Catastro or SIOSE file exists. Catastro and SIOSE are PENDING. No Manning or Green-Ampt tables in `config/` (empty) |
| G4 Drainage | **FAIL** | drainage_capacity MISSING. No ASSUMPTION sweep spec in `config/`. No Marc sign-off |
| G5 Time | **CONDITIONAL** | `data/timewindows.py` is correct and passes the DST tests. It is uncommitted, and the solver/daily path still takes model seconds |
| G6 Numerics | **FAIL** | defect D1 (default α unstable), D2, and the convergence-order criterion is not met |

## G1 Rainfall — FAIL
- Evidence: `manifests/datasets.json` (`xema_opendata_precip`: CONDITIONAL; warnings "Timestamp timezone assumed UTC – NOT yet verified" and "codi_estat not yet inspected"). The new file `manifests/raw/g1/nzvn-apee_metadata.json` is uncommitted.
- Provenance: Socrata nzvn-apee, `provenance: official`, attributed to Departament de Territori. The licence field is `SEE_TERMS_OF_USE`, and the description says "Propietat intel·lectual i industrial de METEOCAT" (meteo.cat avís legal). **The terms of reuse are not recorded in the manifest.** Licence: unresolved.
- `src/bcnflood/data/xema_opendata.py` appeared and then disappeared during the audit. No adapter was available to audit.
- The M1 daily totals (`first_task_report.md` §2) are UTC calendar days, not Madrid days. They must be recomputed with `timewindows`.
- To pass: confirm TZ and units from the variables metadata (4fb2-n3yi) or the API key, map QC, record the licence, and set APPROVED.

## G2 Terrain — FAIL
- Neither `find / -iname '*mdt05*'` nor any .tif under bcn turned up a file. The manifest has `icgc_dem` and `ign_mdt` both PENDING. MDT05 has no entry, and CRS, vertical datum, resolution and licence are not recorded.
- Probes: `docs/probes/icgc_*.out` (404s) and `ign_mdt.out` (GetCapabilities only).
- To pass: commit or store the clipped raster with a checksum, EPSG:25831, the datum (REDNAP/EGM08), 5 m resolution and the licence (IGN CC-BY 4.0, to be verified). Then A3 checks the range (0–~512 m) and NoData.

## G3 Surface parameters — FAIL
- OSM has no manifest entry and no file (licence ODbL would need attribution/share-alike noted). Catastro is PENDING with timeouts. SIOSE is PENDING (WMS only). CORINE is 100 m and SoilGrids 250 m (CONDITIONAL).
- `config/` is empty: no Manning or Green-Ampt tables labelled ESTIMATE.

## G4 Drainage — FAIL
- `drainage_capacity` is MISSING and `bcn_opendata_sewer` PENDING. `config/` has no ASSUMPTION capacity sweep.
- Solver side: drainage is a uniform per-cell sink (`local_inertial.py:46,142-146`). It is limited by available water and booked in the ledger, which is correct as accounting. It has no network, surcharge or inlet capacity. Any run must be labelled ASSUMPTION.
- Required: the sweep spec (e.g. 0/10/20/30 mm/h) and Marc's sign-off.

## G5 Time — CONDITIONAL
- `src/bcnflood/data/timewindows.py` (uncommitted, Agent 1): zoneinfo based, half-open windows, naive datetimes rejected. Verified: 3 Oct = 2 Oct 22:00Z → 3 Oct 22:00Z. 29 Mar 2026 is 23 h (46 half-hours). 25 Oct 2026 is 25 h (50).
- Tests: `tests/test_timewindows.py` 11/11 pass, including a check that fails a UTC-assumed implementation.
- Open: (a) the module must be committed. (b) `solver/daily.py:8` takes `day_edges` in model seconds, and nothing yet converts a local-day window to model seconds end to end. (c) The XEMA source TZ is unverified (G1). (d) `aggregate_by_local_day` completeness flags are not yet tested by A3.

## G6 Numerics — FAIL
Benchmark audit: `docs/audit/m2_synthetic_benchmark_audit.md` (FAILED: D1 critical, D2).
Sensitivity study (`tests/test_convergence.py`, harness `solver/convergence.py` + `solver/reference_cases.py`):

| Study | Result |
|---|---|
| KP grid 50/25/12.5/6.25 m, α=0.35 | rel L1 0.040, 0.022, 0.025, 0.0083 → orders 0.87, −0.20, 1.60 (**non-monotone, FAIL ≥0.8**). Peak depth change between finest two 3.4 % (PASS <5 %). Peak outflow 0.1 % (PASS) |
| KP grid, default α=0.7 | dx 12.5 diverges: peak 0.0877 vs 0.047 m, Fr 7.9 (**FAIL**, D1) |
| KP α 0.35→0.175 at 12.5 m | peak change 1.7 % (PASS) |
| KP fixed dt 4/2/1 s | peak change 5e-6 (PASS) |
| Thacker bowl, α=0.35 | L1 0.0137, 0.0120, 0.0115 → orders 0.19, 0.06 (**FAIL**). Max Fr 0.34→0.82 at the shoreline |
| Mass balance, all levels | ≤ 1e-14 (PASS, but not evidence of correctness) |

To pass: fix D1 and D2. Agree with A2/A4 on an error metric that excludes the KW model-form floor, or accept the order criterion on the shoreline-free region only. Re-run.

## Paths written by A3
`tests/test_audit_m2.py`, `tests/test_convergence.py`, `tests/test_timewindows.py`, `docs/audit/m2_synthetic_benchmark_audit.md`, `docs/audit/m2_data_audit.md`, `docs/audit/gates_report.md`.

## Update 2026-10-09 ~23:25 CEST (scope 2–7 Oct)
- **G6 re-check:** `src/bcnflood/solver/local_inertial.py` is unchanged since 3b3fbe5 (`git log -- src/bcnflood/solver/local_inertial.py`). **D1/D2 are not fixed.** G6 stays **FAIL** and was not re-run.
- **G5:** `tests/test_timewindows.py` now covers 2 Oct (1 Oct 22:00Z → 2 Oct 22:00Z) and the contiguous 2–7 Oct range (6 windows, 1 Oct 22:00Z → 7 Oct 22:00Z). 12/12 pass. Finding for A5: `src/bcnflood/api/main.py:18` `VALID_DAYS` still lists only 3–7 Oct.
- **M2-A3-05 (mitigation audit): BLOCKED.** No mitigation/tank module exists in `src/` (grep for mitigation|tank finds nothing).
- **M2-A3-06 (/streets audit): BLOCKED.** `src/bcnflood/api/main.py:120-123` returns 501 "not implemented". No flood_class, p95, minutes-above or geometry code exists to audit.
- Status changes since the first report (from git log, not yet re-audited): drainage ASSUMPTION scenarios were committed (f2640b3), the XEMA adapter recreated (4d106f5), and the G1 raw downloads committed (76456b1). G2/G3 raw files are uncommitted (`manifests/raw/g2`, `g3`, `data/dem.py`). G1–G4 verdicts are unchanged until re-audited.

## Re-audit G1–G4, 2026-10-09 ~23:35 CEST (HEAD 4d106f5 + working tree)
Verdicts **supersede** the G1–G4 rows above. All checks were run independently by A3 on the stored files. No network access, no Barcelona run.

| Gate | Verdict | Was |
|---|---|---|
| G1 Rainfall | **CONDITIONAL** | FAIL |
| G2 Terrain | **CONDITIONAL** (uncommitted) | FAIL |
| G3 Surface params | **FAIL** | FAIL |
| G4 Drainage | **CONDITIONAL** (needs Marc sign-off) | FAIL |

### G1: CONDITIONAL
Verified:
- TZ = UTC, interval-start label. Source: column `data_lectura` in `manifests/raw/g1/nzvn-apee_metadata.json`, "Data i Hora Inicial … Temps Universal".
- Units: var 35 = Precipitació, `unitat: mm`, 1 decimal (`variables_4fb2-n3yi.json`).
- QC: `codi_estat` semantics match `src/bcnflood/data/xema_opendata.py:6,40-49`.
- Provenance and sha256: `manifests/raw/g1/provenance.json`.

Independent Madrid-day totals (mm, `zoneinfo`, from the raw files):

| Station | 2 Oct* | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|
| X4 | 15.5 | 143.4 | 49.4 | 43.8 | 28.3 | 0.1 |
| X8 | 15.6 | 123.8 | 50.1 | 28.1 | 26.0 | 0.3 |
| D5 | 15.8 | 80.1 (47/48) | 33.1 (45/48) | 74.8 | 15.4 | 0.2 |
| WU | 5.2 | 95.2 | 62.3 | 55.6 | 15.7 | 0.1 |

\*Records per day: 2 Oct has 44/48 at every station; 3–7 Oct have 48/48 except where shown for D5.

Conditions:
1. **2 Oct is incomplete (44/48 at every station).** The raw pull starts 2026-10-02T00:00Z, so the 1 Oct 22:00–24:00Z half-hours (local 2 Oct 00:00–02:00) are missing. Re-fetch from 2026-10-01T22:00Z for the new 2–7 Oct scope.
2. **3–7 Oct data is unvalidated** (`codi_estat` blank: 235–240 records per station; only 2 Oct is `V`). It must carry a provisional label, or be re-pulled after validation.
3. The M1 UTC-day totals in `docs/first_task_report.md` §2 are wrong as local days (X4 3 Oct 190.8 UTC-day vs 143.4 Madrid-day) and must not be reused.
4. Licence: the manifest records "Meteocat intellectual property (meteo.cat avís legal)". This is not an open licence. The reuse terms and attribution text must be confirmed for any public release.
5. Status in the manifest is still CONDITIONAL. G1 needs it to be APPROVED.

### G2: CONDITIONAL
Verified: `manifests/raw/g2/bcn_mdt05_25831.tif` sha256 0daa368c…086c matches the manifest. It reads as EPSG:25831, 5.0 m, 3352×2939, float32, NoData -9999, bounds 420820–435515 E / 4574275–4591035 N, elevation −7.0 to 517.49 m. The licence is recorded as CC BY 4.0 © IGN.

Conditions:
1. **Uncommitted**: `manifests/raw/g2/`, `src/bcnflood/data/dem.py`.
2. The source is int16, so heights are quantised to 1 m. That is not adequate for street-scale ponding (cm depths). Results are conditional on this, and an upgrade to ICGC MET2 is needed.
3. CRS label mismatch: `dem_build_report.json` says `source_crs: EPSG:4326`, but the manifest says ETRS89 (EPSG:4258). The difference is sub-metre, but A1 should correct the record.
4. The vertical datum (REDNAP) is taken from the product spec, not from the file. This is acceptable as documented.
5. Max 517.5 m vs Tibidabo 512 m (+5.5 m) and 124 cells below 0 m (port docks) are flagged but not explained.
6. Boundary from OSM Nominatim (ODbL): attribution must be recorded.

### G3: FAIL
- `manifests/raw/g3/osm_buildings_raw.json` and `osm_highways_raw.json` are 371-byte **HTTP 406 error pages from overpass-api.de**, not data.
- `catastro_probes.log`: GetCapabilities status 000 (timeout), and GetFeature returned 400.
- There is no OSM manifest entry or ODbL note. Catastro and SIOSE are PENDING. `config/` has no Manning or Green-Ampt tables.

### G4: CONDITIONAL
`config/drainage_scenarios.json` (f2640b3) gives 0/10/20/30 mm/h. Every entry has `kind/status: ASSUMPTION`, the rationale says there is no primary data and no external citation, and it states `requires_signoff: Marc`. It is applied as a uniform per-cell sink (`src/bcnflood/solver/drainage.py`; ledger booking in `local_inertial.py:142-146` is correct). The manifest's `drainage_capacity` is still MISSING (correct, not mislabelled).

Condition: **Marc's sign-off is not recorded anywhere.** Note also that a uniform sink has no inlet or pipe capacity and no surcharge, so results show sensitivity only.

G5: still CONDITIONAL (the 2 Oct completeness gap above also affects it). G6: still FAIL (D1/D2 not fixed).

## Re-audit G1–G6, 2026-10-09 ~23:50 CEST (HEAD e95fd7d)
**Supersedes all earlier verdicts.** All checks were run independently by A3 (scripts on stored files, solver unit probes). No Barcelona run.

| Gate | Verdict |
|---|---|
| G1 Rainfall | **CONDITIONAL** |
| G2 Terrain | **CONDITIONAL** |
| G3 Surface params | **CONDITIONAL** (was FAIL) |
| G4 Drainage | **CONDITIONAL** (Marc sign-off) |
| G5 Time | **CONDITIONAL** (minor) |
| G6 Numerics | **CONDITIONAL** (was FAIL) |

### G6: D1–D5 verified independently (565c242)
- **D1** fixed via defaults only (`local_inertial.py` `DEFAULT_ALPHA=0.35`, `DEFAULT_DT_MAX=2.0`). KW plane h/h_KW at dx 10/5 m with defaults is within 5 %.
  - **Residual:** nothing guards against unstable settings. Passing α=0.7 and dt_max=10 s still silently gives 0.40×KW (strict-xfail `test_kinematic_plane_old_settings_rejected_or_stable`). Request: a warning/guard, or a Fr/oscillation detector.
- **D2** fixed when breakpoints are declared: with `piecewise_rain` or `breakpoints=`, the rain volume error is −2e-14. **Residual:** a plain callable is still sampled at the start of each step. The error is +0.055 % (bounded by rate·dt_max, tested). Barcelona forcing must use `piecewise_rain`.
- **D3:** `ledger.clip` is booked as a source in `mass_balance_error`. The clip was 0.0 even on the 20 % slope (Fr ~8) case.
- **D4:** F0 = 0, so the capacity is infinite at F=0. Green-Ampt vs Mein-Larson still passes without the old 1e-6 offset.
- **D5:** two-cell probe. The face flux equals the hand-computed value with n_f = √(mean n²) exactly (0.0694307…).
- **daily.py:** `local_day_edges` gives 24/25/24 h for 24–26 Oct, and 6×86400 s for 2–7 Oct from t0 = 2026-10-01T22Z.

**Agent 2's claims:**
- *Planar order ~0.8 is limited by the analytic kink*: **not supported.** Grid 50→6.25 m, all cells: orders 0.87, 0.84, 0.82. Excluding a ±100 m band around the kink: 0.84, 0.86, 0.83. Only x < x_kink−150 m, far from the kink: 0.84, 0.85, 0.80. Self-convergence (restricted successive differences): 0.88, 0.90. The ~0.85 order is intrinsic (scheme/boundaries/model form), not caused by the kink. It meets the pre-stated ≥0.8 but not the plan's "≥ ~1".
- *Thacker is not exact for local-inertial*: **agreed, justified.** In q-form, LI drops ∂(q²/h)/∂x = u² ∂h/∂x, which is ≠ 0 for uniform u. Evidence: the error is insensitive to dx (orders 0.19, 0.06, 0.01) and to α (0.35→0.0875: 0.01143→0.01134 m), and it scales with Fr. **It is reclassified as a Froude-limit test** with explicit acceptance criteria (`tests/test_convergence.py::test_thacker_froude_limit`): L1 must fall monotonically as Fr_bulk 0.23→0.028, the last two halvings must each give ≥2.8×, L1 < 1e-3 m at Fr 0.028, and MB < 1e-9. Observed: 0.0115, 0.00508, 0.00150, 0.000472 m. PASS.

**Previously invalid or weak M1 tests are now fixed by A3** (`tests/test_solver.py`):
- sloping plane: compared against KW h within 10 %.
- sill: one-sided [0.5, 0.502).
- extreme: asserts `ledger.clip ≤ 1e-12·R` instead of the tautological h ≥ 0.
- rainfall sensitivity: uses 100/300/400 mm so the bowl actually spills, and tests the bowl's share of outflow.
- midnight restart: now also compares f_cum.

Still weak but acceptable: infiltration/impervious/drainage (qualitative) and reproducible.

**Test run:** solver/audit/convergence/timewindow suites all pass, with 1 strict xfail (the D1 residual). Separately, `tests/test_api.py` has 3 failures from a pydantic ValidationError on a manifest entry (`osm_buildings_roads`, missing required field). That is a G7 issue for A5/A1, not G6.

**G6 CONDITIONAL:** convergence passes the stated tolerances (peak-depth change between the finest two levels 3.4 %, α 1.7 %, fixed dt 5e-6, MB ≤ 5e-14, KP order ≥ 0.82, Thacker Froude-limit criteria met). Conditions:
1. A guard or warning for unstable α/dt_max.
2. `piecewise_rain` mandatory for real forcing.
3. A4 must accept order ~0.85 in place of the plan's "~1".

### G1: CONDITIONAL
- Earlier condition **met**: the 2 Oct re-fetch from 2026-10-01T22:00Z (645bae2). My Madrid-day counts give 48/48 on 2 Oct for every station.
- Totals are unchanged on 3–7 Oct: X4 143.4/49.4/43.8/28.3/0.1 mm.
- The D5 gap is kept MISSING (3 Oct 47/48, 4 Oct 45/48), matching `manifests/g1_xema_evidence.md:24`. The UTC-day totals have been dropped.
- Still open:
  - 3–7 Oct is **unvalidated** (codi_estat blank on 43–48 records/day; only 2 Oct and 4 records on 3 Oct are V).
  - The licence is Meteocat IP, not open, and the reuse terms are unconfirmed.
  - The manifest status is still CONDITIONAL, not APPROVED.

### G2: CONDITIONAL
- Earlier conditions **met**:
  - Committed (44fc0d1): the tif, the build report and `data/dem.py`. Tiles are gitignored and recorded with sha256.
  - CRS record corrected (a3ff216): the source GeoTIFF declares EPSG:4326 and the coverage is named for 4258; the difference is under 1 m.
  - IGN CC BY and OSM ODbL attribution added.
  - The 517.5 m max is located at the Sagrat Cor footprint, and the 124 sub-zero cells at Zona Franca. Both are documented, with causes not verified.
- Remaining condition: **int16 means 1 m vertical quantisation**. This is not adequate for cm-scale ponding, and results must carry this caveat. The flagged cells must be reviewed before any run.

### G3: CONDITIONAL
- **OSM content is valid** (481db66/f7011e4):
  - 60 053 Polygon buildings and 84 323 LineString streets. EPSG:4326 coordinates are in lon/lat order: lon 2.055–2.227, lat 41.320–41.468, inside BCN.
  - Properties include osm_id/name/highway. A 25831 copy is present.
  - SHA256SUMS verify (from `manifests/raw/g3/`). The uncompressed highways sha matches `osm_build_report.json`. The raw `osm3s` timestamp is 2026-10-09T21:18Z, with ODbL copyright.
- **Tables** (62c3b7f): the values were checked against their sources.
  - `config/green_ampt_rawls1983.json` matches Rawls 1983 / Chow Table 4.3.1 (e.g. sand ψ 4.95 cm, Ks 11.78 cm/h; clay 31.63 / 0.03).
  - `config/manning_overland.json` matches TR-55 Table 3-1 (smooth 0.011, dense grass 0.24, Bermuda 0.41, woods 0.40/0.80).
  - Both are labelled ESTIMATE with citations.
- Conditions:
  1. Catastro is MISSING, so buildings are volunteered OSM data with completeness unchecked, and 10 307 elements were dropped.
  2. SIOSE is PENDING. There is no imperviousness/land-cover → n/GA mapping, so the mapping is an ASSUMPTION.
  3. TR-55 sheet-flow n applies only below ~3 cm. Street flow needs channel n (~0.013–0.016).
  4. Housekeeping: 52 MB uncompressed raw JSON copies are present in the working tree (gitignored). They are fine, but the committed .gz files are canonical.
  5. Footways are 50 200 of 84 323 street features. Filter by class before /streets aggregation.

### G4: CONDITIONAL
Unchanged. The sweep is fine. **Marc's sign-off is not recorded.**

### G5: CONDITIONAL (minor)
`data/timewindows.py` and `solver/daily.local_day_edges` are verified, including DST days and 2–7 Oct, and 2 Oct is now complete. Outstanding: A3 tests for `aggregate_by_local_day` completeness flags (D5 3–4 Oct must surface as INCOMPLETE).

## M2-A3-05 / A3-06 / G5 completeness / G7, 2026-10-10 ~00:05 CEST
Audited at **committed HEAD 0409558** (clean worktree). Agent 2 had uncommitted, mid-edit solver changes at the time (`local_inertial.py` raised `NameError: check_numerics`). Those changes are NOT audited. New tests:
- `tests/test_mitigation_audit.py` (4 pass, 1 strict xfail)
- `tests/test_streets_audit.py` (16 pass, 2 strict xfail)
- `tests/test_timewindows_completeness.py` (1 pass)

### M2-A3-05 Mitigation (dbef988) + campaign (281590a): CONDITIONAL
- **Mass conservation including storages: PASS.** Run with tank + green roof + drain + SUDS, 60 mm/h for 1 h: `mass_balance_error_mitigated` = 2e-14. The tank holds exactly its 5.0 m³ volume. Roof storage 9.41 m³ ≤ capacity 10.0 m³. Tank and roof are booked as separate ledger terms (`solver/mitigation.py:129-132`).
- **Labels: PASS.** `apply_static` (`mitigation.py:59-60`) rejects any lever not labelled `assumption`. Every default `source` is "no source: placeholder ASSUMPTION".
- **Baseline: PASS for physics.** `run_mitigated(levers=[])` is bit-identical to `run()` (same h, same step count 3600, same storage). The API (`api/mitigation.py:80-83`) runs baseline and scenarios through the same function, forcing, grid, and α/dt_max. The adaptive dt can differ between baseline and scenario. The tank's first-interval delta is −2.66 mm at dt_max 2 s and is within 5 % at 1 s, so the comparison is dt-insensitive. A tank never raises max depth.
- Findings:
  - **M1 (major)** `api/mitigation.py:53`: re-runs use `dt_max=30.0`, as does the stored synthetic run (`api/synthetic.py:50`). That is the D1-unstable regime (safe default is 2 s). Fix: use the solver defaults.
  - **M2** "Delta" fields mean different things. Mitigation uses the max over each interval across all steps (`mitigation.py:118`). /streets uses instantaneous snapshots. The two baselines for the same run therefore differ (e.g. interval max 0.0110 m vs snapshot 0.0038 m at the 7th output). Document this, or use one definition everywhere.
  - **M3 (behaviour, documented)** Tanks capture from the first water at `inflow_mm_h` and never drain. In the test, the tank was full within about 10 minutes and had zero effect on the peak. It is a first-flush tank, which the API should state.
  - **C1** `solver/campaign.py:196` passes `rain_fn` straight to `run()`. It does not require `piecewise_rain`/breakpoints and does not guard α/dt_max (strict xfail). The defaults are safe (0.35 / 2 s).

### M2-A3-06 /streets and /mitigation API (b51b708, e95fd7d, 175a55e): CONDITIONAL
- **flood_class: PASS.** Thresholds (`api/streets.py:19-20`) have inclusive lower bounds: dry <0.05, low [0.05, 0.15), moderate [0.15, 0.30), high [0.30, 0.50), severe ≥0.50. 11 boundary values checked. Labelled `assumption` in the response.
- **max / p95: PASS.** Matches an independent numpy recomputation to 1e-12 on every segment (e.g. 0.0116649 / 0.0066299 m). Note: p95 is pooled over cells × snapshots, as documented in `AGGREGATION_METHOD`.
- **Geometry: PASS.** `to_wgs84` uses `always_xy=True` (`api/products.py:84`). Output is [lon, lat] (e.g. [2.1627, 41.3954]) with `crs: EPSG:4326`.
- **VALID_DAYS: PASS.** Includes 2–7 Oct (`api/main.py:24`).
- **No flood reports as inputs: PASS.** A static scan of `src/` finds no flood-report, incident or evaluation reads. The schema reserves `observed_outcome` "evaluation only, never an input".
- Defects:
  - **S1** `api/products.py:29` (`day_index`) includes both window ends. The boundary snapshot is counted in two days: 51 snapshots in a 50-interval (25 h) day. `minutes_above_*` can reach 1530 min in a 1500-min day. Use a half-open (a, b] window. Strict xfail.
  - **S2** `api/streets.py:48` does not filter OSM highway classes. Footway, steps, elevator, corridor, etc. are aggregated as streets, and footways are 50 200 of 84 323 features. Strict xfail.
  - Also M1 above (dt_max=30 in the API re-runs).

### G5 completeness: PASS for the D5 case
`aggregate_by_local_day` on the stored D5 raw file marks 3 Oct (47/48) and 4 Oct (45/48) `complete=False`, and 2, 5, 6, 7 Oct complete. **G5 → PASS** at the data/time layer. Residual: S1 is a day-boundary error in the API layer and is tracked under G7.

### G7 Contract: CONDITIONAL
`tests/test_api.py`, run read-only at committed HEAD 0409558: **25 passed, 1 skipped**. The earlier ValidationError was fixed in d1be36b. Open: S1, S2, M1, M2.

### Summary of verdicts (supersedes earlier rows)
G1 CONDITIONAL · G2 CONDITIONAL · G3 CONDITIONAL · G4 CONDITIONAL (Marc sign-off) · **G5 PASS** · G6 CONDITIONAL · G7 CONDITIONAL · G8 not reached.

## G6 re-audit after 4c80f23 (numerics guard) + 30 m assessment, 2026-10-10 ~00:20 CEST
Audited at committed HEAD e26e98d, which contains 4c80f23, in a clean worktree. Uncommitted A5 API edits were excluded.

### Guard (`solver/local_inertial.py:173-191`)
- **Thresholds are correct.** α > 0.35 or dt_max > 2 s raises `NumericsLimitError` (α=0.7/10 s raises; 0.35/2.5 s raises; 0.35/2.0 s passes). It is called in `run` (:215), `run_mitigated` (`mitigation.py:84`), `campaign.execute` (`campaign.py:54`) and `run_grid` (`grid.py:138`). The campaign also requires `piecewise_rain` breakpoints (`campaign.py:55-56`). C1 and the D1-unsafe-settings residual are **closed**, and the xfail markers have been removed and replaced by passing tests.
- **G6-a (defect):** comparisons use `>`, so `alpha=nan` or `dt_max=nan` pass silently (:185). Strict xfail `test_nan_numerics_rejected`. Fix: `not (alpha <= LIMIT)`.
- **G6-b (defect):** the override is only a `RuntimeWarning`. It is not recorded in Ledger, Snapshot or run metadata, so a run made under override cannot be identified after the fact. Request: an `override_numerics` flag and the α/dt_max values in run metadata and API provenance.
- `step()` itself is unguarded (it takes dt directly). That is acceptable as an internal API, but it should be documented.
- `fixed_dt_study` always runs under override (α=inf). This is intended for verification and appears as a warning.

### 30 s steps in the API
At HEAD, `api/synthetic.py:50` (`dt_max=30.0`) and `api/mitigation.py:53` now **raise**; they do not override. The result is that **12 test setups error at HEAD**: 10 in `tests/test_api.py` and 2 in `tests/test_streets_audit.py` that build a synthetic run. The guard works as intended. A5 has uncommitted edits that remove `dt_max=30` and must commit them.

### Full suite at HEAD (my tests updated)
110 passed, 1 skipped, 3 xfailed (G6-a, S1, S2), 12 errors (all `NumericsLimitError` from `api/synthetic.py:50`). The Green-Ampt test now runs dt_max=10 s with `override=True`. This is justified because it is infiltration-only on flat terrain, where no flux and no CFL instability are possible.

### Does G6 hold at 30 m? Synthetic only
| Check | Result |
|---|---|
| Planar 1 %, n 0.03, 50 mm/h, L 1200 m, equilibrium, rel L1 vs KW (outlet cell excluded) | dx 60/30/15/7.5 m → 0.0387, **0.0208**, 0.0110, 0.0060 (order ~0.9). Mass balance ≤ 4e-14 |
| Peak depth 30 vs 15 m | 0.04033 vs 0.04082 m, **1.2 %** (< 5 % PASS) |
| Transient 30-min storm, peak outflow 30/15/7.5 m | 0.007124 / 0.007126 / 0.007125 m³/s per m (0.03 %) |
| Steep 5/10/20 %, n 0.015, 100 mm/h | Stable at 30 m: no oscillation in the last hour, h/h_KW 1.015 (15 m: 1.007), Q_out = rL, MB ≤ 6e-15. **But Fr 2.5–4.8**: outside the local-inertial validity range (Fr < ~0.5). The agreement holds only because the flow is friction-dominated |
| Free outflow (flat 30 m bed, 0.5 m pond, 6 h) | MB 6e-16, outflow fully booked, storage monotone non-increasing (no reflection), profile drops monotonically toward the outlet (no ponding). Caveat: the outlet face reaches q/√(gh³) up to 1.24 (median 0.50). The sink can over-drain briefly beyond critical-depth control. The planar steady case shows drawdown in the last interior cell (h/h_KW 0.97 at 30 m) |

**Verdict at 30 m: CONDITIONAL PASS for the numerics.** Accuracy is about 2 % against analytic on smooth sheet flow, the 30→15 m change is 1.2 %, the scheme is stable, mass is conserved, and the outlet does not reflect. Caveats:
1. **30 m cells cannot resolve 10–20 m streets.** Street depths are cell averages over buildings + street (blocked or raised building cells at 30 m remove whole blocks or none). Street-level depth and minutes-above are therefore indicative only, and likely underestimate channelised street depth.
2. Steep streets (Collserola foothills, Fr > 0.5) are outside the scheme's validity even when stable.
3. The DEM's 1 m vertical quantisation (G2) dominates over the numerical error at 30 m.
4. River outlets that use the free-outfall sink can over-drain transiently. Prefer a critical-depth or rating outlet for Besòs/Llobregat mouths, or report this as an assumption.
5. These tests used my own planar/pond cases on `run()`. `run_grid` with sea/river outlets (4c80f23) was not exercised at 30 m.

### G6 verdict: CONDITIONAL (unchanged class, fewer conditions)
Closed: D1 residual, D2 residual (campaign/grid), C1. Open:
- G6-a (NaN bypass)
- G6-b (override not recorded in metadata)
- A5 must commit the API dt_max fix (12 setup errors at HEAD)
- A4 acceptance of order ~0.85
- the 30 m caveats above

## G6 final audit after 3185aeb, 2026-10-10 ~00:15 CEST
New tests: `tests/test_g6_final_audit.py` (5 pass, 1 strict xfail). `test_nan_numerics_rejected` has had its xfail removed.

- **G6-a closed.** NaN α or dt_max is rejected even with override. inf α and α ≤ 0 / dt_max ≤ 0 are rejected too (`local_inertial.py` `check_numerics`).
- **G6-b closed.**
  - `run(..., override=True)` sets `Ledger.numerics_override=True`; it is False otherwise.
  - `GridRun` with `override_numerics=True` plus `launch.write_outputs` writes `summary.json` with `numerics_override: true`, the α/dt_max values, and the same values in `mass_balance`.
- **Critical-depth edge outlet at 30 m (via `run_grid`):** flat 30 m bed, 0.5 m pond, edge outflow on the last column, 60 s snapshots.
  - Outflow in each interval is at most √g·h^1.5·width·Δt (observed at most 0.24× the bound).
  - The volume drained equals the booked `edge_outflow` (rel < 1e-9).
  - Storage and every cell depth only decrease (no reflection), and the final profile drops monotonically toward the edge (no ponding).
  - It drains no faster than the old h=0 free-outfall sink (1 h storage left: critical ≥ sink).
  - Caveat: `q = √(g h³)` uses the cell depth as critical depth. This is the upper bound; for depth measured upstream as head, the free-overfall discharge is about 0.54·√g·h^1.5. The model is therefore conservative toward draining (less ponding at the mouth). It is labelled ASSUMPTION in `mass_balance.edge_outflow_kind`.
- **Tank drain-down: PASS.** `run_mitigated` with drain_down 1e-3 m³/s and two storms:
  - release > 0, level = capture − release (1e-9), level within [0, V]
  - capture > V, so capacity is restored
  - surface MB < 1e-9 (release leaves the tank, not the surface)
  - the lever is `label=assumption`, source "no source"

  `run_grid` books it as `tank_release_m3`.
- **NEW DEFECT D6 (blocking for Barcelona):** `GreenAmpt.capacity` (`local_inertial.py:39`, introduced by the D4 fix) returns 0·∞ = **NaN** when k_sat=0 and F=0. With `GridInputs.pervious_mask=None` (the default: all open cells pervious), every depth becomes NaN. MB then returns nan, which fails the check but raises nothing. **73 % of `manifests/derived/landcover/bcn_ga_ks_cm_h_25831_5m.tif` is 0 (2 977 218 of 4 050 544 valid cells),** and no production builder sets `pervious_mask`. Fix: capacity = 0 where k_sat = 0 (or pervious = k_sat > 0), and assert finite h. Strict xfail `test_zero_ksat_pervious_cells_stay_finite`.
- **M2-A2-06 diagnostics (solver side), quick independent check:** N→S plane at 30 m.
  - dominant inflow = N (code 0) on all interior cells
  - per-cell residual 6e-15, MB 2e-14
  - flux contributing area grows linearly downslope: 1.0, 2.0 … 9.9 cells
  - peak times are UTC seconds; conversion to Madrid local time is the API's job

### G6 verdict: **CONDITIONAL** (one blocking item)
All earlier G6 conditions are closed:
- D1/D2 residuals, C1, G6-a, G6-b
- order ~0.85 accepted by A4
- 30 m conditional pass accepted by A4
- critical-depth outlets verified

**Blocking: D6** (zero-Ks NaN). G6 becomes PASS once D6 is fixed and `test_zero_ksat_pervious_cells_stay_finite` flips (strict xfail → XPASS), provided the full suite is green.

### Update ~00:40 CEST: D6 closed, G6 PASS
- `c59af83` added a Ks=0 guard (`GreenAmpt.capacity` returns 0 where k_sat ≤ 0). `test_zero_ksat_pervious_cells_stay_finite` XPASSed and its xfail has been removed. It now passes (6/6 in `test_g6_final_audit.py`).
- Full suite at e96d9ad (includes c59af83, a579704): **152 passed, 1 skipped, 0 failed**. The only failure was the strict-xfail D6 test flipping to XPASS, which is now resolved.
- **G6: PASS.** Conditions accepted by A4: order ~0.85; at 30 m street depths are cell-averaged, Fr > 0.5 steep streets are outside validity, the DEM has 1 m quantisation, and the critical-depth outlet uses q = √(g h³) as an upper bound (ASSUMPTION).

### G7 update
- S1 is closed: `day_index` is half-open and run_grid uses per-step time-above fields. Each day ≤ its length (25 h), and the day sum equals the snapshot total within crossing tolerance.
- S2 is closed (`ROAD_CLASSES`). M1 is closed (API on solver defaults, 08f13b2). M2 is closed: max, p95 and minutes all use per-step daily fields. Max and p95 match the independent 60 s snapshot aggregation within 2 mm / 2 %, and the per-step max ≥ every sampled value.
- The report scan uses word boundaries (`coincident` in `data/rain_idw.py` is not a hit).
- `tests/test_api.py` passes within the full suite.
- **G7: CONDITIONAL → PASS for /streets and /mitigation.** `/hotspots` (a579704, c7432b0) has landed but is **not yet audited** (M2-A3-07). A preliminary reading of `api/hotspots.py` found inflow direction from terrain D8 (`_inflow_direction`) rather than from the flux-based solver diagnostic (`dominant_inflow_dir`). That needs checking in the audit. G7 stays CONDITIONAL until the hotspots audit is done.

## M2-A3-07 /hotspots audit, 2026-10-10 ~00:35 CEST
Audited at **committed HEAD 8c137a6** (`api/hotspots.py` from a579704 + c7432b0) in a clean worktree. The working tree has an uncommitted, in-progress rewrite of `api/hotspots.py` by A5. It switches to flux-based `contributing_area_flux_m2` and `inflow_by_direction`. **That rewrite is not audited.** New test file: `tests/test_hotspots_audit.py` (5 pass, 3 strict xfail at HEAD). Each xfail was confirmed with `--runxfail` to fail for the stated reason. Synthetic runs only.

**PASS**
- **Ranking uses only simulated values.** score = `max_depth_m × time_above_0_10m_s/60` from run_grid per-day fields. The ranking is monotone. The top score equals the independent field max (rel 1e-12). Every listed score equals the field value at its cell. Scores are labelled `kind=simulated`.
- **Per-cell budget closes.** The stored `cell_budget` residual_rel is < 1e-9 in outputs.npz.
- **Peak time in Europe/Madrid, including on the DST day (25 Oct, 25 h).** The ISO strings carry the offset that Madrid actually had at that instant (+02/+01), and the local date equals the requested day.
- **Nothing hand-picked or from reports.** There are no constants, coordinates, or report/incident terms in the source (word-boundary scan). Rainfall is IDW from G1 gauges, labelled estimate, or `assumption` on synthetic runs.

**Defects**
- **H1 (major): inflow direction is not flux-consistent.** `_inflow_direction` (`api/hotspots.py:138-146`) returns the *highest* D8 DEM neighbour. Its docstring says "draining toward", but the code never checks that the neighbour drains to the cell.
  - Cliff/wall case (30 m, building row south of a collecting row): the solver `dominant_inflow_dir` = **N** on 6/6 cells (0.267 m ponded), while the API says **SE**, i.e. the dry wall.
  - Seeded rough tilted terrain (20×20, 30 m, 40 mm): the D8 label contains the flux direction on only **65/120 wet cells (54 %)** and **5/12 (42 %) of the deepest 10 %**, which are exactly the hotspot candidates.
  - `upstream_streets` uses D8 receivers on the DEM, so it has the same weakness.
  - Fix: serve `dominant_inflow_dir`/`inflow_by_direction` from outputs.npz. Keep D8 only as a labelled `dem_crosscheck`.
- **H2 (major): simulated contributing area and the per-cell budget are served as null.** `explanation.runoff/inflow/drainage_out/infiltration_out` are all null. The "unavailable" reasons say "not in run_grid outputs yet", which has been stale since c59af83 stored `contributing_area_flux_m2` and `cell_budget`.
- **H3 (minor): peak time comes from snapshot argmax** (`api/hotspots.py:~202-204`). Its resolution is the snapshot interval, and it is not the solver's per-step `peak_time_utc_s`. In the DST synthetic run, the first hotspot differs from the per-step peak by 5208 s (87 min). Before treating that gap as purely a resolution loss, A5 should confirm the epoch of `peak_time_utc_s` (day start).

### G7 Contract: CONDITIONAL
/streets and /mitigation pass. /hotspots passes on ranking, time zone, and provenance, but **fails on flux-consistency (H1, H2)**. G7 → PASS once A5 commits the flux-based fields (the working-tree rewrite appears to do this) and the three xfails in `tests/test_hotspots_audit.py` turn into passes. Remove the markers at that point.

Gate summary: G1–G4 CONDITIONAL · G5 PASS · **G6 PASS** · **G7 CONDITIONAL (H1/H2)** · G8 not reached.

## G7 final: /hotspots re-audit (11286b0) + mitigation driver (55f6ff4), 2026-10-10 ~01:05 CEST
**G7 Contract: PASS.** /streets, /mitigation and /hotspots all pass. There are no strict xfails left in A3 tests. Full suite at HEAD 55f6ff4 + A3 tests: **176 passed, 1 skipped, 0 failed**. Ruff is clean.

### /hotspots H1–H3: fixed, verified independently
- **H1 fixed.** Two checks:
  - API check: the served `main_inflow_direction` equals the solver's `dominant_inflow_dir` per day, and equals the argmax of the served `inflow_by_direction`, for every listed hotspot on the DST synthetic run. D8 is kept only under `dem_crosscheck`, labelled "DEM cross-check only". In the wall case it still says SE, and it is not served as the flow direction.
  - Solver check (not comparing the API to itself): `run_grid` was re-run with a spy on `step` that re-accumulates per-face inflow from the post-limiter `qx`/`qy` × dt. Convention: +qy is row r−1→r, i.e. from N; +qx is col c−1→c, i.e. from W.
    - Wall case and rough-slope case: `inflow_by_dir_m3` matches that independent accumulation to 1e-9.
    - `dominant_inflow_dir` equals the independent argmax on every cell with inflow > 1e-6 m³.
    - Wall case: N on 6/6 collecting cells.
- **H2 fixed.** The simulated contributing area is served. The per-cell budget is served too: rain, roof, inflow, runoff_out, drainage, infiltration, boundary, tank, storage. Re-adding the served terms closes to ≤1e-6 relative, and served residual_rel < 1e-9. Note: the budget period is the **whole run**, while depth and peak are per day. It is labelled `budget_period`, and the UI should show that label.
- **H3 fixed. Origin confirmed:** per-day `peak_time_utc_s` counts seconds from the **run start t0_utc** (`grid.py:100`, `summary.json t0_utc`), not from the local-day start.
  - The served `peak_time_local` = `start_utc + value` (to 1 ms), in Madrid time.
  - It lies inside that Madrid day, including on 25 Oct.
  - The nearest snapshot is ≥80 % of that day's snapshot envelope.
  - `peak_depth_m` ≥ the snapshot max.
  - The 87-minute gap in the previous audit was the snapshot-argmax defect, not an origin offset.

### Mitigation driver 55f6ff4: PASS (results CONDITIONAL by design)
Test file: `tests/test_mitigation_driver_audit.py`, 7 pass.
- **Baseline identical:** every config from `subdomain.lever_configs` equals the subdomain `baseline` in **all** GridInputs fields except `mitigation`: forcing, weights, overrides, grid, drainage=mid, α, dt_max, outlets.
- **Labels:** every lever's `source` carries the "assumption, illustrative, Orchestrator-set; not engineering design" label and rationale.
- **Numerics:** α ≤ 0.35, dt_max ≤ 2 s, `override_numerics=False`. The ledger shows `numerics_override=False`.
- **Mass, all 5 configs (rain ×8 so the tank is exercised):** mass_balance_error_rel < 1e-9.
  - The tank books captured and released volume.
  - Level = captured − released, within 0 ≤ level ≤ 20 000 m³.
  - Cumulative capture can exceed the volume because the tank refills after drain-down. That is expected.
- **Minor notes (non-blocking):**
  1. The driver records each config's mass error but does not reject a config above 1e-9.
  2. `{"top": n}` hotspot selection uses deepest-cell order, not the /hotspots score. Pass explicit /hotspots cells for consistency.
  3. Subdomain-cut edges carry critical-depth outflow, labelled assumption. Deltas are relative to the subdomain baseline, not the full grid. The CONDITIONAL label is correct.

Gate summary: G1–G4 CONDITIONAL · G5 PASS · G6 PASS · **G7 PASS** · G8 not reached.
