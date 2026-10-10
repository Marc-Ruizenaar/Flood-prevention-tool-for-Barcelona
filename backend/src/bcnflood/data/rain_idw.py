"""Inverse-distance-weighted (IDW) rainfall at a point. Output kind: ESTIMATE.

Method:
* Coordinates are planar EPSG:25831 metres. Distance is Euclidean,
  d_i = sqrt((x - x_i)^2 + (y - y_i)^2).
* Stations whose value is missing (None or NaN) are excluded BEFORE neighbour
  selection. The k nearest of the remaining stations are used.
* Weights are w_i = d_i^-power / sum_j d_j^-power (default power = 2), so the
  weights of the stations used always sum to 1 (renormalised after exclusions).
* Coincident point: if some station lies within ``coincident_tol_m`` (default 1 m)
  of the target, that station's value is returned with weight 1. If several
  valid stations are coincident, their plain mean is returned.
* If no station has a valid value, the result is missing (value=None), never 0.

Caveats: IDW ignores orography and storm structure, and with only 4 gauges
the field is very coarse. Values never fall outside the range of the stations used.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field

DEFAULT_POWER = 2.0
DEFAULT_K = 4
KIND = "estimate"
METHOD = "IDW, EPSG:25831 Euclidean, w=d^-p renormalised over valid stations"


@dataclass(frozen=True)
class Station:
    id: str
    x: float  # EPSG:25831 easting, m
    y: float  # EPSG:25831 northing, m


@dataclass
class IdwResult:
    value: float | None  # None = missing (no valid station)
    stations: list[str] = field(default_factory=list)
    distances_m: list[float] = field(default_factory=list)
    weights: list[float] = field(default_factory=list)
    excluded_missing: list[str] = field(default_factory=list)
    coincident: bool = False
    kind: str = KIND
    method: str = METHOD
    power: float = DEFAULT_POWER


def _missing(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v))


def idw_point(x: float, y: float, stations: list[Station],
              values: Mapping[str, float | None], power: float = DEFAULT_POWER,
              k: int = DEFAULT_K, coincident_tol_m: float = 1.0) -> IdwResult:
    """IDW estimate at (x, y) in EPSG:25831 from ``values`` keyed by station id."""
    if power <= 0:
        raise ValueError("power must be > 0")
    if k < 1:
        raise ValueError("k must be >= 1")
    excluded = [s.id for s in stations if _missing(values.get(s.id))]
    valid = [(math.hypot(x - s.x, y - s.y), s) for s in stations
             if not _missing(values.get(s.id))]
    if not valid:
        return IdwResult(None, excluded_missing=excluded, power=power)
    valid.sort(key=lambda t: t[0])
    co = [(d, s) for d, s in valid if d <= coincident_tol_m]
    if co:
        w = 1.0 / len(co)
        return IdwResult(sum(float(values[s.id]) for _, s in co) / len(co),
                         [s.id for _, s in co], [d for d, _ in co], [w] * len(co),
                         excluded, True, power=power)
    near = valid[:k]
    raw = [d ** -power for d, _ in near]
    tot = sum(raw)
    w = [r / tot for r in raw]
    val = sum(wi * float(values[s.id]) for wi, (_, s) in zip(w, near, strict=True))
    return IdwResult(val, [s.id for _, s in near], [d for d, _ in near], w, excluded,
                     False, power=power)


def load_stations(path: str = "manifests/xema_stations_g1.json") -> list[Station]:
    import json

    return [Station(s["id"], s["x_25831"], s["y_25831"])
            for s in json.load(open(path))["stations"]]
