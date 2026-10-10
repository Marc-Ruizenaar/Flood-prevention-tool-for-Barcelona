"""Builder for the real Barcelona 30 m GridInputs (Agent 2). BUILD AND SAVE ONLY: this module
never runs the solver. The launch waits for gates G1-G8.

Sources (all read-only, paths relative to the repo):
  DEM     manifests/raw/g2/bcn_mdt05_25831.tif (5 m, EPSG:25831; Agent 1, G2)
  surface manifests/derived/landcover/bcn_{class,manning_n,ga_ks_cm_h,ga_psi_cm,ga_porosity,
          ga_eff_porosity}_25831_5m.tif (Agent 1, 7888c59; kind ESTIMATE)
  roofs   manifests/derived/osm/bcn_buildings_osm_25831.geojson.gz (Agent 1, 6c900e8)
  rain    manifests/raw/g1/xema_<S>_20261001T22Z_20261007T22Z.json, var 35 (mm per 30 min,
          UTC, label = interval START; Agent 1 G1 evidence) + manifests/xema_stations_g1.json

Aggregation 5 m -> 30 m (factor 6, blocks aligned to the DEM origin):
  * active    : >= 50 % of the 36 sub-cells have valid DEM.
  * dem_m     : mean of valid sub-cells.
  * building  : roofs rasterised at 5 m (cell centre in polygon). building_fraction = roof
                sub-cells / valid sub-cells. The solver takes a MASK: building_mask =
                building_fraction >= BUILDING_THRESHOLD (0.5, ASSUMPTION). Cells below the
                threshold stay open; their roof share is not blocked but its rain is applied
                to the cell (equivalent to roof drainage into that cell).
  * manning_n : area-weighted mean over valid NON-ROOF sub-cells (all valid if all roof).
  * Ks        : area-weighted mean over non-roof sub-cells with sealed Ks = 0, i.e.
                Ks_cell = pervious_fraction * mean(Ks_pervious). Conservative (sealed share
                cannot infiltrate).
  * psi, dtheta: from PERVIOUS sub-cells only (Ks > 0 and finite psi/porosity), mean; 0 when
                a cell has no pervious sub-cell (Ks is then 0, so they are unused). This avoids
                the NaN/NoData psi and porosity of sealed classes.
  * dtheta    : effective porosity (ASSUMPTION: initially dry soil, theta_i = residual).
  * pervious_mask = Ks > 0.
All surface parameters keep kind=ESTIMATE (Agent 1); thresholds are ASSUMPTIONS.

Rain: stations X4, X8, D5, WU; nearest-station (Thiessen) weights at 30 m cell centres.
Records are provisional (codi_estat blank, see G1: CONDITIONAL). D5 has 4 missing intervals
(2026-10-03T21:30..23:00Z). Orchestrator decision: D5 stays MISSING there (its rain_mm
column is 0 with weight 0); for those intervals only, D5's Thiessen cells get IDW (power 2)
weights over the stations with data (X4/X8/WU), via data.rain_idw.idw_point, as
per-interval weight overrides (station_weights_by_interval). Label: GAP_LABEL. The fill
volume per interval is in the report and in summary.json (rain_notes).
"""
from __future__ import annotations

import gzip
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np

from .grid import GridInputs

REPO = Path(__file__).resolve().parents[3]
FACTOR = 6
BUILDING_THRESHOLD = 0.5
STATIONS = ("X4", "X8", "D5", "WU")
T0 = datetime(2026, 10, 1, 22, tzinfo=UTC)
N_INT = 288  # 30-min intervals to 2026-10-07T22:00Z
STEP = timedelta(minutes=30)


def block(a: np.ndarray, f: int) -> np.ndarray:
    ny, nx = (a.shape[0] // f) * f, (a.shape[1] // f) * f
    return a[:ny, :nx].reshape(ny // f, f, nx // f, f).sum(axis=(1, 3))


def aggregate_surface(dem, valid, roof, n, ks_cm_h, psi_cm, eff_por, f=FACTOR,
                      threshold=BUILDING_THRESHOLD) -> dict:
    """Pure aggregation (see module docstring). Inputs are 5 m arrays; NoData already NaN
    (or masked via `valid`). Returns 30 m arrays in SI units."""
    valid = valid & np.isfinite(dem)
    nv = block(valid.astype(float), f)
    active = nv >= 0.5 * f * f
    dem_m = block(np.where(valid, dem, 0.0), f) / np.maximum(nv, 1)
    roofv = roof & valid
    nroof = block(roofv.astype(float), f)
    bfrac = np.where(nv > 0, nroof / np.maximum(nv, 1), 0.0)
    ground = valid & ~roofv
    ng = block(ground.astype(float), f)
    n_ok = ground & np.isfinite(n)
    n_g = block(np.where(n_ok, n, 0.0), f) / np.maximum(block(n_ok.astype(float), f), 1)
    n_all_ok = valid & np.isfinite(n)
    n_all = block(np.where(n_all_ok, n, 0.0), f) / np.maximum(block(n_all_ok.astype(float), f), 1)
    manning = np.where(block(n_ok.astype(float), f) > 0, n_g, n_all)
    ks = np.where(ground & np.isfinite(ks_cm_h), ks_cm_h, 0.0)
    ks_cell = block(ks, f) / np.maximum(ng, 1)  # sealed = 0 counted -> pervious-fraction scaling
    perv = (ground & np.isfinite(ks_cm_h) & (ks_cm_h > 0) & np.isfinite(psi_cm)
            & np.isfinite(eff_por))
    npv = block(perv.astype(float), f)
    psi = np.where(npv > 0, block(np.where(perv, psi_cm, 0.0), f) / np.maximum(npv, 1), 0.0)
    dth = np.where(npv > 0, block(np.where(perv, eff_por, 0.0), f) / np.maximum(npv, 1), 0.0)
    ks_cell = np.where(npv > 0, ks_cell, 0.0)
    building = active & (bfrac >= threshold)
    manning = np.where(active, np.clip(manning, 0.0051, 0.49), 0.03)
    return {"active": active, "dem_m": np.where(active, dem_m, 0.0),
            "building_fraction": bfrac, "building_mask": building,
            "manning_n": manning,
            "ga_k_sat_m_s": np.where(active, ks_cell / 360000.0, 0.0),  # cm/h -> m/s
            "ga_psi_m": np.where(active, psi / 100.0, 0.0),
            "ga_delta_theta": np.where(active, dth, 0.0),
            "pervious_fraction": np.where(nv > 0, npv / np.maximum(nv, 1), 0.0)}


def read_xema(paths: dict[str, Path], t0=T0, n=N_INT) -> tuple[np.ndarray, dict]:
    """(n, n_st) mm per 30-min interval, NaN where missing; plus per-station QC counts."""
    out = np.full((n, len(paths)), np.nan)
    qc = {}
    for j, (st, p) in enumerate(paths.items()):
        recs = json.loads(Path(p).read_text())
        cnt = {"V": 0, "T": 0, "blank": 0}
        for r in recs:
            if str(r.get("codi_variable")) != "35" or r.get("codi_base", "SH") != "SH":
                continue
            ts = datetime.fromisoformat(r["data_lectura"].replace("Z", "")).replace(tzinfo=UTC)
            i = int((ts - t0) / STEP)
            if 0 <= i < n and (ts - t0) % STEP == timedelta(0):
                if not np.isnan(out[i, j]):
                    raise ValueError(f"duplicate {st} {ts}")
                out[i, j] = float(r["valor_lectura"])
                cnt[r.get("codi_estat") or "blank"] = cnt.get(r.get("codi_estat") or "blank",
                                                             0) + 1
        qc[st] = cnt
    return out, qc


def fill_missing_nearest(rain: np.ndarray, xy: np.ndarray, names) -> tuple[np.ndarray, list]:
    """Substitute NaN (missing) values from the nearest other station with data.
    NOT USED for the GridInputs (rejected by the Orchestrator); kept for the X8-copy
    sensitivity figure only. Returns filled array and a log of substitutions."""
    r = rain.copy()
    log = []
    d = np.hypot(*(xy[:, None, :] - xy[None, :, :]).transpose(2, 0, 1))
    for i, j in zip(*np.nonzero(np.isnan(rain)), strict=True):
        for k in np.argsort(d[j]):
            if k != j and np.isfinite(rain[i, k]):
                r[i, j] = rain[i, k]
                log.append({"interval": int(i), "station": names[j], "from": names[k],
                            "value_mm": float(rain[i, k])})
                break
        else:
            raise ValueError(f"no donor for interval {i}")
    return r, log


GAP_LABEL = "assumption: D5 gap 3 Oct 21:30-23:00Z filled by IDW of X4/X8/WU"


def idw_gap_fill(rain_raw, w, xcg, ycg, names, xy, act, cell_area, power=2.0):
    """Missing station values -> 0 with weight 0; that station's Thiessen cells get IDW
    weights over stations with data for that interval. Returns (rain, overrides, log)."""
    from bcnflood.data.rain_idw import Station, idw_point

    sts = [Station(n, float(x), float(y)) for n, (x, y) in zip(names, xy, strict=True)]
    rain = np.where(np.isnan(rain_raw), 0.0, rain_raw)
    over, log = {}, []
    for i in np.nonzero(np.isnan(rain_raw).any(axis=1))[0]:
        vals = {n: (None if np.isnan(rain_raw[i, j]) else float(rain_raw[i, j]))
                for j, n in enumerate(names)}
        wk = w.copy()
        for j in np.nonzero(np.isnan(rain_raw[i]))[0]:
            cells = (w[j] > 0) & act
            ys, xs = np.nonzero(cells)
            for y, x in zip(ys, xs, strict=True):
                res = idw_point(float(xcg[y, x]), float(ycg[y, x]), sts, vals, power=power)
                wk[:, y, x] = 0.0
                for sid, wt in zip(res.stations, res.weights, strict=True):
                    wk[names.index(sid), y, x] = wt
            depth = np.einsum("s,syx->yx", rain[i], wk)[cells]
            log.append({"interval": int(i), "station": names[j], "label": GAP_LABEL,
                        "cells": int(cells.sum()), "mean_fill_mm": float(depth.mean()),
                        "fill_volume_m3": float(depth.sum() * 1e-3 * cell_area)})
        over[int(i)] = wk
    return rain, over, log


def thiessen_weights(xc: np.ndarray, yc: np.ndarray, xy: np.ndarray) -> np.ndarray:
    d = (xc[None] - xy[:, 0, None, None]) ** 2 + (yc[None] - xy[:, 1, None, None]) ** 2
    near = d.argmin(axis=0)
    return np.stack([(near == k).astype(float) for k in range(len(xy))])


def build(out_path: Path | None = None, repo: Path = REPO) -> tuple[GridInputs, dict]:
    import rasterio
    import rasterio.features

    from .drainage import load_scenarios

    def rd(p):
        with rasterio.open(repo / p) as r:
            a = r.read(1).astype(float)
            if r.nodata is not None:
                a[a == r.nodata] = np.nan
            return a, r.transform, r.crs, r.shape

    dem, tr, crs, shape = rd("manifests/raw/g2/bcn_mdt05_25831.tif")
    lc = {k: rd(f"manifests/derived/landcover/bcn_{k}_25831_5m.tif")
          for k in ("class", "manning_n", "ga_ks_cm_h", "ga_psi_cm", "ga_porosity",
                    "ga_eff_porosity")}
    for k, (_, t2, c2, s2) in lc.items():
        if t2 != tr or s2 != shape or str(c2) != str(crs):
            raise ValueError(f"{k} grid differs from DEM grid")
    fc = json.load(gzip.open(repo / "manifests/derived/osm/bcn_buildings_osm_25831.geojson.gz"))
    geoms = [f["geometry"] for f in fc["features"] if f.get("geometry")]
    roof = rasterio.features.rasterize(((g, 1) for g in geoms), out_shape=shape, transform=tr,
                                       fill=0, dtype="uint8").astype(bool)
    valid = np.isfinite(dem)
    agg = aggregate_surface(dem, valid, roof, lc["manning_n"][0], lc["ga_ks_cm_h"][0],
                            lc["ga_psi_cm"][0], lc["ga_eff_porosity"][0])
    ny, nx = agg["active"].shape
    dx = abs(tr.a) * FACTOR
    xc = tr.c + (np.arange(nx) + 0.5) * dx
    yc = tr.f - (np.arange(ny) + 0.5) * dx
    xcg, ycg = np.meshgrid(xc, yc)
    st = json.loads((repo / "manifests/xema_stations_g1.json").read_text())["stations"]
    sxy = {s["id"]: (s["x_25831"], s["y_25831"]) for s in st}
    names = [s for s in STATIONS if s in sxy]
    xy = np.array([sxy[s] for s in names])
    paths = {s: repo / f"manifests/raw/g1/xema_{s}_20261001T22Z_20261007T22Z.json"
             for s in names}
    rain_raw, qc = read_xema(paths)
    w = thiessen_weights(xcg, ycg, xy)
    act = agg["active"]
    rain, w_by_k, fill = idw_gap_fill(rain_raw, w, xcg, ycg, names, xy, act, dx * dx)
    times = [T0 + i * STEP for i in range(N_INT + 1)]
    notes = {"label": GAP_LABEL, "fill": fill, "method": "data.rain_idw.idw_point weights "
             "(power 2) over stations with data, applied to the missing station's cells only",
             "status": "provisional (G1 CONDITIONAL)"}
    g = GridInputs(dem_m=agg["dem_m"], manning_n=agg["manning_n"],
                   ga_k_sat_m_s=agg["ga_k_sat_m_s"], ga_psi_m=agg["ga_psi_m"],
                   ga_delta_theta=agg["ga_delta_theta"], building_mask=agg["building_mask"],
                   dx_m=float(dx), crs="EPSG:25831", rain_times_utc=times, rain_mm=rain,
                   station_weights=w, drainage_scenario=load_scenarios()["mid"],
                   active_mask=agg["active"], pervious_mask=agg["ga_k_sat_m_s"] > 0,
                   snapshot_interval_s=3600.0, x0_m=float(tr.c), y0_m=float(tr.f),
                   rain_station_ids=list(names), station_weights_by_interval=w_by_k,
                   rain_notes=notes)
    # sensitivity: rain on the D5 Thiessen area, X8-copy (rejected) vs IDW (used)
    sens = {}
    if "D5" in names:
        jd = names.index("D5")
        d5 = (w[jd] > 0) & act
        copy_rain, _ = fill_missing_nearest(rain_raw, xy, names)
        idw_mm = sum(float(np.einsum("s,syx->yx", rain[i], w_by_k.get(i, w))[d5].mean())
                     for i in range(N_INT))
        copy_mm = float(copy_rain[:, jd].sum())
        sens = {"d5_cells": int(d5.sum()), "copy_x8_mm": copy_mm, "idw_mm": idw_mm,
                "copy_x8_m3": copy_mm * 1e-3 * dx * dx * int(d5.sum()),
                "idw_m3": idw_mm * 1e-3 * dx * dx * int(d5.sum())}
    notes["sensitivity_d5_area"] = sens
    act = agg["active"]
    report = {
        "kind": "build report (no simulation)", "dx_m": dx, "shape": [ny, nx],
        "x0_m": tr.c, "y0_m": tr.f, "active_cells": int(act.sum()),
        "building_cells": int(agg["building_mask"].sum()),
        "building_threshold": BUILDING_THRESHOLD,
        "building_fraction_mean_active": float(agg["building_fraction"][act].mean()),
        "roof_5m_cells": int(roof.sum()), "buildings": len(geoms),
        "pervious_cells": int((agg["ga_k_sat_m_s"][act] > 0).sum()),
        "stats": {k: {"min": float(np.min(v[act])), "max": float(np.max(v[act])),
                      "mean": float(np.mean(v[act])), "nan": int(np.isnan(v[act]).sum())}
                  for k, v in agg.items() if v.dtype.kind == "f"},
        "rain": {"stations": names, "qc_counts": qc, "gap_fill": fill, "label": GAP_LABEL,
                 "sensitivity_d5_area": sens,
                 "missing_raw": int(np.isnan(rain_raw).sum()),
                 "total_mm_per_station": dict(zip(names, map(float, rain.sum(0)), strict=True)),
                 "thiessen_cells": {s: int(w[k][act].sum()) for k, s in enumerate(names)},
                 "status": "provisional (G1 CONDITIONAL)"},
        "labels": {"surface": "ESTIMATE (Agent 1)", "aggregation": "ASSUMPTION (Agent 2)",
                   "rain_gap_fill": "ASSUMPTION"},
    }
    if out_path is not None:
        from .launch import save_inputs
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        save_inputs(g, out_path)
        out_path.with_suffix(".report.json").write_text(json.dumps(report, indent=1))
    return g, report


if __name__ == "__main__":
    import sys
    g, rep = build(Path(sys.argv[1]) if len(sys.argv) > 1 else
                   REPO / "outputs/inputs/bcn_30m.pkl")
    print(json.dumps(rep, indent=1))
