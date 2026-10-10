"""Small geometry helpers. Local metric plane, no external GIS libraries."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

R_EARTH_M = 6371008.8
LAT0 = 41.385
LON0 = 2.155
_KX = R_EARTH_M * math.cos(math.radians(LAT0)) * math.pi / 180.0
_KY = R_EARTH_M * math.pi / 180.0


def to_xy(lon, lat):
    """lon/lat degrees -> local metres (x east, y north). Accepts arrays."""
    return (np.asarray(lon, dtype=float) - LON0) * _KX, (np.asarray(lat, dtype=float) - LAT0) * _KY


def to_lonlat(x, y):
    return np.asarray(x, dtype=float) / _KX + LON0, np.asarray(y, dtype=float) / _KY + LAT0


def line_midpoint(coords):
    """Point halfway along a polyline, by length (planar, local metres)."""
    pts = np.array(coords, dtype=float)
    x, y = to_xy(pts[:, 0], pts[:, 1])
    seg = np.hypot(np.diff(x), np.diff(y))
    total = float(seg.sum())
    if total == 0:
        return float(pts[0, 0]), float(pts[0, 1])
    half = total / 2.0
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    i = int(np.searchsorted(cum, half, side="right") - 1)
    i = min(i, len(seg) - 1)
    t = (half - cum[i]) / seg[i] if seg[i] > 0 else 0.0
    lon = pts[i, 0] + t * (pts[i + 1, 0] - pts[i, 0])
    lat = pts[i, 1] + t * (pts[i + 1, 1] - pts[i, 1])
    return float(lon), float(lat)


def densify(coords, step_m=5.0):
    """Points along a polyline at most step_m apart, in local metres."""
    pts = np.array(coords, dtype=float)
    x, y = to_xy(pts[:, 0], pts[:, 1])
    out = [(x[0], y[0])]
    for i in range(len(x) - 1):
        d = math.hypot(x[i + 1] - x[i], y[i + 1] - y[i])
        n = max(1, int(math.ceil(d / step_m)))
        for k in range(1, n + 1):
            t = k / n
            out.append((x[i] + t * (x[i + 1] - x[i]), y[i] + t * (y[i + 1] - y[i])))
    return np.array(out)


def block_ids(x, y, x0, y0, block_m):
    """Square block id (int) for points; blocks are block_m wide."""
    bx = np.floor((np.asarray(x) - x0) / block_m).astype(int)
    by = np.floor((np.asarray(y) - y0) / block_m).astype(int)
    return bx * 10000 + by


def greedy_top(p, x, y, n=10, spread_m=200.0):
    """Indices of the n highest-p points that are at least spread_m apart (greedy)."""
    order = np.argsort(-np.asarray(p, dtype=float), kind="stable")
    chosen: list[int] = []
    for i in order:
        if all(math.hypot(x[i] - x[j], y[i] - y[j]) >= spread_m for j in chosen):
            chosen.append(int(i))
            if len(chosen) == n:
                break
    return chosen


def feature_point(feature):
    """Point for a GeoJSON feature: Point as is, Polygon by vertex mean of the outer ring."""
    g = feature.get("geometry") or {}
    if g.get("type") == "Point":
        return float(g["coordinates"][0]), float(g["coordinates"][1])
    if g.get("type") == "Polygon":
        ring = g["coordinates"][0]
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring = ring[:-1]
        return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    return None


def read_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)
