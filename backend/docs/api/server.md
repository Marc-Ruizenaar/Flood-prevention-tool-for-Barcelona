# Running the API server

```bash
cd /workspace/bcn-flood
# optional: make a SYNTHETIC demo run (+ low/mid/high drainage siblings) in outputs/runs/
PYTHONPATH=src .venv/bin/python -m bcnflood.api.synthetic
PYTHONPATH=src .venv/bin/uvicorn bcnflood.api.main:app --host 0.0.0.0 --port 8000
```

Env: `BCNFLOOD_RUNS` (run store, default `outputs/runs`), `BCNFLOOD_GATES` (default
`docs/release_gates.json`), `BCNFLOOD_STREETS` (default
`manifests/derived/osm/bcn_streets_osm_25831.geojson.gz`), `BCNFLOOD_MANIFEST`.

Smoke checks:
```bash
curl localhost:8000/gates
curl "localhost:8000/daily?run_id=synthetic-demo"
curl "localhost:8000/cells?run_id=synthetic-demo&date=2026-10-24"
curl "localhost:8000/timeseries?run_id=synthetic-demo&row=2&col=10"
curl "localhost:8000/simulations/synthetic-demo/streets?date=2026-10-25"
curl "localhost:8000/simulations/synthetic-demo/mitigation"
curl -o d.tif "localhost:8000/runs/synthetic-demo/export/geotiff?date=2026-10-24"
curl localhost:8000/daily     # 409 while release gates are closed (Barcelona run)
```
Interactive docs at `/docs`.

Dependencies used but not declared in `pyproject.toml`: `rasterio` (GeoTIFF export) and `pyproj`
(WGS84 conversion). Both are installed in `.venv`. Agent 4 should add them to `dependencies`.
