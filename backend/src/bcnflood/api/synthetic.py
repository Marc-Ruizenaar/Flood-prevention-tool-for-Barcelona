"""Generate a SYNTHETIC demo run (not Barcelona data) with Agent 2's run_grid + launcher output
layout (outputs.npz, summary.json, inputs.pkl) and register it in the run store. Numerics use the
solver defaults (alpha 0.35, dt_max 2 s, G6 limits); no override.
Usage: python -m bcnflood.api.synthetic [run_id]"""
from __future__ import annotations

import sys
from dataclasses import replace
from datetime import date, timedelta

import numpy as np

from bcnflood.api.runstore import register_launch_run, runs_root
from bcnflood.data.timewindows import local_day_window
from bcnflood.solver.drainage import DrainageScenario
from bcnflood.solver.grid import GridInputs, GridRun
from bcnflood.solver.launch import write_outputs

DAYS = [date(2026, 10, 3), date(2026, 10, 4)]  # inside the 2-7 Oct period (synthetic)
DST_DAYS = [date(2026, 10, 24), date(2026, 10, 25)]  # includes the 25 h DST day
# ASSUMPTION drainage scenarios [mm/h]; the baseline run is "mid".
SCENARIOS_MM_H = {"low": 10.0, "mid": 20.0, "high": 30.0}
X0_M, Y0_M = 430000.0, 4583000.0  # upper-left corner, EPSG:25831 (synthetic placement)


def synthetic_inputs(days, nx=20, ny=6, dx=10.0, rain_mm_h=40.0, storm_h=2,
                     snapshot_s=1800.0) -> GridInputs:
    z = np.tile((nx * dx - np.arange(nx) * dx) * 0.01 + 5.0, (ny, 1))
    z[ny // 2 - 1: ny // 2 + 1, nx // 2] -= 0.3  # small synthetic depression
    out = np.zeros((ny, nx), bool)
    out[:, -1] = True
    t0 = local_day_window(days[0]).start_utc
    t1 = local_day_window(days[-1]).end_utc
    nh = int(round((t1 - t0).total_seconds() / 3600))
    times = [t0 + timedelta(hours=h) for h in range(nh + 1)]
    rain = np.zeros((nh, 1))
    for d in days:  # storm_h hours of rain at the start of each local day
        k = int(round((local_day_window(d).start_utc - t0).total_seconds() / 3600))
        rain[k:k + storm_h, 0] = rain_mm_h
    full = np.ones((ny, nx))
    return GridInputs(dem_m=z, manning_n=full * 0.03, ga_k_sat_m_s=full * 1e-9,
                      ga_psi_m=full * 0.1, ga_delta_theta=full * 0.3,
                      building_mask=np.zeros((ny, nx), bool), dx_m=dx, crs="EPSG:25831",
                      rain_times_utc=times, rain_mm=rain, station_weights=np.array([1.0]),
                      outlet_mask=out, sea_outlet=False, route_roof_rain=False,
                      pervious_mask=np.zeros((ny, nx), bool),  # fully impervious (synthetic)
                      snapshot_interval_s=snapshot_s, x0_m=X0_M, y0_m=Y0_M)


def make_synthetic_run(run_id: str = "synthetic-demo", root=None, days=None,
                       scenarios=True, baseline="mid", **kw):
    root = root or runs_root()
    days = list(days or DAYS)
    g0 = synthetic_inputs(days, **kw)
    names = list(SCENARIOS_MM_H) if scenarios else [baseline]
    launch = root / f"{run_id}--launch"
    ids = {}
    for name in names:
        g = replace(g0, drainage_scenario=DrainageScenario(name, SCENARIOS_MM_H[name]))
        sd = launch / name
        sd.mkdir(parents=True, exist_ok=True)
        r = GridRun(g)
        r.advance()
        write_outputs(r, sd, name)
        ids[name] = run_id if name == baseline else f"{run_id}--drain-{name}"
    for name in names:
        register_launch_run(ids[name], launch / name, synthetic=True,
                            root=root, drainage_scenarios=ids if scenarios else {})
    return root / run_id


if __name__ == "__main__":
    print(make_synthetic_run(*(sys.argv[1:2] or ["synthetic-demo"])))
