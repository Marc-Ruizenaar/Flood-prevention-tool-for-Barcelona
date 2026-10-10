"""M2-A2-06 terrain diagnostics for hotspot explanation (Agent 2). Computed once per run on
the DEM (no simulation). Labelled kind="terrain_diagnostic"; D8 is a CROSS-CHECK only, the
simulated flux-based contributing area is the primary quantity.

  d8_accumulation(z, active, dx)  upslope area [m^2] incl. own cell, steepest-descent D8
  depression_depth(z, active)     priority-flood filled DEM minus DEM [m] (outlet: domain
                                  edge / NoData edge, i.e. water can leave at the boundary)
  slope(z, active, dx)            central-difference gradient magnitude [m/m]
"""
from __future__ import annotations

import heapq

import numpy as np

_D8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def d8_accumulation(z: np.ndarray, active: np.ndarray, dx: float) -> np.ndarray:
    ny, nx = z.shape
    zz = np.where(active, z, np.inf)
    best = np.zeros((ny, nx))
    rec = np.full((ny, nx), -1, np.int64)
    pad = np.pad(zz, 1, constant_values=np.inf)
    for dy, dxx in _D8:
        nb = pad[1 + dy:1 + dy + ny, 1 + dxx:1 + dxx + nx]
        drop = (zz - nb) / (dx * np.hypot(dy, dxx))
        ok = np.isfinite(nb) & (drop > best)
        idx = (np.arange(ny)[:, None] + dy) * nx + (np.arange(nx)[None, :] + dxx)
        rec = np.where(ok, idx, rec)
        best = np.where(ok, drop, best)
    acc = np.where(active, dx * dx, 0.0).ravel()
    order = np.argsort(-np.where(active, z, -np.inf).ravel(), kind="stable")
    r = rec.ravel()
    for i in order:
        j = r[i]
        if j >= 0 and acc[i] > 0:
            acc[j] += acc[i]
    return acc.reshape(ny, nx)


def depression_depth(z: np.ndarray, active: np.ndarray) -> np.ndarray:
    ny, nx = z.shape
    filled = np.where(active, z, np.nan).copy()
    done = ~active.copy()
    heap = []
    edge = np.zeros_like(active)
    edge[0, :] = edge[-1, :] = edge[:, 0] = edge[:, -1] = True
    pad = np.pad(~active, 1, constant_values=True)
    for dy, dxx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        edge |= pad[1 + dy:1 + dy + ny, 1 + dxx:1 + dxx + nx]
    for i, j in zip(*np.nonzero(edge & active), strict=True):
        heapq.heappush(heap, (z[i, j], i, j))
        done[i, j] = True
    while heap:
        e, i, j = heapq.heappop(heap)
        for dy, dxx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = i + dy, j + dxx
            if 0 <= a < ny and 0 <= b < nx and not done[a, b]:
                done[a, b] = True
                filled[a, b] = max(z[a, b], e)
                heapq.heappush(heap, (filled[a, b], a, b))
    return np.where(active, filled - z, 0.0)


def slope(z: np.ndarray, active: np.ndarray, dx: float) -> np.ndarray:
    zz = np.where(active, z, np.nan)
    gy, gx = np.gradient(zz, dx)
    s = np.hypot(gx, gy)
    return np.where(active & np.isfinite(s), s, 0.0)


def d8_receivers(z: np.ndarray, active: np.ndarray, dx: float) -> np.ndarray:
    """Flat index of the steepest-descent D8 receiver of each cell (-1 = none)."""
    ny, nx = z.shape
    zz = np.where(active, z, np.inf)
    best = np.zeros((ny, nx))
    rec = np.full((ny, nx), -1, np.int64)
    pad = np.pad(zz, 1, constant_values=np.inf)
    with np.errstate(invalid="ignore"):
        for dy, dxx in _D8:
            nb = pad[1 + dy:1 + dy + ny, 1 + dxx:1 + dxx + nx]
            drop = (zz - nb) / (dx * np.hypot(dy, dxx))
            ok = np.isfinite(nb) & np.isfinite(zz) & (drop > best)
            idx = (np.arange(ny)[:, None] + dy) * nx + (np.arange(nx)[None, :] + dxx)
            rec = np.where(ok, idx, rec)
            best = np.where(ok, drop, best)
    return rec


def upstream_cells(z: np.ndarray, active: np.ndarray, dx: float, cell: tuple) -> np.ndarray:
    """Mask of cells whose D8 path passes through `cell` (incl. the cell). Terrain-only;
    depressions are not filled, so pits upstream may be missed (cross-check only)."""
    ny, nx = z.shape
    rec = d8_receivers(z, active, dx).ravel()
    donors = [[] for _ in range(ny * nx)]
    for i, j in enumerate(rec):
        if j >= 0:
            donors[j].append(i)
    m = np.zeros(ny * nx, bool)
    stack = [cell[0] * nx + cell[1]]
    while stack:
        i = stack.pop()
        if not m[i]:
            m[i] = True
            stack.extend(donors[i])
    return m.reshape(ny, nx)
