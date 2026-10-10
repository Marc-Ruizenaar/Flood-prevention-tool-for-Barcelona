"""Run store (owned by Agent 5): persists solver outputs so the API serves exactly what the solver
produced. Layout: <root>/<run_id>/meta.json + snapshots.npz. Root: env BCNFLOOD_RUNS, default
<repo>/outputs/runs (gitignored)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np

from bcnflood.data.timewindows import local_day_window

DEFAULT_ROOT = Path(__file__).resolve().parents[3] / "outputs" / "runs"
BCN_RUN_ID = "bcn-2026-10-03_07"  # expected id of the real 3-7 Oct Barcelona run


def runs_root() -> Path:
    return Path(os.environ.get("BCNFLOOD_RUNS", DEFAULT_ROOT))


@dataclass
class StoredRun:
    run_id: str
    meta: dict
    t: np.ndarray            # model seconds since start_utc, (nt,)
    storage: np.ndarray      # m3, (nt,)
    ledger: np.ndarray       # m3 cumulative rain, infil, drain, outflow, (nt, 4)
    max_depth: np.ndarray    # m, (nt,)
    h: np.ndarray            # m, (nt, ny, nx)
    grid: dict | None = None  # run_grid per-day fields {date_iso: {field: (ny, nx)}}

    @property
    def start_utc(self) -> datetime:
        return datetime.fromisoformat(self.meta["start_utc"])

    @property
    def synthetic(self) -> bool:
        return bool(self.meta["synthetic"])

    def days(self) -> list[date]:
        return [date.fromisoformat(d) for d in self.meta["days_local"]]

    def window(self, d: date):
        w = local_day_window(d)
        return w.start_utc, w.end_utc

    def seconds(self, ts: datetime) -> float:
        return (ts - self.start_utc).total_seconds()

    def time_utc(self, i: int) -> datetime:
        return self.start_utc + timedelta(seconds=float(self.t[i]))

    def cell_xy(self, row: int, col: int) -> tuple[float, float]:
        """Cell-centre coordinates; meta x0_m/y0_m is the upper-left corner, row 0 = north."""
        dx = self.meta["dx_m"]
        return self.meta["x0_m"] + (col + 0.5) * dx, self.meta["y0_m"] - (row + 0.5) * dx


def save_run(run_id: str, snaps, *, dx_m: float, x0_m: float, y0_m: float, crs: str,
             start_utc: datetime, days_local: list[date], synthetic: bool,
             drainage_capacity_m_s: float, root: Path | None = None, extra: dict | None = None):
    d = (root or runs_root()) / run_id
    d.mkdir(parents=True, exist_ok=True)
    meta = {"run_id": run_id, "dx_m": dx_m, "x0_m": x0_m, "y0_m": y0_m, "crs": crs,
            "start_utc": start_utc.isoformat(), "days_local": [x.isoformat() for x in days_local],
            "synthetic": synthetic, "drainage_capacity_m_s": drainage_capacity_m_s,
            "timezone": "Europe/Madrid",
            "ledger_columns": ["rain_applied", "infiltration", "drainage", "outflow", "clip"],
            **(extra or {})}
    (d / "meta.json").write_text(json.dumps(meta, indent=2))
    np.savez_compressed(
        d / "snapshots.npz", t=np.array([s.t for s in snaps]),
        storage=np.array([s.storage for s in snaps]),
        ledger=np.array([[s.ledger.rain, s.ledger.infiltration, s.ledger.drainage,
                          s.ledger.outflow, s.ledger.clip] for s in snaps]),
        max_depth=np.array([s.max_depth for s in snaps]), h=np.stack([s.h for s in snaps]))
    return d


def register_launch_run(run_id: str, scenario_dir: Path, *, x0_m: float | None = None,
                        y0_m: float | None = None,
                        synthetic: bool, root: Path | None = None,
                        drainage_scenarios: dict | None = None, extra: dict | None = None):
    """Register an Agent 2 launcher output dir (<out>/<scenario>/ with outputs.npz,
    summary.json, inputs.pkl) in the run store. GridInputs has no georeference, so the
    upper-left corner x0_m/y0_m (run CRS) must be given. Cell size and CRS come from inputs.pkl."""
    from bcnflood.solver.launch import load_inputs
    scenario_dir = Path(scenario_dir).resolve()
    g = load_inputs(scenario_dir / "inputs.pkl")
    summ = json.loads((scenario_dir / "summary.json").read_text())
    gr = summ.get("grid") or {}
    x0_m = gr.get("x0_m") if x0_m is None else x0_m  # GridInputs.x0_m/y0_m (3185aeb)
    y0_m = gr.get("y0_m") if y0_m is None else y0_m
    if x0_m is None or y0_m is None:
        raise ValueError("grid origin unknown: pass x0_m/y0_m or set GridInputs.x0_m/y0_m")
    d = (root or runs_root()) / run_id
    d.mkdir(parents=True, exist_ok=True)
    meta = {"run_id": run_id, "layout": "launch", "launch_dir": str(scenario_dir),
            "inputs_pkl": str(scenario_dir / "inputs.pkl"), "dx_m": float(g.dx_m),
            "x0_m": x0_m, "y0_m": y0_m, "crs": g.crs,
            "start_utc": g.rain_times_utc[0].isoformat(), "synthetic": synthetic,
            "days_local": [e["local_date"] for e in summ["daily"]],
            "scenario": summ.get("scenario"),
            "drainage_capacity_m_s": (g.drainage_scenario.capacity_m_s
                                      if g.drainage_scenario else 0.0),
            "timezone": "Europe/Madrid", "drainage_scenarios": drainage_scenarios or {},
            **(extra or {})}
    (d / "meta.json").write_text(json.dumps(meta, indent=2))
    return d


def _load_launch(run_id: str, meta: dict) -> StoredRun:
    ld = Path(meta["launch_dir"])
    z = np.load(ld / "outputs.npz")
    summ = json.loads((ld / "summary.json").read_text())
    meta = {**meta, "summary": summ}
    cols = summ.get("snapshot_ledger_columns") or []
    grid = {}
    for i, e in enumerate(summ["daily"]):
        grid[e["local_date"]] = {k: z[f"day{i}_{k}"] for k in (
            "max_depth_m", "max_speed_m_s", "time_above_0_10m_s", "time_above_0_30m_s")}
    meta["ledger_columns"] = cols
    # M2-A2-06 diagnostics (whole run and per day), when the launcher wrote them
    diag = {k: z[k] for k in z.files if k.startswith(("budget_", "inflow_")) or k in (
        "dominant_inflow_dir", "contributing_area_flux_m2", "d8_accumulation_m2_crosscheck",
        "depression_depth_m", "slope_m_m", "peak_time_utc_s")}
    for i, e in enumerate(summ["daily"]):
        dd = {k[len(f"day{i}_"):]: z[k] for k in z.files if k.startswith(f"day{i}_")
              and k[len(f"day{i}_"):] not in grid[e["local_date"]]}
        grid[e["local_date"]].update(dd)
    meta["diag"] = diag
    if "snap_t_s" in z.files:
        t, h = z["snap_t_s"], z["snap_h"].astype(np.float64)
        ledger, storage = z["snap_ledger"], z["snap_storage"]
    else:  # no snapshots: timeseries unavailable, grid fields still served
        shp = z["max_depth_m"].shape
        t, h = np.zeros(1), np.zeros((1, *shp))
        ledger, storage = np.zeros((1, max(len(cols), 4))), np.zeros(1)
    return StoredRun(run_id, meta, t, storage, ledger, h.reshape(len(t), -1).max(axis=1), h,
                     grid)


def list_runs() -> list[str]:
    r = runs_root()
    return sorted(p.name for p in r.iterdir() if (p / "meta.json").exists()) if r.exists() else []


def load_run(run_id: str) -> StoredRun | None:
    d = runs_root() / run_id
    if "/" in run_id or ".." in run_id or not (d / "meta.json").exists():
        return None
    meta = json.loads((d / "meta.json").read_text())
    if meta.get("layout") == "launch":
        return _load_launch(run_id, meta)
    z = np.load(d / "snapshots.npz")
    grid = None
    if (d / "grid_daily.npz").exists():
        g = np.load(d / "grid_daily.npz")
        grid = {}
        for k in g.files:  # "<date>|<field>"
            day, fld = k.split("|")
            grid.setdefault(day, {})[fld] = g[k]
    return StoredRun(run_id, json.loads((d / "meta.json").read_text()), z["t"], z["storage"],
                     z["ledger"], z["max_depth"], z["h"], grid)


def solver_snapshots(run: StoredRun):
    """Rebuild solver Snapshot objects so solver.daily.daily_summaries does the aggregation."""
    from bcnflood.solver.local_inertial import Ledger, Snapshot
    cols = run.meta.get("ledger_columns") or ["rain_applied", "infiltration", "drainage",
                                              "outflow"]
    ci = {c: k for k, c in enumerate(cols)}

    def led(row):
        def g(c):
            return float(row[ci[c]]) if c in ci else 0.0
        return Ledger(g("rain_applied"), g("infiltration"), g("drainage"), g("outflow"), 0,
                      g("clip"))
    return [Snapshot(float(run.t[i]), float(run.storage[i]), led(run.ledger[i]),
                     float(run.max_depth[i]), int((run.h[i] > 0.01).sum()), run.h[i])
            for i in range(len(run.t))]
