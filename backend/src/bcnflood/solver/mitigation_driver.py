"""M2 mitigation option-B driver (Agent 2). Results are CONDITIONAL model scenarios, not
guarantees; every lever is 'assumption, illustrative, Orchestrator-set; not engineering design'.

    python -m bcnflood.solver.mitigation_driver --baseline OUT/mid --hotspots HS.json \\
        --out MIT --gates-file GATES [--parallel 4] [--synthetic]

  baseline dir = a finished launcher scenario dir (inputs.pkl, outputs.npz, summary.json).
  hotspots     = JSON list of {"row": r, "col": c} (full-grid indices) or {"x_m", "y_m"}
                 (EPSG:25831, converted with the baseline grid origin), or {"top": n[, "day":
                 "YYYY-MM-DD"]}: the /hotspots ranking (score = per-day max depth x minutes above
                 0.10 m, ties by depth, 100 m centre-distance dedupe; same rule as
                 api/hotspots.py, re-implemented here, their file is not edited). Without "day"
                 a cell's score is its best per-day score over the non-spin-up days.
For each hotspot: cut a subdomain sized to its upstream / flux contributing area
(subdomain.cut_around_hotspot), build the 5 configs of config/mitigation_levers.json (mid
drainage), launch each through solver.launch (gate check unless --synthetic), N in parallel,
then collect per local day the delta of max depth per cell (config - subdomain baseline).
Per-interval rain weight overrides are sliced into each subdomain by crop_inputs.

Acceptance: a config whose launcher fails, or whose mass-balance error exceeds MASS_TOL (1e-9
relative), is REJECTED: marked "failed" in results.json, excluded from deltas.npz, and the CLI
exits 2. If the subdomain baseline is rejected, every config of that hotspot is rejected.

Deltas are against a SUBDOMAIN BASELINE RERUN (same box, same forcing, no levers), not the
full-grid run. Box edge conditions, as GridRun actually builds them (verified, recorded per
hotspot in results.json "edges"): the inputs carry no edge_outflow_mask, so on the cut box
  - sea outlets: DEM <= 0 m cells connected to the box edge are absorbing outlets (sea_outlet);
  - critical-depth outflow q = sqrt(g h^3) (ASSUMPTION) on box-boundary cells with
    DEM <= river_outlet_max_elev_m (10 m) lying NE or SW of the box's active centroid
    (river_edge_outlets re-derived on the box, so these are NOT only the real river mouths);
  - every other box-edge cell is CLOSED (no inflow from beyond the box, no outflow).
So the edges are NOT generally free-draining: water reaching a closed edge ponds there. Deltas
are CONDITIONAL on the box containing the hotspot's catchment (see meta coverage) and on these
edges; compare levers only against the matching subdomain baseline.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from .launch import load_inputs, save_inputs
from .subdomain import cut_around_hotspot, lever_configs

REPO = Path(__file__).resolve().parents[3]
CFG_PATH = REPO / "config" / "mitigation_levers.json"
MASS_TOL = 1e-9
DEDUP_M = 100.0  # same as api/hotspots.DEDUP_M


def _day_ids(bz, summary, day: str | None):
    daily = summary.get("daily") or []
    ids = []
    for i, d in enumerate(daily):
        if f"day{i}_max_depth_m" not in bz.files:
            continue
        if "spin" in str(d.get("status", "")).lower():
            continue
        if day is None or d.get("local_date") == day:
            ids.append(i)
    if day is not None and not ids:
        raise ValueError(f"day {day} not in baseline daily outputs")
    return ids


def rank_hotspots(bz, summary, n: int, day: str | None = None,
                  dedup_m: float = DEDUP_M) -> list[tuple[int, int]]:
    """/hotspots ranking: score = max_depth_m * time_above_0_10m_s / 60 per local day."""
    ids = _day_ids(bz, summary, day)
    if ids:
        score = np.max([np.nan_to_num(bz[f"day{i}_max_depth_m"])
                        * np.nan_to_num(bz[f"day{i}_time_above_0_10m_s"]) / 60.0
                        for i in ids], axis=0)
        hmax = np.max([np.nan_to_num(bz[f"day{i}_max_depth_m"]) for i in ids], axis=0)
    else:
        hmax = np.nan_to_num(bz["max_depth_m"])
        score = hmax * np.nan_to_num(bz["time_above_0_10m_s"]) / 60.0
    dx = summary["grid"]["dx_m"]
    order = sorted(zip(*np.nonzero(score > 0), strict=True),
                   key=lambda rc: (-score[rc], -hmax[rc]))
    picked: list[tuple[int, int]] = []
    for r, c in order:
        if all(np.hypot((r - a) * dx, (c - b) * dx) > dedup_m for a, b in picked):
            picked.append((int(r), int(c)))
        if len(picked) >= n:
            break
    return picked


def edge_report(gc) -> dict:
    """What the box edges really are, from GridRun's own outlet construction."""
    from .grid import GridRun
    from .topology import boundary_cells
    gr = GridRun(gc)
    act = np.ones(gc.dem_m.shape, bool) if gc.active_mask is None else gc.active_mask
    b = boundary_cells(act) & gr.open_
    sea = gr.outlet if gr.outlet is not None else np.zeros_like(b)
    crit = gr.edge_out if gr.edge_out is not None else np.zeros_like(b)
    nb = int(b.sum())
    return {"boundary_cells": nb, "sea_outlet_cells": int((b & sea).sum()),
            "critical_depth_cells": int((b & crit).sum()),
            "closed_cells": int((b & ~sea & ~crit).sum()),
            "kind": "assumption; closed except sea/critical-depth cells, see docstring"}


def resolve_hotspots(spec, base_npz, summary) -> list[tuple[int, int]]:
    g = summary["grid"]
    out = []
    for h in spec:
        if "row" in h:
            out.append((int(h["row"]), int(h["col"])))
        elif "x_m" in h:
            out.append((int((g["y0_m"] - h["y_m"]) // g["dx_m"]),
                        int((h["x_m"] - g["x0_m"]) // g["dx_m"])))
        elif "top" in h:
            out.extend(rank_hotspots(base_npz, summary, int(h["top"]), h.get("day")))
    return out


def _launch(inp: Path, outdir: Path, gates: str | None, synthetic: bool) -> int:
    cmd = [sys.executable, "-m", "bcnflood.solver.launch", "--inputs", str(inp),
           "--scenario", "mid", "--out", str(outdir)]
    cmd += ["--synthetic"] if synthetic else (["--gates-file", gates] if gates else [])
    outdir.mkdir(parents=True, exist_ok=True)
    with open(outdir / "driver.log", "w") as log:
        return subprocess.call(cmd, stdout=log, stderr=subprocess.STDOUT,
                               env={**__import__("os").environ,
                                    "PYTHONPATH": str(REPO / "src")})


def _accept(cres: dict) -> bool:
    if cres["returncode"] != 0:
        cres.update(status="failed", reason=f"launcher exit {cres['returncode']}")
        return False
    e = cres.get("mass_balance_error_rel")
    if not (e is not None and abs(e) <= MASS_TOL):  # NaN rejected too
        cres.update(status="failed", reason=f"mass_balance_error_rel {e} > {MASS_TOL}")
        return False
    return True


def run(baseline: Path, hotspots_spec, out: Path, gates: str | None = None,
        parallel: int = 4, synthetic: bool = False, cfg_path: Path = CFG_PATH,
        margin_cells: int = 5) -> dict:
    baseline, out = Path(baseline), Path(out)
    cfg = json.loads(Path(cfg_path).read_text())
    g = load_inputs(baseline / "inputs.pkl")
    bz = np.load(baseline / "outputs.npz")
    summ = json.loads((baseline / "summary.json").read_text())
    hs = resolve_hotspots(hotspots_spec, bz, summ)
    out.mkdir(parents=True, exist_ok=True)
    if not hs:
        raise ValueError("no hotspots resolved (no cell with depth > 0.10 m for any time?)")
    ca = bz["contributing_area_flux_m2"] if "contributing_area_flux_m2" in bz.files else None
    jobs, metas = [], {}
    for k, cell in enumerate(hs):
        gs, meta = cut_around_hotspot(g, cell, margin_cells=margin_cells,
                                      flux_contrib_area_m2=None if ca is None
                                      else float(ca[cell]))
        name = f"hs{k:02d}_r{cell[0]}_c{cell[1]}"
        meta["edges"] = edge_report(gs)
        meta["delta_reference"] = "subdomain baseline rerun (same box, no levers)"
        metas[name] = meta
        for cname, gc in lever_configs(gs, meta["hotspot_sub"], cfg).items():
            d = out / name / cname
            d.mkdir(parents=True, exist_ok=True)
            save_inputs(gc, d / "in.pkl")
            jobs.append((name, cname, d))
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=parallel) as ex:
        rcs = list(ex.map(lambda j: _launch(j[2] / "in.pkl", j[2], gates, synthetic), jobs))
    wall = time.time() - t0
    results = {"status": "CONDITIONAL", "label": cfg["label"], "kind": "simulated scenario",
               "note": "deltas = config - subdomain baseline rerun (mid), box edges closed "
                       "except sea/critical-depth cells (see hotspots.*.meta.edges); "
                       "model scenarios, not guarantees",
               "mass_tol_rel": MASS_TOL, "wall_s": wall, "hotspots": {}}
    for (name, cname, _d), rc in zip(jobs, rcs, strict=True):
        results["hotspots"].setdefault(name, {"meta": metas[name], "configs": {}})
        results["hotspots"][name]["configs"][cname] = {"returncode": rc}
    arrays = {}
    for name, hres in results["hotspots"].items():
        bdir = out / name / "baseline" / "mid"
        bres = hres["configs"]["baseline"]
        if bres["returncode"] == 0:
            bres["mass_balance_error_rel"] = json.loads((bdir / "summary.json").read_text())[
                "mass_balance"]["mass_balance_error_rel"]
        if not _accept(bres):
            for cres in hres["configs"].values():
                cres["status"] = "failed"
                cres.setdefault("reason", "subdomain baseline rejected")
            continue
        bres["status"] = "ok"
        b = np.load(bdir / "outputs.npz")
        days = sorted({k.split("_")[0] for k in b.files if k.startswith("day")
                       and k.endswith("_max_depth_m")})
        hsub = tuple(hres["meta"]["hotspot_sub"])
        for cname, cres in hres["configs"].items():
            if cname == "baseline":
                continue
            if cres["returncode"] == 0:
                cs = json.loads((out / name / cname / "mid" / "summary.json").read_text())
                cres["mass_balance_error_rel"] = cs["mass_balance"]["mass_balance_error_rel"]
            if not _accept(cres):
                continue
            cres["status"] = "ok"
            c = np.load(out / name / cname / "mid" / "outputs.npz")
            cres["days"] = {}
            for dk in days:
                delta = c[f"{dk}_max_depth_m"] - b[f"{dk}_max_depth_m"]
                arrays[f"{name}__{cname}__{dk}_delta_max_depth_m"] = delta
                cres["days"][dk] = {
                    "hotspot_delta_m": float(delta[hsub]),
                    "baseline_hotspot_max_m": float(b[f"{dk}_max_depth_m"][hsub]),
                    "min_delta_m": float(delta.min()), "max_delta_m": float(delta.max()),
                    "cells_reduced_gt_1cm": int((delta < -0.01).sum()),
                    "cells_increased_gt_1cm": int((delta > 0.01).sum())}
    np.savez_compressed(out / "deltas.npz", **arrays)
    (out / "results.json").write_text(json.dumps(results, indent=1, default=str))
    return results


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--hotspots", required=True, help="JSON file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--gates-file", default=None)
    ap.add_argument("--parallel", type=int, default=4)
    ap.add_argument("--synthetic", action="store_true")
    a = ap.parse_args(argv)
    res = run(Path(a.baseline), json.loads(Path(a.hotspots).read_text()), Path(a.out),
              a.gates_file, a.parallel, a.synthetic)
    bad = [(h, c, v.get("reason")) for h, r in res["hotspots"].items()
           for c, v in r["configs"].items() if v.get("status") != "ok"]
    print(json.dumps({"wall_s": res["wall_s"], "failed": bad}))
    return 0 if not bad else 2


if __name__ == "__main__":
    raise SystemExit(main())
