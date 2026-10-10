# Streets and mitigation API (M2-A5-04, M2-A5-05)

Details of the full contract: `docs/api/contract_v0.2.md`. Example: `examples/streets_day.geojson`
(SYNTHETIC run, date 2026-10-03, stub street network, labelled in its `label` field).

## GET /simulations/{id}/streets?date=YYYY-MM-DD
Gated like all run data (409 for non-synthetic runs while `docs/release_gates.json` is not all
PASSED). `date` must be a local day in the run (for example 2026-10-02..07), otherwise 404.

Returns a GeoJSON FeatureCollection (RFC 7946, WGS84 lon/lat). Each feature is a `LineString` street
segment. Source: Agent 1's M2-A1-07 OSM streets (`manifests/derived/osm/bcn_streets_osm_25831.geojson.gz`),
clipped to the run grid. Synthetic runs use a stub grid network unless meta `street_source="osm"`.

**Included OSM highway classes** (G3 condition, Agent 3): motorway, motorway_link, trunk,
trunk_link, primary, primary_link, secondary, secondary_link, tertiary, tertiary_link, unclassified,
residential, living_street, service, busway. Everything else is excluded, and so are `area=yes`
features. Excluded classes include footway, path, steps, cycleway, track, pedestrian, corridor,
bridleway, elevator, platform, ladder, construction, proposed, raceway and bus_stop.

**Depth definition.** For run_grid runs (the launcher layout), `max_depth_m` is the maximum over
**all solver steps** in the local day. `/mitigation` uses the same definition. `minutes_above_*` is
step-exact time above the threshold (max over the segment's cells). `p95_depth_m` is the 95th
percentile of the segment cells' daily max depth. Days are half-open [start, end) windows, so no
snapshot is counted in two days. Legacy snapshot-only runs fall back to snapshot statistics.

Collection `properties`: `run_id, date, timezone, crs="EPSG:4326", synthetic, street_network_stub,
flood_class_thresholds_m, flood_class_kind="assumption"`.

Feature `properties`:
| Field | Type | Unit | Meaning |
|---|---|---|---|
| segment_id, name | str | — | `osm-<osm_id>` or `stub-*` |
| date | str YYYY-MM-DD | — | local day (Europe/Madrid) |
| max_depth_m | float or null | m | max depth over the segment's cells and the day's snapshots (simulated) |
| p95_depth_m | float or null | m | 95th percentile of all cell × snapshot depths (simulated) |
| minutes_above_0.10m | float or null | min | snapshots where segment max > 0.10 m, × snapshot interval |
| minutes_above_0.30m | float or null | min | same with 0.30 m |
| flood_class | dry/low/moderate/high/severe | — | from max_depth_m, see below |
| drainage_scenario_spread | `{max_depth_m: {low, mid, high}, range_m, baseline_scenario, unit:"m", kind:"assumption"}` | m | see below |
| uncertainty_status | str | — | currently always UNVALIDATED (not calibrated) |
| data_quality | str | — | run type (synthetic/model) and street source |
| aggregation_method | str | — | text description of the method above |
| units, kind, cells_sampled | | | `{"depth":"m","time":"min"}`, `simulated`, int |

**drainage_scenario_spread.** `max_depth_m.low/mid/high` is the segment's `max_depth_m`, computed
the same way, in the sibling runs with the ASSUMPTION drainage capacities low=10, mid=20 and
high=30 mm/h (meta `drainage_scenarios`). The served run is one of them (`baseline_scenario`,
normally `mid`), so its value equals `max_depth_m`. Because less drainage gives deeper water,
`high ≤ max_depth_m ≤ low`. `range_m = max − min` of the three values is the sensitivity of the
segment depth to the unknown drainage capacity. It is not a statistical confidence interval. A
value is null when that scenario run is missing.

**Flood classes** (on max_depth_m, lower bound inclusive, kind assumption):
dry < 0.05 m ≤ low < 0.15 m ≤ moderate < 0.30 m ≤ high < 0.50 m ≤ severe.

## GET / POST /simulations/{id}/mitigation
Engine: the stored GridInputs (`inputs.pkl` from Agent 2's launcher) is re-run through
`solver.grid.run_grid` with the scenario's `solver.mitigation.Lever`s added, using the default
numerics (alpha 0.35, dt_max 2 s; no G6 override). The baseline is the stored run itself. Max depth
is the max over **all solver steps** per local day, the same definition as `/streets`.
`delta_max_depth` gives the per-cell change, which the API aggregates to street segments.

**Detention tanks never empty** (audit A3-06). A tank fills within minutes (about 10 min in the
synthetic case) and stays full, so it does not reduce the peak depth of later or longer storms.
Treat tank scenarios accordingly.

- GET runs placeholder scenarios `drain_plus_{10,20,30}mm_h` (extra drainage on all cells; kind
  assumption, no source).
- POST body: `{"scenarios": [{"name": str, "levers": [{"kind": "drain"|"suds"|"tank"|"green_roof",
  "cells": "all" | [[row, col], ...], "params": {...}}]}]}`. Params follow solver.mitigation
  (`extra_mm_h`, `k_sat_m_s`, `volume_m3`/`inflow_mm_h`, `storage_m`). An invalid scenario returns 409.

Response: `{run_id, synthetic, disclaimer, flooded_threshold_m: 0.10, engine, street_network_stub,
days[]}`. Each `days[]` entry has `{date, baseline: {flooded_street_length [m], peak_depth [m]},
scenarios: {name: {delta_flooded_street_length [m], delta_peak_depth [m], min_cell_delta_max_depth [m],
levers, lever_kind: "assumption", label: "model scenario"}}}`.
Values are Quantities (kind simulated). These are **model scenarios, not guarantees.** Flooded street
length is the total length of segments whose max depth (over their cells) is > 0.10 m.

Works for any registered run_grid run (synthetic or real) that has `inputs.pkl`. Runs without it
(legacy snapshot layout) return 501.

## GET /simulations/{id}/hotspots?date=YYYY-MM-DD&limit=N&include_mitigation=false
(M2-A5-06) Gated like all run data. Needs a run_grid run; legacy runs return 501. Example:
`examples/hotspots_day.geojson` (SYNTHETIC, 2026-10-03).

**Selection is purely numeric. No spot is chosen by hand or from reports.**
`score = peak_depth_m × minutes_above_0.10m` (unit m·min, per cell, per local day, from the
run_grid per-day fields). Cells with score > 0 are sorted by score, descending (ties go to the
deeper cell). A cell within **100 m** of a higher-ranked hotspot is skipped. The top `limit` are returned.

GeoJSON FeatureCollection of WGS84 `Point`s (cell centres). Feature `properties`:
| Field | Meaning |
|---|---|
| date, rank, cell_id, score {value, unit "m*min", kind simulated} | |
| nearest_street {name, segment_id, distance_m} | nearest segment from the filtered road classes (or the stub network) |
| local_rainfall {label, day_total (mm, kind estimate), stations, distances_m, weights, excluded_missing, method, reason} | label "IDW estimate from 4 gauges, unvalidated for 3-7 Oct". Agent 1's `data.rain_idw.idw_point(x, y, load_stations("manifests/xema_stations_g1.json"), values, power=2, k=4)` at the cell centre (EPSG:25831), using each gauge's (D5, WU, X4, X8) rain total over the local day. Per-gauge totals come from the run forcing columns named in run meta `rain_station_ids`. Missing gauges are excluded and the weights renormalised. If no value is possible (synthetic run, no gauge ids, all gauges missing), `day_total.value` is null and `reason` says why |
| model_forcing_rain (mm) | rain actually applied to the cell by the run, Σ_s w_s(cell)·rain_s (kind assumption for synthetic runs) |
| peak_depth_m, minutes_above_0.10m, minutes_above_0.30m | step-exact run_grid fields |
| peak_time_local, peak_time_resolution | Europe/Madrid time of the max depth in the day, from the solver per-day, per-step `day{i}_peak_time_utc_s` (UTC = run t0_utc + value; "solver step" resolution). NaN (cell stayed dry) gives null. Older runs without the field fall back to the snapshot max |
| max_velocity_m_s | run_grid max speed (null where depth < 0.01 m) |
| flood_class | same thresholds as /streets |
| upstream_contributing_area {simulated (m2), d8_cross_check (m2, terrain_diagnostic)} | `simulated` = solver `contributing_area_flux_m2` = (lateral inflow + rain on cell) volume / domain-mean gross rain depth. `d8_cross_check` = DEM D8 accumulation, comparison only |
| main_inflow_direction (N/E/S/W) | face with the largest **simulated** cumulative inflow over the local day (solver per-day `inflow_{N,E,S,W}_m3`, M2-A2-06) |
| inflow_by_direction {N, E, S, W} (m3) | that per-face day inflow |
| upstream_streets | streets crossing the cells reached by tracing the simulated inflow upstream from the hotspot. A face is followed when it brings ≥ 5 % of that cell's day inflow |
| dem_crosscheck {label, kind terrain_diagnostic, main_inflow_direction, upstream_streets, contributing_area} | **DEM cross-check only**: D8 steepest descent on the DEM (no simulated flow). Kept so it can be compared with the simulated fields; never used for ranking or explanation |
| local_slope (m/m), depression_depth (m) | solver terrain diagnostics `slope_m_m`, `depression_depth_m` (kind terrain_diagnostic) |
| drainage_scenario_spread | cell max depth in the low/mid/high drainage runs (same meaning as /streets) |
| explanation | Per-cell budget from the solver (M2-A2-06), **cumulative over the whole run** (`budget_period`), in m3 = budget depth × cell area: `rain_in`, `roof_in`, `inflow` (lateral in), `runoff_out` (lateral out), `drainage_out`, `infiltration_out`, `boundary_outflow`, `tank`, `storage_end`, plus `residual_rel` (1) and `stored_depth_peak` (m). `best_mitigation` {scenario, delta_peak_depth, label "model scenario, not a guarantee"} is computed only with `include_mitigation=true` (re-runs the default drain scenarios; slow) |
| uncertainty_status, data_quality, provenance {run_id, source, selection} | |
| unavailable | map of diagnostic → reason, for every value returned as null |
