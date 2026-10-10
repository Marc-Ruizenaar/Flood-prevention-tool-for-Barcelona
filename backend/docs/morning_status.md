# Morning status: BCN flood engine (Agent 4, Orchestrator)

Written from the repo state at HEAD `08ccde6` (2026-10-10, ~00:40 CEST). Every number below comes from a
commit, `docs/release_gates.json`, `docs/audit/*`, `config/` or a live API call. Nothing about the
Barcelona 2-7 Oct run is filled in yet. Look for the **PENDING** sections.

## Release gates

| Gate | Name | Status | Reason |
|---|---|---|---|
| G1 | rainfall | CONDITIONAL | XEMA 3-7 Oct provisional, ~52/288 half-hour records per station validated; Meteocat licence not open, needs Marc |
| G2 | terrain | CONDITIONAL | MDT05 1 m vertical rounding (dominant error at 30 m) |
| G3 | surface parameters | CONDITIONAL | OSM fallback (Catastro/SIOSE missing); clay loam everywhere; ODbL |
| G4 | drainage | CONDITIONAL | no sewer data; assumed scenarios 0/10/20/30 mm/h need Marc's sign-off |
| G5 | local day to UTC | PASS | Agent 3 e26e98d |
| G6 | numerics | PASS | Agent 3 31fa4e3; order ~0.85 accepted; 30 m CONDITIONAL PASS; D6 (Ks=0 NaN) fixed c59af83 |
| G7 | API contract | CONDITIONAL | /hotspots audit 40b450c: H1 (inflow from DEM D8, not solver flux), H2 (contributing area/budget null), H3 (snapshot peak time, 87 min off in DST test). 3 xfail tests track these |
| G8 | sign-off | NEEDS MARC | not reached |

Note: `docs/release_gates.json` stores G1-G4 and G7 as `PENDING` with `CONDITIONAL:` evidence. Its G7
evidence text (S1/S2/M1/M2) is stale: those were resolved in e96d9ad/08f13b2, and H1-H3 are what's left.

**Hotspot fixes:** the working tree holds Agent 5's **uncommitted** rewrite of `api/hotspots.py`. On a
synthetic run it serves `inflow_source` "simulated per-face cumulative inflow", a simulated
`upstream_contributing_area` and an `explanation` budget, and it shows the D8 result only as
`dem_crosscheck`. That looks like it addresses H1 and H2. It is not committed or audited yet, so G7 stays CONDITIONAL.

## What passed
- Numerics (G6): mass error <=4e-14 (planar), <1e-9 with outlets/tank/per-cell budget; 30 m planar error 2.1%,
  30 vs 15 m peak depth change 1.2%; NaN/inf guards hold even with the override, and overrides are recorded in the ledger and summary.json.
- Time windows (G5), with Europe/Madrid DST offsets verified on /hotspots peak times.
- Hotspot ranking uses simulated fields only (score = peak_depth_m × minutes_above_0.10m, 100 m dedupe). No hand-picked or report inputs (audit A3-07).
- Real 30 m inputs built: `outputs/inputs/bcn_30m.pkl`, 558×489, 112,578 active cells, 0 NaN, 28,835 building cells
  (>=50% roof), rain_station_ids [X4, X8, D5, WU]. Station totals: X4 280.5, X8 243.9, D5 261.1 (X8-copy basis), WU 234.1 mm.

## Caveats (all of them)
1. **Rainfall:** XEMA is provisional, with only ~52/288 records per station validated. The Meteocat licence is not open.
2. **D5 gap:** 3 Oct 21:30-23:00Z (intervals 95-98) is filled by power-2 IDW over X4/X8/WU, adding 17.34/18.92/11.67/8.63 mm
   (56.56 mm, 2.04 Mm³). Sensitivity: the IDW fill gives a 275.96 mm run total versus 261.1 mm for an X8 copy (+14.86 mm, **+5.7%**, +0.54 Mm³). The gap is labelled an assumption (08ccde6).
3. **Hotspot local rainfall:** a 4-gauge IDW estimate. It ignores terrain and cannot exceed the range of the gauges.
4. **Terrain:** MDT05 has 1 m vertical rounding.
5. **Buildings/landcover:** OSM fallback (70,338 building polygons, overlaps not removed). About 25% of the area has no tag and defaults to sealed. ODbL share-alike applies.
6. **Soil:** every pervious cell is clay loam, from a single SoilGrids point. Sealed cells get Ks=0 by assumption (73% of the Ks raster is 0).
7. **Drainage:** assumed scenarios none/low/mid/high = 0/10/20/30 mm/h (`config/drainage_scenarios.json`). There is no design source.
8. **Grid:** 30 m cells don't resolve streets. Depths are cell-averaged and **likely understated**.
9. **Steep slopes:** stable, but Froude 2.5-4.8 is outside the scheme's validity.
10. **Outlets:** critical-depth outlets at Besòs (189 cells NE) and Llobregat (236 SW) are an assumption, an upper-bound discharge. The sea is free outfall (which can over-drain up to 1.24× critical). **Collserola is a closed boundary** (CONDITIONAL).
11. **Tank drain-down** and all mitigation levers are illustrative, Orchestrator-set assumptions (`config/mitigation_levers.json`):
    +10 mm/h drain, 25% permeable paving at Ks 2.5 cm/h, a 20,000 m³ tank (2 m³/s in, 0.2 m³/s out), and 30% green roofs at 20 mm.
12. **Mitigation** runs on CONDITIONAL subdomains around the top 3 hotspots, not the full grid.

## Barcelona 2-7 Oct run: PENDING: not yet run
Launch needs G1 and G4 sign-off from Marc. About 4.2 h for 3 scenarios in parallel (Agent 2's estimate).
```bash
nohup .venv/bin/python -m bcnflood.solver.launch --inputs outputs/inputs/bcn_30m.pkl --scenario {low|mid|high} --out OUT --gates-file GATES &
```
- Run ids: PENDING: not yet run
- Daily volumes / mass balance: PENDING: not yet run
- Top hotspots: PENDING: not yet run
- Street flood lengths: PENDING: not yet run

## Mitigation results: PENDING: not yet run
- Configs: baseline, drain, suds, tank, green_roof × top 3 hotspots (15 runs, about 7 min each)
- Deltas: PENDING: not yet run

## One-command demo start (synthetic data)
```bash
cd /workspace/bcn-flood && scripts/start_demo.sh 8000
```
This builds the SYNTHETIC run store (`synthetic-demo`, drain-low/high siblings and a launcher-layout run), then starts uvicorn on the port you give it.
It takes about 1.5-2 min to start. It was tested on port 8765. Trimmed real outputs:

```text
$ curl localhost:8000/health
{"status":"ok","version":"0.1.0","simulation_results_available":false,
 "dataset_status_counts":{"APPROVED":0,"CONDITIONAL":9,"REJECTED":1,"MISSING":5,"PENDING":2},
 "release_gate":"CLOSED: required inputs not APPROVED; no Barcelona run performed"}

$ curl localhost:8000/gates
{"all_passed":false,"gates":[{"id":"G1","name":"rainfall","status":"PENDING","evidence":"CONDITIONAL: 3-7 Oct unvalidated, ..."}, ...]}

$ curl localhost:8000/simulations/synthetic-demo/daily
[{"run_id":"synthetic-demo","date_local":"2026-10-03","window_utc":["2026-10-02T22:00:00Z","2026-10-03T22:00:00Z"],
  "rainfall_volume":{"value":960.0,"unit":"m3"},"drainage_volume":{"value":555.08,"kind":"assumption"},
  "boundary_outflow_volume":{"value":243.40},"mass_balance_error_rel":{"value":7.08e-13}, ...}]

$ curl "localhost:8000/simulations/synthetic-demo/streets?date=2026-10-03"
{"type":"FeatureCollection","features":[{"properties":{"name":"Synthetic street row 0","max_depth_m":0.0051,
  "flood_class":"dry","drainage_scenario_spread":{"max_depth_m":{"low":0.0065,"mid":0.0051,"high":0.0034}}, ...

$ curl "localhost:8000/simulations/synthetic-demo/hotspots?date=2026-10-03&limit=1"
rank 1, cell r2c10, score 88.30 m*min, peak_depth_m 0.214, peak_time_local 2026-10-03T01:24:34+02:00,
minutes_above_0.10m 412.1, flood_class moderate, main_inflow_direction W (simulated per-face inflow),
upstream_contributing_area simulated 798.8 m2 (D8 cross-check 2400 m2), local_rainfall null
("SYNTHETIC run: forcing is not gauge data"), model_forcing_rain 80 mm

$ curl localhost:8000/simulations/synthetic-demo/mitigation
{"synthetic":true,"disclaimer":"Model scenario comparison, not a guarantee of real-world outcome.",
 "days":[{"date":"2026-10-03","baseline":{"flooded_street_length":{"value":240.0,"unit":"m"},"peak_depth":{"value":0.2143}},
  "scenarios":{"drain_plus_10mm_h":{"delta_flooded_street_length":{"value":0.0},"delta_peak_depth":{"value":-0.0039}}, ...
```
Note: the synthetic run reports a `low` max depth that is *higher* than `mid` because less drainage leaves more water standing. That's expected.

## Test suite
Full suite at HEAD 08ccde6 plus the uncommitted Agent 5 hotspots rewrite (2026-10-10 ~00:55 CEST, 11 min): **164 passed, 1 skipped, 1 xfailed, 2 failed**. The two failures are `test_hotspots_audit::test_peak_time_matches_per_step_peak` and `::test_simulated_contributing_area_served`. They are strict xfail markers for H3/H2 that now XPASS against the uncommitted rewrite, so Agent 3 should flip them once Agent 5 commits. They are not regressions.
