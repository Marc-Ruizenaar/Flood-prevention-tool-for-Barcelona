"""FastAPI app (owned by Agent 5). Serves only verified manifests; never fabricates results."""
from __future__ import annotations

import os
from datetime import UTC, date, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from bcnflood import __version__
from bcnflood.api import mitigation as mit
from bcnflood.api import products
from bcnflood.api.contract import CONTRACT_VERSION, TimeseriesV02, not_run_daily
from bcnflood.api.gates import load_gates
from bcnflood.api.runstore import BCN_RUN_ID, StoredRun, list_runs, load_run
from bcnflood.api.streets import streets_geojson
from bcnflood.data.timewindows import local_day_window
from bcnflood.schemas import DatasetInventory, DatasetStatus, ErrorBody
from bcnflood.schemas.contract_v02 import CellOutputV02, DailySummaryV02, GateReport

MANIFEST = Path(os.environ.get(
    "BCNFLOOD_MANIFEST", Path(__file__).resolve().parents[3] / "manifests" / "datasets.json"))
VALID_DAYS = {"2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"}

ERR = {c: {"model": ErrorBody} for c in (404, 409, 501)}

app = FastAPI(title="Barcelona Flood Physics Engine", version=__version__,
              summary=f"API contract v{CONTRACT_VERSION}")
# Browser map reads this API from another origin (NEXT_PUBLIC_API_URL).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def _err(_, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code,
                        content={"error": {404: "not_found", 409: "not_available",
                                           501: "not_implemented"}.get(exc.status_code, "error"),
                                 "detail": exc.detail, "status_code": exc.status_code})


def load_inventory() -> DatasetInventory:
    return DatasetInventory.model_validate_json(MANIFEST.read_text())


def _gate_closed():
    rep = load_gates()
    if not rep.all_passed:
        closed = ", ".join(f"{g.id}={g.status}" for g in rep.gates if g.status != "PASSED")
        raise HTTPException(409, f"Release gate closed ({closed}). See GET /gates.")
    return rep


def _run(run_id: str) -> StoredRun:
    """Non-synthetic (Barcelona) runs are served only when all gates are PASSED.
    SYNTHETIC runs are always served, labelled synthetic=true."""
    run = load_run(run_id)
    if run is None:
        if run_id == BCN_RUN_ID:
            _gate_closed()
        raise HTTPException(404, f"Run {run_id} not found.")
    if not run.synthetic:
        _gate_closed()
    return run


def _day(run: StoredRun, d: str) -> date:
    try:
        dd = date.fromisoformat(d)
    except ValueError:
        raise HTTPException(404, f"Invalid date {d}") from None
    if dd not in run.days():
        raise HTTPException(404, f"Day {d} not in run {run.run_id} "
                                 f"({', '.join(x.isoformat() for x in run.days())})")
    return dd


@app.get("/gates", response_model=GateReport)
def gates():
    """Read-only release gate status G1-G8 (docs/release_gates.json, maintained by Agent 4)."""
    return load_gates()


@app.post("/runs", responses=ERR)
@app.post("/simulations", responses=ERR, include_in_schema=False)
def create_run():
    _gate_closed()
    raise HTTPException(501, "Barcelona run execution via the API is not implemented; runs are "
                             "produced offline into the run store.")


@app.get("/runs")
@app.get("/simulations", include_in_schema=False)
def runs():
    return {"runs": [{"run_id": r, "synthetic": load_run(r).synthetic} for r in list_runs()]}


@app.get("/runs/{run_id}", responses=ERR)
@app.get("/simulations/{run_id}", responses=ERR, include_in_schema=False)
def get_run(run_id: str):
    run = _run(run_id)
    return {k: run.meta[k] for k in ("run_id", "crs", "dx_m", "start_utc", "days_local",
                                     "synthetic", "drainage_capacity_m_s", "timezone")}


@app.get("/runs/{run_id}/daily", response_model=list[DailySummaryV02], responses=ERR)
@app.get("/simulations/{run_id}/daily", response_model=list[DailySummaryV02], responses=ERR,
         include_in_schema=False)
def get_run_daily(run_id: str):
    if load_run(run_id) is None and run_id == BCN_RUN_ID and load_gates().all_passed:
        out = []
        for d in sorted(date.fromisoformat(x) for x in VALID_DAYS):
            w = local_day_window(d)
            out.append(not_run_daily(run_id=run_id, date_local=d, timezone="Europe/Madrid",
                                     window_utc=(w.start_utc, w.end_utc)))
        return out
    return products.daily(_run(run_id))


@app.get("/daily", response_model=list[DailySummaryV02], responses=ERR)
def daily(run_id: str = BCN_RUN_ID):
    return get_run_daily(run_id)


@app.get("/runs/{run_id}/cells", response_model=list[CellOutputV02], responses=ERR)
@app.get("/cells", response_model=list[CellOutputV02], responses=ERR)
def cells(date_local: str | None = Query(None, alias="date"), run_id: str = BCN_RUN_ID,
          threshold_m: float = 0.10, min_depth_m: float = 0.01):
    run = _run(run_id)
    if date_local is None:
        raise HTTPException(404, "Query parameter 'date' (YYYY-MM-DD, local day) is required")
    try:
        return products.cells(run, _day(run, date_local), threshold_m, min_depth_m)
    except ValueError as e:
        raise HTTPException(409, str(e)) from None


@app.get("/runs/{run_id}/timeseries", response_model=TimeseriesV02, responses=ERR)
@app.get("/timeseries", response_model=TimeseriesV02, responses=ERR)
def timeseries(row: int | None = None, col: int | None = None, run_id: str = BCN_RUN_ID):
    run = _run(run_id)
    ny, nx = run.h.shape[1:]
    if row is None or col is None or not (0 <= row < ny and 0 <= col < nx):
        raise HTTPException(404, f"Cell r{row}c{col} outside grid {ny}x{nx}")
    return products.timeseries(run, row, col)


@app.get("/runs/{run_id}/export/geojson", responses=ERR)
def export_geojson(run_id: str, date_local: str = Query(..., alias="date"),
                   threshold_m: float = 0.10, min_depth_m: float = 0.01):
    run = _run(run_id)
    return JSONResponse(products.geojson(run, _day(run, date_local), threshold_m, min_depth_m),
                        media_type="application/geo+json")


@app.get("/runs/{run_id}/export/geotiff", responses=ERR)
def export_geotiff(run_id: str, date_local: str = Query(..., alias="date")):
    run = _run(run_id)
    d = _day(run, date_local)
    data = products.geotiff(run, d)
    if data is None:
        raise HTTPException(404, "No snapshots in this local day")
    return Response(data, media_type="image/tiff", headers={
        "Content-Disposition": f'attachment; filename="{run_id}_{d}_max_depth_m.tif"'})


@app.get("/simulations/{run_id}/streets", responses=ERR)
@app.get("/runs/{run_id}/streets", responses=ERR, include_in_schema=False)
def streets(run_id: str, date_local: str = Query(..., alias="date")):
    """GeoJSON FeatureCollection of street segments (WGS84 LineStrings) with depth stats."""
    run = _run(run_id)
    return JSONResponse(streets_geojson(run, _day(run, date_local)),
                        media_type="application/geo+json")


def _mitigate(run_id: str, scenarios):
    run = _run(run_id)
    try:
        return mit.compare(run, scenarios)
    except NotImplementedError as e:
        raise HTTPException(501, str(e)) from None
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise HTTPException(409, f"Invalid scenario: {e}") from None


@app.get("/simulations/{run_id}/mitigation", responses=ERR)
def mitigation_get(run_id: str):
    """Default placeholder drain scenarios vs baseline. Model scenarios, not guarantees."""
    return _mitigate(run_id, None)


@app.post("/simulations/{run_id}/mitigation", responses=ERR)
def mitigation_post(run_id: str, body: dict | None = None):
    """Body: {"scenarios": [{"name": str, "levers": [{"kind": drain|suds|tank|green_roof,
    "cells": "all" | [[row, col], ...], "params": {...}}]}]}"""
    return _mitigate(run_id, (body or {}).get("scenarios"))


@app.get("/simulations/{run_id}/hotspots", responses=ERR)
def hotspots_get(run_id: str, date_local: str = Query(..., alias="date"),
                 limit: int = Query(10, ge=1, le=200), include_mitigation: bool = False):
    """Hotspots ranked by score = peak_depth_m x minutes_above_0.10m (simulated only)."""
    from bcnflood.api import hotspots as hs
    run = _run(run_id)
    d = _day(run, date_local)
    mitig = None
    if include_mitigation:
        try:
            g = mit._inputs(run)
        except NotImplementedError as e:
            raise HTTPException(501, str(e)) from None
        mitig = {sc["name"]: mit._run_scenario(g, mit._levers(sc["levers"], g.dem_m.shape))
                 for sc in mit.DEFAULT_SCENARIOS}
    try:
        fc = hs.hotspots(run, d, limit, mitig)
    except NotImplementedError as e:
        raise HTTPException(501, str(e)) from None
    return JSONResponse(fc, media_type="application/geo+json")


@app.get("/health")
def health():
    inv = load_inventory()
    counts = {s.value: 0 for s in DatasetStatus}
    for d in inv.datasets:
        counts[d.status.value] += 1
    return {"status": "ok", "version": __version__, "time_utc": datetime.now(UTC).isoformat(),
            "simulation_results_available": False, "dataset_status_counts": counts,
            "release_gate": "CLOSED: required inputs not APPROVED; no Barcelona run performed"}


@app.get("/datasets", response_model=DatasetInventory)
def datasets(status: DatasetStatus | None = None, category: str | None = None):
    inv = load_inventory()
    inv.datasets = [d for d in inv.datasets
                    if (status is None or d.status == status)
                    and (category is None or d.category == category)]
    return inv


def _check_day(day: str):
    if day not in VALID_DAYS:
        raise HTTPException(404, f"Day {day} outside modelled period 2026-10-02..2026-10-07")


def _no_run():
    raise HTTPException(409, "No validated Barcelona simulation exists: input datasets are not "
                             "APPROVED and the scientific release gate is closed (see /datasets).")


@app.get("/days")
def days():
    return {"days": sorted(VALID_DAYS), "timezone": "Europe/Madrid",
            "status": {d: "NOT_RUN" for d in sorted(VALID_DAYS)}}


@app.get("/days/{day}/summary")
def day_summary(day: str):
    _check_day(day)
    _no_run()


@app.get("/days/{day}/cells")
def day_cells(day: str):
    _check_day(day)
    _no_run()


@app.get("/days/{day}/streets")
def day_streets(day: str):
    _check_day(day)
    raise HTTPException(501, "Street aggregation not implemented (Milestone 6).")


@app.get("/exports/{fmt}")
def exports(fmt: str):
    raise HTTPException(501, f"Geospatial export '{fmt}' not implemented (Milestone 6).")
