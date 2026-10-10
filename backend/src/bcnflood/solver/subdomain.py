"""Subdomain cut for mitigation reruns (option B, Agent 2). Results are CONDITIONAL.

cut_around_hotspot(g, cell, ...) returns a GridInputs restricted to a box around the hotspot
that contains its D8 upstream area (terrain, DEM + building walls) plus a margin, grown until it
also covers the flux-based contributing area of the baseline (if given). Outside the box is
inactive: the box edges are CLOSED (no inflow from beyond it), so results are CONDITIONAL on
the box containing the hotspot's catchment; `coverage` reports how much of the baseline
flux contributing area the box's upstream area represents.
"""
from __future__ import annotations

from dataclasses import replace

import numpy as np

from .grid import GridInputs, crop_inputs
from .hotspots import upstream_cells
from .local_inertial import DEFAULT_DT_MAX  # noqa: F401  (documented default)


def cut_around_hotspot(g: GridInputs, cell: tuple[int, int], margin_cells: int = 5,
                       flux_contrib_area_m2: float | None = None,
                       max_grow: int = 20) -> tuple[GridInputs, dict]:
    act = np.ones(g.dem_m.shape, bool) if g.active_mask is None else g.active_mask
    z = np.where(g.building_mask, g.dem_m + 100.0, g.dem_m)
    up = upstream_cells(z, act, g.dx_m, cell) & act
    ys, xs = np.nonzero(up)
    area_cell = g.dx_m**2
    ny, nx = act.shape
    m = margin_cells
    for _ in range(max_grow + 1):
        y0, y1 = max(0, ys.min() - m), min(ny, ys.max() + m + 1)
        x0, x1 = max(0, xs.min() - m), min(nx, xs.max() + m + 1)
        box_area = float(act[y0:y1, x0:x1].sum()) * area_cell
        if flux_contrib_area_m2 is None or box_area >= flux_contrib_area_m2:
            break
        m += max(2, m // 2)
    sl = (slice(int(y0), int(y1)), slice(int(x0), int(x1)))
    gc, _ = crop_inputs(replace(g, crop_to_active=True), sl)
    up_area = float(up.sum()) * area_cell
    meta = {"status": "CONDITIONAL",
            "note": "subdomain with closed box edges; inflow from outside the box ignored",
            "hotspot_full": tuple(int(v) for v in cell),
            "hotspot_sub": (int(cell[0] - y0), int(cell[1] - x0)),
            "slices": ((int(y0), int(y1)), (int(x0), int(x1))),
            "cells": int(gc.dem_m.size), "active_cells": int(gc.active_mask.sum()),
            "d8_upstream_area_m2": up_area, "box_active_area_m2": box_area,
            "flux_contrib_area_m2": flux_contrib_area_m2,
            "coverage_d8_over_flux": (up_area / flux_contrib_area_m2
                                      if flux_contrib_area_m2 else None),
            "margin_cells": int(m)}
    return gc, meta


def lever_configs(g: GridInputs, hotspot_sub: tuple[int, int], cfg: dict) -> dict:
    """Build the 5 GridInputs of config/mitigation_levers.json (mid drainage) for a subdomain.
    Every lever carries label/source from the config ('assumption ... not engineering design').
    """
    from .drainage import load_scenarios
    from .mitigation import Lever

    rng = np.random.default_rng(cfg.get("seed", 0))
    act = g.active_mask if g.active_mask is not None else np.ones(g.dem_m.shape, bool)
    bld = g.building_mask & act
    open_ = act & ~bld
    sealed = open_ & (g.ga_k_sat_m_s <= 0)
    perv = open_ & (g.ga_k_sat_m_s > 0)
    base = replace(g, drainage_scenario=load_scenarios()[cfg.get("drainage_scenario", "mid")],
                   mitigation=[])
    area = g.dx_m**2
    out = {}
    for c in cfg["configs"]:
        levers = []
        src = c["label"] + " | " + c["rationale"]
        for lv in c["levers"]:
            k = lv["kind"]
            if k == "drain":
                levers.append(Lever("drain", open_.copy(), {"extra_mm_h": lv["extra_mm_h"]},
                                    source=src))
            elif k == "suds":
                pick = sealed & (rng.random(sealed.shape) < lv["fraction"])
                psi = float(np.median(g.ga_psi_m[perv])) if perv.any() else 0.0
                dth = float(np.median(g.ga_delta_theta[perv])) if perv.any() else 0.0
                levers.append(Lever("suds", pick, {"k_sat_m_s": lv["k_sat_cm_h"] / 360000.0,
                                                   "psi_m": psi, "delta_theta": dth},
                                    source=src))
            elif k == "tank":
                cells = np.zeros(act.shape, bool)
                cells[hotspot_sub] = True
                levers.append(Lever("tank", cells, {
                    "volume_m3": lv["volume_m3"],
                    "inflow_mm_h": lv["inflow_m3_s"] / area * 3.6e6,  # m3/s at one cell
                    "drain_down_m3_s": lv["drain_down_m3_s"],
                    "drain_down_after_rain_only": lv["drain_down_after_rain_only"]},
                    source=src))
            elif k == "green_roof":
                pick = bld & (rng.random(bld.shape) < lv["fraction"])
                levers.append(Lever("green_roof", pick, {"storage_m": lv["storage_mm"] / 1e3},
                                    source=src))
            else:
                raise ValueError(k)
        out[c["name"]] = replace(base, mitigation=levers)
    return out
