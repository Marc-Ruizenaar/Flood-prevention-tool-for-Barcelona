# Flood model runs

One folder per run. Each run is one simulated area (a chunk) and holds `streets/<day>.json`, `hotspots/<day>.json`, `daily.json` and `mitigation.json`, in the backend `/simulations` contract (see `backend/docs/api.md`). `RUN_ID=<run-id> npm run sync:flood` pulls a run from the backend; `npm run slim:flood` slims the street files and rebuilds `index.json`.

`index.json` lists the runs the app may load. Fields per run: `id` (the folder name), `days` (one per streets file), `bbox` (west, south, east, north, from the street geometry) and `enabled`. The app only loads chunks that touch the map view, so a new run costs nothing until someone pans to it.

To take a run off the map, set `"enabled": false` on its index entry or delete its folder and rerun `npm run slim:flood`. The slim script keeps an existing `enabled` value when it rebuilds the index, so a disabled run stays disabled across rebuilds. To turn off the city-wide terrain overlay, delete `data/terrain-pooling.json` (the app fetches it on load and shows nothing when it is missing).

Runs from another model are welcome. The streets file is a GeoJSON FeatureCollection whose features keep `segment_id`, `name`, `max_depth_m`, `minutes_above_0.10m`, `minutes_above_0.30m` and `flood_class`, and whose collection-level `properties` carry `uncertainty_status` and `data_quality`. Everything else is optional and gets dropped by the slim step.
