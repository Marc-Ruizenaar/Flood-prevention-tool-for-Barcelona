"""Build the training table: one row per (street segment x storm).

Writes ml/out/dataset.csv and ml/out/test_points.csv.

Run from the repo root:  ml/.venv/Scripts/python ml/build_dataset.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from config import (EDGE_DEPTH_M, EDGE_DISTANCE_M, BLOCK_M, GEOJSON_DIR, HOTSPOTS_DIR, LABEL_DEPTH_M,
                    N_RANDOM_POINTS, OUT, RANDOM_SEED, STORM_DATES, STORM_HOURS, STREETS_DIR,
                    TRAINED_DRAINAGE_MM_H)
from geo import block_ids, densify, feature_point, line_midpoint, read_json, to_xy
from terrain import Terrain


def excess_rain(rain_mm, drainage_mm_h, storm_hours=STORM_HOURS):
    """Rain left after the drains have worked for storm_hours at their capacity."""
    return np.maximum(0.0, np.asarray(rain_mm, dtype=float) - drainage_mm_h * storm_hours)


def make_label(depth_m):
    """1 when the simulated max depth reaches LABEL_DEPTH_M (moderate or worse), else 0."""
    return (np.asarray(depth_m, dtype=float) >= LABEL_DEPTH_M).astype(int)


def storm_rain_mm(date: str) -> float:
    """Day rain total used to force the physics model (hotspots file, model_forcing_rain)."""
    h = read_json(HOTSPOTS_DIR / f"{date}.json")
    return float(h["features"][0]["properties"]["model_forcing_rain"]["value"])


def load_segments(date: str):
    fc = read_json(STREETS_DIR / f"{date}.json")
    rows = []
    for f in fc["features"]:
        p = f["properties"]
        lon, lat = line_midpoint(f["geometry"]["coordinates"])
        rows.append({
            "segment_id": p["segment_id"],
            "name": p.get("name") or "",
            "lon": lon, "lat": lat,
            "depth_m": float(p["max_depth_m"]),
            "flood_class": p["flood_class"],
        })
    return pd.DataFrame(rows), fc


def street_bbox(fc):
    xs, ys = [], []
    for f in fc["features"]:
        for c in f["geometry"]["coordinates"]:
            xs.append(c[0])
            ys.append(c[1])
    return min(xs), min(ys), max(xs), max(ys)


def buried_stream_tree():
    fc = read_json(GEOJSON_DIR / "buried-streams.geojson")
    pts = []
    for f in fc["features"]:
        g = f["geometry"]
        if g["type"] == "LineString":
            lines = [g["coordinates"]]
        elif g["type"] == "MultiLineString":
            lines = g["coordinates"]
        else:  # Point features are labels, not stream lines
            continue
        for line in lines:
            if len(line) >= 2:
                pts.append(densify(line, 5.0))
    return cKDTree(np.vstack(pts))


def reported_places(bbox):
    """Reported places inside the street-data box: RESCCUE hotspots, sewer T10 stress, Oct 2026 proof."""
    w, s, e, n = bbox
    out = []
    for fname, layer in [("resccue-hotspots", "resccue"), ("sewer-t10-stress", "sewer_t10"),
                         ("proof-oct2026", "proof_oct2026")]:
        fc = read_json(GEOJSON_DIR / f"{fname}.geojson")
        for f in fc["features"]:
            pt = feature_point(f)
            if pt is None:
                continue
            if w <= pt[0] <= e and s <= pt[1] <= n:
                out.append({"kind": "reported", "layer": layer,
                            "name": f["properties"].get("name", ""), "lon": pt[0], "lat": pt[1]})
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    per_day = {}
    fc0 = None
    for d in STORM_DATES:
        df, fc = load_segments(d)
        per_day[d] = df
        fc0 = fc0 or fc
    ids0 = per_day[STORM_DATES[0]]["segment_id"].tolist()
    for d in STORM_DATES[1:]:
        assert per_day[d]["segment_id"].tolist() == ids0, "segment order differs between days"

    bbox = street_bbox(fc0)
    w, s, e, n = bbox
    print("street bbox", bbox)

    base = per_day[STORM_DATES[0]][["segment_id", "name", "lon", "lat"]].copy()
    x, y = to_xy(base["lon"], base["lat"])
    base["x_m"], base["y_m"] = x, y
    x_w, y_s = to_xy(w, s)
    x_e, y_n = to_xy(e, n)
    base["edge_dist_m"] = np.minimum.reduce([x - float(x_w), float(x_e) - x, y - float(y_s), float(y_n) - y])
    base["block"] = block_ids(x, y, float(x_w), float(y_s), BLOCK_M)

    print("building terrain (downloads tiles on first run) ...")
    terr = Terrain(bbox)
    print(f"mosaic {terr.raw.shape}, cell {terr.dem_obj.cell:.2f} m, sea cells {terr.sea_cells}")
    s_ = terr.sample(base["lon"].to_numpy(), base["lat"].to_numpy())
    for k in ["elevation_m", "slope_pct", "log_flow_acc", "twi", "depression_depth_m", "dist_sea_m"]:
        base[k] = s_[k]
    assert bool(np.all(s_["inside"])), "some segments fall outside the DEM mosaic"
    tree = buried_stream_tree()
    dist, _ = tree.query(np.column_stack([x, y]))
    base["dist_buried_stream_m"] = dist

    frames = []
    n_excluded = 0
    for d in STORM_DATES:
        df = per_day[d]
        rain = storm_rain_mm(d)
        t = base.copy()
        t["date"] = d
        t["depth_m"] = df["depth_m"].to_numpy()
        t["flood_class"] = df["flood_class"].to_numpy()
        t["label"] = make_label(t["depth_m"])
        t["rain_mm"] = rain
        t["drainage_mm_h"] = TRAINED_DRAINAGE_MM_H
        t["storm_hours"] = STORM_HOURS
        t["excess_rain_mm"] = excess_rain(rain, TRAINED_DRAINAGE_MM_H)
        t["excluded_edge_ponding"] = ((d == "2026-10-03") & (t["depth_m"] > EDGE_DEPTH_M) &
                                      (t["edge_dist_m"] < EDGE_DISTANCE_M))
        n_excluded += int(t["excluded_edge_ponding"].sum())
        frames.append(t)
    data = pd.concat(frames, ignore_index=True)
    data.to_csv(OUT / "dataset.csv", index=False)
    print(f"dataset rows {len(data)}, excluded edge-ponded rows {n_excluded}")
    print(data.groupby("date")[["label", "excluded_edge_ponding"]].sum())

    # test points: reported places and 3000 random points inside the box (seed 42)
    pts = reported_places(bbox)
    rng = np.random.default_rng(RANDOM_SEED)
    rl = w + rng.random(N_RANDOM_POINTS) * (e - w)
    rb = s + rng.random(N_RANDOM_POINTS) * (n - s)
    for lo, la in zip(rl, rb):
        pts.append({"kind": "random", "layer": "random", "name": "", "lon": lo, "lat": la})
    tp = pd.DataFrame(pts)
    tp["x_m"], tp["y_m"] = to_xy(tp["lon"], tp["lat"])
    tp.to_csv(OUT / "test_points.csv", index=False)
    print(tp.groupby(["kind", "layer"]).size())


if __name__ == "__main__":
    main()
