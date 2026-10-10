"""Mitigation comparison (M2-A5-05, owned by Agent 5). MODEL SCENARIOS, NOT GUARANTEES.

For a registered run_grid run, the stored GridInputs (inputs.pkl, Agent 2 launcher) is re-run
with Agent 2's mitigation levers (solver.grid + solver.mitigation.Lever, default numerics:
alpha 0.35, dt_max 2 s). Per local day, the per-cell max-depth fields (max over ALL solver steps,
the same definition /streets uses for run_grid runs) of scenario and baseline are aggregated to
street segments: change in flooded street length and in peak depth.
Note (audit A3-06): detention tanks never empty. They fill within minutes (about 10 min in the
synthetic case) and then no longer affect peak depth."""
from __future__ import annotations

from dataclasses import replace

import numpy as np

from bcnflood.api.runstore import StoredRun
from bcnflood.api.streets import _cells_on, load_segments
from bcnflood.solver.mitigation import Lever, delta_max_depth

DISCLAIMER = "Model scenario comparison, not a guarantee of real-world outcome."
FLOODED_DEPTH_M = 0.10  # a street segment counts as flooded when its max depth > 0.10 m
LEVER_KINDS = {"drain", "suds", "tank", "green_roof"}
# Placeholder scenarios (ASSUMPTION, no source) used by GET when none are supplied.
DEFAULT_SCENARIOS = [
    {"name": f"drain_plus_{mm}mm_h", "levers": [{"kind": "drain", "cells": "all",
                                                 "params": {"extra_mm_h": mm}}]}
    for mm in (10, 20, 30)]


def _inputs(run: StoredRun):
    p = run.meta.get("inputs_pkl")
    if not p or run.grid is None:
        raise NotImplementedError("Mitigation re-run needs a run_grid run with inputs.pkl "
                                  "(register_launch_run).")
    from bcnflood.solver.launch import load_inputs
    return load_inputs(p)


def _levers(spec: list[dict], shape) -> list[Lever]:
    out = []
    for lv in spec:
        if lv.get("kind") not in LEVER_KINDS:
            raise ValueError(f"lever kind must be one of {sorted(LEVER_KINDS)}")
        mask = np.zeros(shape, bool)
        if lv.get("cells", "all") == "all":
            mask[:] = True
        else:
            for r, c in lv["cells"]:
                mask[int(r), int(c)] = True
        out.append(Lever(kind=lv["kind"], cells=mask, params=dict(lv.get("params", {}))))
    return out


def _run_scenario(g, levers) -> dict:
    from bcnflood.solver.grid import run_grid
    out = run_grid(replace(g, mitigation=list(g.mitigation) + levers, snapshot_interval_s=None))
    return {e["local_date"]: e["max_depth_m"] for e in out.daily}


def _streets(hmax: np.ndarray, seg_cells) -> tuple[float, float]:
    length, peak = 0.0, 0.0
    for coords, cells in seg_cells:
        if not cells:
            continue
        d = float(max(hmax[r, c] for r, c in cells))
        peak = max(peak, d)
        if d > FLOODED_DEPTH_M:
            a = np.array(coords)
            length += float(np.hypot(*np.diff(a, axis=0).T).sum())
    return length, peak


def _q(v, unit="m"):
    return {"value": float(v), "unit": unit, "kind": "simulated"}


def compare(run: StoredRun, scenarios: list[dict] | None = None) -> dict:
    scenarios = scenarios or DEFAULT_SCENARIOS
    g = _inputs(run)
    levers = {sc["name"]: _levers(sc["levers"], g.dem_m.shape) for sc in scenarios}
    segs, stub = load_segments(run)
    seg_cells = [(s["coords"], _cells_on(run, s["coords"])) for s in segs]
    base = {k: v["max_depth_m"] for k, v in run.grid.items()}
    scen = {name: _run_scenario(g, lv) for name, lv in levers.items()}
    days = []
    for d in run.days():
        k = d.isoformat()
        l0, p0 = _streets(base[k], seg_cells)
        rows = {}
        for sc in scenarios:
            f = scen[sc["name"]][k]
            l1, p1 = _streets(f, seg_cells)
            delta = delta_max_depth([base[k]], [f])[0]
            rows[sc["name"]] = {"delta_flooded_street_length": _q(l1 - l0),
                                "delta_peak_depth": _q(p1 - p0),
                                "min_cell_delta_max_depth": _q(delta.min()),
                                "levers": sc["levers"], "lever_kind": "assumption",
                                "label": "model scenario"}
        days.append({"date": k,
                     "baseline": {"flooded_street_length": _q(l0), "peak_depth": _q(p0)},
                     "scenarios": rows})
    return {"run_id": run.run_id, "synthetic": run.synthetic, "disclaimer": DISCLAIMER,
            "flooded_threshold_m": FLOODED_DEPTH_M,
            "max_depth_definition": "max over all solver steps in the local day",
            "engine": "bcnflood.solver.grid.run_grid + solver.mitigation levers",
            "street_network_stub": stub, "days": days}
