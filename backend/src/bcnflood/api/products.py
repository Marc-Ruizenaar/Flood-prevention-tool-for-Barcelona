"""Derived products from stored solver output (owned by Agent 5): per-day cells, timeseries,
GeoJSON and GeoTIFF. Every value comes from stored snapshots; nothing is invented."""
from __future__ import annotations

import io
from datetime import date

import numpy as np

from bcnflood.api.contract import (
    SIM,
    SYNTHETIC_WARNING,
    CellOutputV02,
    DailySummaryV02,
    TimeseriesPointV02,
    TimeseriesV02,
    daily_from_solver,
    q,
)
from bcnflood.api.runstore import StoredRun, solver_snapshots
from bcnflood.schemas import ValueKind
from bcnflood.solver.daily import daily_summaries

VELOCITY_NOTE = "max_velocity null: snapshots store depth only (no discharge)"


def day_index(run: StoredRun, d: date) -> tuple[np.ndarray, float, float]:
    a, b = (run.seconds(x) for x in run.window(d))
    # half-open [start, end): the boundary snapshot belongs to the next day (audit S1)
    return np.where((run.t >= a - 1e-6) & (run.t < b - 1e-6))[0], a, b


def daily(run: StoredRun) -> list[DailySummaryV02]:
    if run.grid is not None:
        from bcnflood.api.grid_adapter import daily_from_grid
        return daily_from_grid(run)
    snaps = solver_snapshots(run)
    days = run.days()
    edges = [run.seconds(run.window(days[0])[0])] + [run.seconds(run.window(d)[1]) for d in days]
    rows = daily_summaries(snaps, edges)
    return [daily_from_solver(r, run_id=run.run_id, date_local=d, timezone="Europe/Madrid",
                              window_utc=run.window(d), synthetic=run.synthetic,
                              drainage_capacity_m_s=run.meta["drainage_capacity_m_s"])
            for r, d in zip(rows, days, strict=True)]


def day_max(run: StoredRun, d: date):
    idx, _, _ = day_index(run, d)
    if len(idx) == 0:
        return None, idx
    return run.h[idx].max(axis=0), idx


def cells(run: StoredRun, d: date, threshold_m: float, min_depth_m: float) -> list[CellOutputV02]:
    if run.grid is not None:
        from bcnflood.api.grid_adapter import cells_from_grid
        return cells_from_grid(run, d, threshold_m, min_depth_m)
    hmax, idx = day_max(run, d)
    if hmax is None:
        return []
    dt_out = float(np.median(np.diff(run.t))) if len(run.t) > 1 else 0.0
    sub = run.h[idx]
    out = []
    for r, c in zip(*np.where(hmax >= min_depth_m), strict=True):
        x, y = run.cell_xy(int(r), int(c))
        k = int(np.argmax(sub[:, r, c]))
        out.append(CellOutputV02(
            cell_id=f"r{r}c{c}", x=q(x, "m"), y=q(y, "m"), crs=run.meta["crs"], date_local=d,
            max_depth=q(hmax[r, c], "m"), max_velocity=q(None, "m/s"),
            time_of_max_utc=run.time_utc(int(idx[k])),
            duration_above_threshold=q(float((sub[:, r, c] > threshold_m).sum()) * dt_out, "s"),
            threshold=q(threshold_m, "m", ValueKind.ASSUMPTION),
            uncertainty=("SYNTHETIC; " if run.synthetic else "") + VELOCITY_NOTE
            + f"; duration resolution {dt_out:.0f} s (snapshot interval)",
            provenance_run_id=run.run_id))
    return out


def timeseries(run: StoredRun, row: int, col: int) -> TimeseriesV02:
    x, y = run.cell_xy(row, col)
    pts = [TimeseriesPointV02(time_utc=run.time_utc(i), depth=q(run.h[i, row, col], "m", SIM),
                              domain_storage=q(run.storage[i], "m3", SIM))
           for i in range(len(run.t))]
    return TimeseriesV02(run_id=run.run_id, cell_id=f"r{row}c{col}", x=q(x, "m"), y=q(y, "m"),
                         crs=run.meta["crs"], synthetic=run.synthetic, points=pts,
                         warnings=[SYNTHETIC_WARNING] if run.synthetic else [])


def to_wgs84(run: StoredRun, xs, ys):
    from pyproj import Transformer
    t = Transformer.from_crs(run.meta["crs"], "EPSG:4326", always_xy=True)
    return t.transform(xs, ys)


def geojson(run: StoredRun, d: date, threshold_m: float, min_depth_m: float) -> dict:
    """Cell polygons (WGS84, RFC 7946) with depth >= min_depth_m on local day d."""
    half = run.meta["dx_m"] / 2
    feats = []
    for cell in cells(run, d, threshold_m, min_depth_m):
        x, y = cell.x.value, cell.y.value
        xs = [x - half, x + half, x + half, x - half, x - half]
        ys = [y - half, y - half, y + half, y + half, y - half]
        lon, lat = to_wgs84(run, xs, ys)
        feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [
            [[float(a), float(b)] for a, b in zip(lon, lat, strict=True)]]},
            "properties": {"cell_id": cell.cell_id, "date_local": d.isoformat(),
                           "max_depth": cell.max_depth.model_dump(),
                           "duration_above_threshold": cell.duration_above_threshold.model_dump(),
                           "threshold": cell.threshold.model_dump(),
                           "synthetic": run.synthetic, "run_id": run.run_id}})
    return {"type": "FeatureCollection", "features": feats,
            "properties": {"run_id": run.run_id, "date_local": d.isoformat(),
                           "synthetic": run.synthetic, "source_crs": run.meta["crs"]}}


def geotiff(run: StoredRun, d: date) -> bytes | None:
    """Single-band float32 GeoTIFF of max depth [m] on local day d, in the run CRS."""
    import rasterio
    from rasterio.transform import from_origin
    hmax, _ = day_max(run, d)
    if hmax is None:
        return None
    buf = io.BytesIO()
    with rasterio.MemoryFile() as mf:
        with mf.open(driver="GTiff", height=hmax.shape[0], width=hmax.shape[1], count=1,
                     dtype="float32", crs=run.meta["crs"], nodata=-9999.0,
                     transform=from_origin(run.meta["x0_m"], run.meta["y0_m"],
                                           run.meta["dx_m"], run.meta["dx_m"])) as ds:
            ds.write(hmax.astype("float32"), 1)
            ds.update_tags(units="m", kind="simulated", quantity="max_depth",
                           date_local=d.isoformat(), run_id=run.run_id,
                           synthetic=str(run.synthetic))
        buf.write(mf.read())
    return buf.getvalue()
