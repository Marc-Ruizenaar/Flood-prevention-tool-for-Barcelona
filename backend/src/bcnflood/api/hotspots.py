"""Hotspots (M2-A5-06, owned by Agent 5). Ranked PURELY on simulated numbers, never chosen by
hand or from reports:

    score = peak_depth_m * minutes_above_0.10m      (per cell, per local day; unit m*min)

Cells are sorted by descending score (ties: deeper first). A cell is skipped when it lies within
DEDUP_M (100 m) of a higher-ranked hotspot. Diagnostics that are not available yet are null and
listed in `unavailable` with the reason."""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

from bcnflood.api.products import day_index, to_wgs84
from bcnflood.api.runstore import StoredRun, load_run
from bcnflood.api.streets import _cells_on, flood_class, load_segments

DEDUP_M = 100.0
SCORE_FORMULA = "score = peak_depth_m * minutes_above_0.10m (unit m*min, simulated)"
G1_STATIONS = Path(__file__).resolve().parents[3] / "manifests" / "xema_stations_g1.json"
IDW_LABEL = "IDW estimate from 4 gauges, unvalidated for 3-7 Oct"
_D8 = [(-1, 0, "N"), (-1, 1, "NE"), (0, 1, "E"), (1, 1, "SE"), (1, 0, "S"), (1, -1, "SW"),
       (0, -1, "W"), (-1, -1, "NW")]
MADRID = ZoneInfo("Europe/Madrid")


def _inputs(run: StoredRun):
    p = run.meta.get("inputs_pkl")
    if not p:
        return None
    from bcnflood.solver.launch import load_inputs
    return load_inputs(p)


def _day_station_totals(g, run: StoredRun, d: date) -> dict | None:
    """Per-gauge rain depth [mm] over local day d, from the run forcing columns. Needs meta
    rain_station_ids (column order of GridInputs.rain_mm). An interval with NaN gives None."""
    ids = run.meta.get("rain_station_ids")
    if g is None or not ids:
        return None
    a, b = run.window(d)
    ts = g.rain_times_utc
    inside = np.array([(a <= t0) and (t1 <= b) for t0, t1 in zip(ts[:-1], ts[1:], strict=True)])
    tot = np.asarray(g.rain_mm, float)[inside].sum(axis=0)
    return {sid: (None if not np.isfinite(v) else float(v)) for sid, v in zip(ids, tot,
                                                                               strict=True)}


def local_rain_idw(values: dict | None, x: float, y: float, reason: str | None = None) -> dict:
    """IDW (Agent 1 data.rain_idw, power 2, k 4) of per-gauge day totals at (x, y) EPSG:25831."""
    out = {"label": IDW_LABEL, "day_total": {"value": None, "unit": "mm", "kind": "estimate"},
           "stations": [], "distances_m": [], "weights": [], "method": None, "reason": reason}
    try:
        from bcnflood.data.rain_idw import idw_point, load_stations
    except ImportError:
        out["reason"] = "data.rain_idw (M2-A1-08) not available"
        return out
    if values is None:
        out["reason"] = reason or "no per-gauge rainfall for this run"
        return out
    if not G1_STATIONS.exists():
        out["reason"] = f"station file missing: {G1_STATIONS}"
        return out
    res = idw_point(x, y, load_stations(str(G1_STATIONS)), values, power=2.0, k=4)
    out.update(stations=res.stations, distances_m=[round(v, 1) for v in res.distances_m],
               weights=res.weights, method=res.method, excluded_missing=res.excluded_missing)
    out["day_total"]["value"] = res.value
    out["day_total"]["kind"] = res.kind
    if res.value is None:
        out["reason"] = "all gauges missing for this day"
    return out


def _local_rain(g, run: StoredRun, d: date, r: int, c: int):
    """Rain depth on the cell during local day d from the run forcing:
    sum_s w_s(cell) * rain_s over intervals inside the day [mm]."""
    if g is None:
        return None
    a, b = run.window(d)
    ts = g.rain_times_utc
    inside = np.array([(a <= t0) and (t1 <= b) for t0, t1 in zip(ts[:-1], ts[1:], strict=True)])
    w = np.asarray(g.station_weights, float)
    wc = w if w.ndim == 1 else w[:, r, c]
    return float((np.asarray(g.rain_mm, float)[inside] @ wc).sum())


def _seg_dist(px, py, coords) -> float:
    best = np.inf
    for (xa, ya), (xb, yb) in zip(coords[:-1], coords[1:], strict=True):
        vx, vy = xb - xa, yb - ya
        len2 = vx * vx + vy * vy
        t = 0.0 if len2 == 0 else max(0.0, min(1.0, ((px - xa) * vx + (py - ya) * vy) / len2))
        best = min(best, float(np.hypot(px - xa - t * vx, py - ya - t * vy)))
    return best


def _d8_receivers(z, dx):
    ny, nx = z.shape
    rec = -np.ones((ny, nx), int)
    best = np.zeros((ny, nx))
    for dy, dxx, _ in _D8:
        for i in range(ny):
            for j in range(nx):
                a, b = i + dy, j + dxx
                if 0 <= a < ny and 0 <= b < nx:
                    s = (z[i, j] - z[a, b]) / (dx * np.hypot(dy, dxx))
                    if s > best[i, j]:
                        best[i, j], rec[i, j] = s, a * nx + b
    return rec


def _upstream(rec, r, c, nx) -> set[int]:
    donors: dict[int, list[int]] = {}
    for k, v in enumerate(rec.ravel()):
        if v >= 0:
            donors.setdefault(int(v), []).append(k)
    seen, stack = set(), [r * nx + c]
    while stack:
        k = stack.pop()
        for dnr in donors.get(k, []):
            if dnr not in seen:
                seen.add(dnr)
                stack.append(dnr)
    return seen


def _d8_inflow_direction(z, r, c):
    """DEM CROSS-CHECK ONLY: compass direction of the highest D8 neighbour (no simulated flow).
    The served main_inflow_direction comes from the solver per-face inflow instead."""
    ny, nx = z.shape
    best, lab = 0.0, None
    for dy, dxx, name in _D8:
        a, b = r + dy, c + dxx
        if 0 <= a < ny and 0 <= b < nx and z[a, b] - z[r, c] > best:
            best, lab = z[a, b] - z[r, c], name
    return lab


def _q(v, unit, kind="simulated"):
    return {"value": None if v is None else float(v), "unit": unit, "kind": kind}


FLUX_DIRS = {"N": (-1, 0), "E": (0, 1), "S": (1, 0), "W": (0, -1)}  # in_N comes from row-1
DIR_NAMES = {0: "N", 1: "E", 2: "S", 3: "W"}
UPSTREAM_FRACTION = 0.05  # a face counts as upstream if it brings >= 5 % of the cell inflow


def flux_upstream(f: dict, r: int, c: int, max_cells: int = 20000) -> set[tuple[int, int]] | None:
    """Cells upstream of (r, c) by SIMULATED per-face cumulative inflow over the local day
    (M2-A2-06 day inflow_{N,E,S,W}_m3). Follows each face carrying >= 5 % of a cell's inflow."""
    if not all(f"inflow_{k}_m3" in f for k in FLUX_DIRS):
        return None
    inf = {k: f[f"inflow_{k}_m3"] for k in FLUX_DIRS}
    ny, nx = inf["N"].shape
    seen, stack = {(r, c)}, [(r, c)]
    while stack and len(seen) < max_cells:
        i, j = stack.pop()
        tot = sum(float(inf[k][i, j]) for k in FLUX_DIRS)
        if tot <= 0:
            continue
        for k, (di, dj) in FLUX_DIRS.items():
            a, b = i + di, j + dj
            if (0 <= a < ny and 0 <= b < nx and (a, b) not in seen
                    and inf[k][i, j] >= UPSTREAM_FRACTION * tot):
                seen.add((a, b))
                stack.append((a, b))
    return seen


def hotspots(run: StoredRun, d: date, limit: int = 10, mitigation: dict | None = None) -> dict:
    if run.grid is None:
        raise NotImplementedError("Hotspots need run_grid per-day fields (launcher layout).")
    f = run.grid[d.isoformat()]
    hmax, t10, t30, umax = (f["max_depth_m"], f["time_above_0_10m_s"],
                            f["time_above_0_30m_s"], f["max_speed_m_s"])
    score = hmax * (t10 / 60.0)
    ny, nx = hmax.shape
    order = sorted(zip(*np.nonzero(score > 0), strict=True),
                   key=lambda rc: (-score[rc], -hmax[rc]))
    picked = []
    for r, c in order:
        x, y = run.cell_xy(int(r), int(c))
        if all(np.hypot(x - px, y - py) > DEDUP_M for _, _, px, py in picked):
            picked.append((int(r), int(c), x, y))
        if len(picked) >= limit:
            break

    g = _inputs(run)
    dg = run.meta.get("diag") or {}
    unavailable = {}
    z = np.asarray(g.dem_m, float) if g is not None else None
    rec = _d8_receivers(z, run.meta["dx_m"]) if z is not None else None
    if z is None:
        unavailable["d8_crosscheck"] = "inputs.pkl not available for this run"
    has_flux = all(f"inflow_{k}_m3" in f for k in FLUX_DIRS)
    if not has_flux:
        unavailable["flux_inflow"] = "per-face inflow diagnostics (M2-A2-06) not in this run"
    bud_keys = ("rain_in_m", "roof_in_m", "lateral_in_m", "lateral_out_m", "infiltration_m",
                "drainage_m", "outflow_m", "tank_m", "storage_change_m")
    has_bud = all(f"budget_{k}" in dg for k in bud_keys)
    if not has_bud:
        unavailable["cell_budget"] = "per-cell budget (M2-A2-06) not in this run"
    for k, why in (("contributing_area_flux_m2", "simulated_contributing_area"),
                   ("slope_m_m", "local_slope"), ("depression_depth_m", "depression_depth"),
                   ("d8_accumulation_m2_crosscheck", "d8_contributing_area")):
        if k not in dg:
            unavailable[why] = f"{k} (M2-A2-06) not in this run"
    if "peak_time_utc_s" not in f:
        unavailable["peak_time"] = "per-day peak time (M2-A2-06) not in this run; snapshot max used"
    segs, stub = load_segments(run)
    seg_cells = [(s, set(_cells_on(run, s["coords"]))) for s in segs]
    scen = {k: load_run(v) for k, v in run.meta.get("drainage_scenarios", {}).items()}
    idx, _, _ = day_index(run, d)
    gauge_totals = _day_station_totals(g, run, d)
    area = run.meta["dx_m"] ** 2

    def streets_in(cells):
        return sorted({s.get("name") or s["id"] for s, cs in seg_cells if cs & cells})

    def dv(k, r, c):
        return float(dg[k][r, c]) if k in dg else None

    feats = []
    for rank, (r, c, x, y) in enumerate(picked, 1):
        (lon,), (lat,) = to_wgs84(run, [x], [y])
        near = min(segs, key=lambda s: _seg_dist(x, y, s["coords"])) if segs else None
        if "peak_time_utc_s" in f:  # per-day, per-step field: UTC = t0_utc + value; NaN = dry
            v = float(f["peak_time_utc_s"][r, c])
            peak_time = (None if not np.isfinite(v) else
                         (run.start_utc + timedelta(seconds=v)).astimezone(MADRID).isoformat())
            peak_res = "solver step"
        elif len(idx) and run.h.shape[0] > 1:
            k = int(idx[int(np.argmax(run.h[idx, r, c]))])
            peak_time = run.time_utc(k).astimezone(MADRID).isoformat()
            peak_res = f"snapshot ({float(np.median(np.diff(run.t))):.0f} s)"
        else:
            peak_time, peak_res = None, None
        # simulated inflow (primary)
        inflow_dir, by_dir, ups_streets = None, None, None
        if has_flux:
            by_dir = {k: _q(f[f"inflow_{k}_m3"][r, c], "m3") for k in FLUX_DIRS}
            code = int(f["dominant_inflow_dir"][r, c]) if "dominant_inflow_dir" in f else -1
            inflow_dir = DIR_NAMES.get(code)
            up = flux_upstream(f, r, c)
            ups_streets = streets_in(up - {(r, c)}) if up is not None else None
        # DEM cross-check (D8)
        d8 = None
        if rec is not None:
            ups_d8 = {divmod(k, nx) for k in _upstream(rec, r, c, nx)}
            d8 = {"label": "DEM cross-check only (D8 steepest descent), not the simulated flow",
                  "kind": "terrain_diagnostic",
                  "main_inflow_direction": _d8_inflow_direction(z, r, c),
                  "upstream_streets": streets_in(ups_d8),
                  "contributing_area": _q(dv("d8_accumulation_m2_crosscheck", r, c), "m2",
                                          "terrain_diagnostic")}
        spread = {k: (None if sr is None or sr.grid is None
                      else float(sr.grid[d.isoformat()]["max_depth_m"][r, c]))
                  for k, sr in scen.items()}
        vals = [v for v in spread.values() if v is not None]
        rain_mm = _local_rain(g, run, d, r, c)

        def b(k, r=r, c=c):
            return _q(float(dg[f"budget_{k}"][r, c]) * area, "m3") if has_bud else _q(None, "m3")
        best = None
        if mitigation is not None:
            opts = [(n, m[d.isoformat()][r, c] - hmax[r, c]) for n, m in mitigation.items()]
            if opts:
                n, dlt = min(opts, key=lambda o: o[1])
                best = {"scenario": n, "delta_peak_depth": _q(dlt, "m"),
                        "label": "model scenario, not a guarantee"}
        feats.append({"type": "Feature", "geometry": {"type": "Point",
                                                      "coordinates": [float(lon), float(lat)]},
                      "properties": {
            "date": d.isoformat(), "rank": rank, "cell_id": f"r{r}c{c}",
            "score": _q(score[r, c], "m*min"),
            "nearest_street": None if near is None else {
                "name": near.get("name"), "segment_id": near["id"],
                "distance_m": round(_seg_dist(x, y, near["coords"]), 2)},
            "local_rainfall": local_rain_idw(
                None if run.synthetic else gauge_totals, x, y,
                "SYNTHETIC run: forcing is not gauge data" if run.synthetic else None),
            "model_forcing_rain": _q(rain_mm, "mm", "assumption" if run.synthetic
                                     else "estimate"),
            "peak_depth_m": float(hmax[r, c]),
            "peak_time_local": peak_time, "peak_time_resolution": peak_res,
            "minutes_above_0.10m": float(t10[r, c] / 60), "minutes_above_0.30m":
                float(t30[r, c] / 60),
            "max_velocity_m_s": float(umax[r, c]) if hmax[r, c] >= 0.01 else None,
            "flood_class": flood_class(float(hmax[r, c])),
            "upstream_contributing_area": {
                "simulated": _q(dv("contributing_area_flux_m2", r, c), "m2"),
                "d8_cross_check": _q(dv("d8_accumulation_m2_crosscheck", r, c), "m2",
                                     "terrain_diagnostic")},
            "main_inflow_direction": inflow_dir,
            "inflow_by_direction": by_dir,
            "upstream_streets": ups_streets,
            "inflow_source": "simulated per-face cumulative inflow over the local day "
                             "(solver M2-A2-06)",
            "dem_crosscheck": d8,
            "local_slope": _q(dv("slope_m_m", r, c), "m/m", "terrain_diagnostic"),
            "depression_depth": _q(dv("depression_depth_m", r, c), "m", "terrain_diagnostic"),
            "drainage_scenario_spread": {"max_depth_m": spread,
                                         "range_m": (max(vals) - min(vals)) if vals else None,
                                         "unit": "m", "kind": "assumption"},
            "explanation": {
                "budget_period": "whole run (per-cell budget is cumulative over the run)",
                "rain_in": b("rain_in_m"), "roof_in": b("roof_in_m"),
                "runoff_out": b("lateral_out_m"), "inflow": b("lateral_in_m"),
                "drainage_out": b("drainage_m"), "infiltration_out": b("infiltration_m"),
                "boundary_outflow": b("outflow_m"), "tank": b("tank_m"),
                "storage_end": b("storage_change_m"),
                "residual_rel": _q(dv("budget_residual_rel", r, c), "1"),
                "stored_depth_peak": _q(hmax[r, c], "m"),
                "best_mitigation": best,
                "best_mitigation_note": None if mitigation is not None else
                "request with include_mitigation=true (re-runs the solver)"},
            "uncertainty_status": "UNVALIDATED: synthetic, not calibrated" if run.synthetic
            else "UNVALIDATED: not calibrated against observations",
            "data_quality": ("SYNTHETIC run" if run.synthetic else "model run")
            + ("; stub street network" if stub else "; OSM streets (filtered road classes)"),
            "provenance": {"run_id": run.run_id, "source": run.meta.get("source",
                                                                        "solver.grid.run_grid"),
                           "selection": SCORE_FORMULA + f"; dedup {DEDUP_M:.0f} m"},
            "unavailable": dict(unavailable)}})
    return {"type": "FeatureCollection", "features": feats, "properties": {
        "run_id": run.run_id, "date": d.isoformat(), "crs": "EPSG:4326",
        "synthetic": run.synthetic, "score_formula": SCORE_FORMULA, "dedup_m": DEDUP_M,
        "limit": limit}}
