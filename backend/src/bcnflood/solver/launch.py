"""Resumable launcher for run_grid (Agent 2).

Usage (one process per drainage scenario, run in parallel):
    nohup python -m bcnflood.solver.launch --inputs IN.pkl --scenario mid --out OUTDIR \\
        > OUTDIR/mid.log 2>&1 &

IN.pkl is a pickled GridInputs (save_inputs). The launcher sets the drainage scenario, writes
  OUTDIR/<scenario>/checkpoint.pkl   (atomic, every --checkpoint-every-s simulated seconds)
  OUTDIR/<scenario>/progress.log     (sim time, steps, dt, wall, ETA)
  OUTDIR/<scenario>/outputs.npz + summary.json + inputs.pkl (domain and rain, for the run store)
and resumes from checkpoint.pkl if it exists. Refuses to run unless --synthetic is given or
--gates-file shows G1-G8 PASSED (no Barcelona run before the release gates).
"""
from __future__ import annotations

import argparse
import json
import os
import pickle
import sys
import time
from dataclasses import replace
from pathlib import Path

import numpy as np

from .drainage import load_scenarios
from .grid import GridInputs, GridRun
from .local_inertial import ALPHA_LIMIT, DT_MAX_LIMIT


def save_inputs(g: GridInputs, path) -> None:
    with open(path, "wb") as f:
        pickle.dump(g, f, protocol=pickle.HIGHEST_PROTOCOL)


def load_inputs(path) -> GridInputs:
    with open(path, "rb") as f:
        g = pickle.load(f)  # trusted local file written by save_inputs
    if not isinstance(g, GridInputs):
        raise TypeError("not a GridInputs pickle")
    return g


def _atomic_pickle(obj, path: Path) -> None:
    tmp = path.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        pickle.dump(obj, f, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(tmp, path)


def gates_passed(path) -> bool:
    try:
        d = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return False
    gates = d.get("gates", d)
    items = gates.values() if isinstance(gates, dict) else gates
    sts = [(g.get("status") if isinstance(g, dict) else g) for g in items]
    return len(sts) >= 8 and all(s == "PASSED" for s in sts)


def write_outputs(run: GridRun, outdir: Path, scenario: str) -> None:
    o = run.finish()
    arrays = {"max_depth_m": o.max_depth_m, "max_speed_m_s": o.max_speed_m_s,
              "time_above_0_10m_s": o.time_above_0_10m_s,
              "time_above_0_30m_s": o.time_above_0_30m_s, "outlet_mask": o.outlet_mask,
              "dem_m": run.g.dem_m, "building_mask": run.g.building_mask}
    for i, d in enumerate(o.daily):
        for k in ("max_depth_m", "max_speed_m_s", "time_above_0_10m_s", "time_above_0_30m_s"):
            arrays[f"day{i}_{k}"] = d[k]
    if o.snapshots:
        for k in ("t_s", "h", "ledger", "storage"):
            arrays[f"snap_{k}"] = o.snapshots[k]
    arrays["peak_time_utc_s"] = o.peak_time_utc_s
    for i, d in enumerate(o.daily):
        if "peak_time_utc_s" in d:
            arrays[f"day{i}_peak_time_utc_s"] = d["peak_time_utc_s"]
        if "dominant_inflow_dir" in d:
            arrays[f"day{i}_dominant_inflow_dir"] = d["dominant_inflow_dir"]
            for k, v in d["inflow_by_dir_m3"].items():
                arrays[f"day{i}_inflow_{k}_m3"] = v
    dg = o.diagnostics
    if dg:
        for k, v in dg["cell_budget"].items():
            arrays[f"budget_{k}"] = v
        for k, v in dg["inflow_by_dir_m3"].items():
            arrays[f"inflow_{k}_m3"] = v
        for k in ("dominant_inflow_dir", "contributing_area_flux_m2",
                  "d8_accumulation_m2_crosscheck", "depression_depth_m", "slope_m_m"):
            arrays[k] = dg[k]
    np.savez_compressed(outdir / "outputs.npz", **arrays)
    summ = {"scenario": scenario, "kind": "simulated", "steps": o.steps, "units": o.units,
            "numerics_override": o.mass_balance.get("numerics_override"),
            "rain_station_ids": run.g.rain_station_ids,
            "rain_notes": run.g.rain_notes,
            "grid": {"crs": run.g.crs, "dx_m": run.g.dx_m, "x0_m": run.g.x0_m,
                     "y0_m": run.g.y0_m, "shape": list(o.max_depth_m.shape),
                     "t0_utc": o.t0_utc, "crop_slices": o.crop_slices},
            "diagnostics_meta": None if not o.diagnostics else {
                "dir_codes": o.diagnostics["dir_codes"],
                "contributing_area_note": o.diagnostics["contributing_area_note"],
                "terrain_note": o.diagnostics["terrain_note"]},
            "numerics": o.mass_balance.get("numerics"),
            "mass_balance": o.mass_balance,
            "snapshot_ledger_columns": o.snapshots["ledger_columns"] if o.snapshots else None,
            "daily": [{k: v for k, v in d.items() if not isinstance(v, np.ndarray)}
                      for d in o.daily]}
    (outdir / "summary.json").write_text(json.dumps(summ, indent=1, default=str))
    save_inputs(run.g, outdir / "inputs.pkl")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inputs", required=True)
    ap.add_argument("--scenario", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--checkpoint-every-s", type=float, default=3600.0, help="simulated s")
    ap.add_argument("--report-every-s", type=float, default=600.0, help="simulated s")
    ap.add_argument("--synthetic", action="store_true", help="input is synthetic test data")
    ap.add_argument("--gates-file", default=None)
    ap.add_argument("--override-numerics", action="store_true",
                    help="allow alpha > 0.35 / dt_max > 2 s (G6 override, logged)")
    a = ap.parse_args(argv)
    if not a.synthetic and not (a.gates_file and gates_passed(a.gates_file)):
        print("REFUSED: release gates G1-G8 not all PASSED (use --synthetic for tests)",
              file=sys.stderr)
        return 3
    outdir = Path(a.out) / a.scenario
    outdir.mkdir(parents=True, exist_ok=True)
    ck = outdir / "checkpoint.pkl"
    plog = open(outdir / "progress.log", "a", buffering=1)
    if ck.exists():
        with open(ck, "rb") as f:
            run = pickle.load(f)  # trusted, written by this launcher
        plog.write(f"RESUME t={run.s.t:.1f}s steps={run.led.steps}\n")
    else:
        g = load_inputs(a.inputs)
        g = replace(g, drainage_scenario=load_scenarios()[a.scenario],
                    override_numerics=a.override_numerics or g.override_numerics)
        if not (g.alpha <= ALPHA_LIMIT) or not (g.dt_max_s <= DT_MAX_LIMIT):
            if not g.override_numerics:
                print(f"REFUSED: alpha={g.alpha} dt_max={g.dt_max_s} exceed G6 limits",
                      file=sys.stderr)
                return 4
            plog.write(f"WARNING G6 OVERRIDE alpha={g.alpha} dt_max={g.dt_max_s}\n")
        run = GridRun(g)
        plog.write(f"START scenario={a.scenario} cells={g.dem_m.size} "
                   f"t_end={run.t_end:.0f}s synthetic={a.synthetic}\n")
    w0, t_start = time.time(), run.s.t
    next_ck = (np.floor(run.s.t / a.checkpoint_every_s) + 1) * a.checkpoint_every_s
    while not run.done():
        run.advance(min(next_ck, run.s.t + a.report_every_s))
        wall = time.time() - w0
        rate = (run.s.t - t_start) / wall if wall > 0 else float("nan")
        eta = (run.t_end - run.s.t) / rate if rate > 0 else float("nan")
        plog.write(f"t={run.s.t:.0f}/{run.t_end:.0f}s steps={run.led.steps} "
                   f"hmax={run.s.h.max():.3f}m wall={wall:.0f}s sim/wall={rate:.2f} "
                   f"ETA={eta / 3600:.2f}h\n")
        if run.s.t >= next_ck - 1e-6 or run.done():
            _atomic_pickle(run, ck)
            next_ck += a.checkpoint_every_s
    write_outputs(run, outdir, a.scenario)
    err = run.finish().mass_balance["mass_balance_error_rel"]
    plog.write(f"DONE mass_balance_error_rel={err:.2e}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
