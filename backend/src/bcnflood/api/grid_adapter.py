"""Map Agent 2's run_grid outputs (launcher layout: outputs.npz, summary.json, inputs.pkl;
registered with runstore.register_launch_run) to contract v0.2 (owned by Agent 5).

- daily_from_grid(): DailySummaryV02 from summary.json per-day budgets (clip included in MB).
- cells_from_grid(): per-day CellOutputV02 from the per-day fields (max depth, max speed, time
  above 0.10/0.30 m).
- grid_segment_stats(): street aggregation from the per-day fields (used by /streets).
Values are copied from GridOutputs; nothing is invented."""
from __future__ import annotations

from datetime import date

import numpy as np

from bcnflood.api.contract import SIM, SYNTHETIC_WARNING, CellOutputV02, DailySummaryV02, q
from bcnflood.api.runstore import StoredRun
from bcnflood.schemas import ValueKind
from bcnflood.schemas.contract_v02 import DATA_COMPLETENESS_PROVISIONAL_WARNING

SPEED_MIN_DEPTH_M = 0.01
THRESHOLD_FIELDS = {0.10: "time_above_0_10m_s", 0.30: "time_above_0_30m_s"}
DAY_FIELDS = ("max_depth_m", "max_speed_m_s", "time_above_0_10m_s", "time_above_0_30m_s")


def _day(run: StoredRun, d: date) -> dict | None:
    return (run.grid or {}).get(d.isoformat())


def daily_from_grid(run: StoredRun) -> list[DailySummaryV02]:
    """DailySummaryV02 from run_grid per-day budgets (rain = gross rain incl. roofs)."""
    out = []
    for e in run.meta["summary"]["daily"]:
        d = date.fromisoformat(e["local_date"])
        w = run.window(d)
        warn = [SYNTHETIC_WARNING] if run.synthetic else []
        warn.append(f"ASSUMPTION drainage scenario: capacity {run.meta['drainage_capacity_m_s']}"
                    " m/s")
        b = e.get("budget")
        if e["status"] != "SIMULATED" or b is None:
            out.append(DailySummaryV02(
                run_id=run.run_id, date_local=d, timezone="Europe/Madrid", window_utc=w,
                **{k: q(None, u, kd) for k, u, kd in _FIELDS}, status="INCOMPLETE",
                synthetic=run.synthetic, warnings=warn))
            continue
        hmax = float(_day(run, d)["max_depth_m"].max())
        vals = {"rainfall_volume": b["rain_m3"], "infiltration_volume": b["infiltration_m3"],
                "drainage_volume": b["drainage_m3"],
                "boundary_outflow_volume": b["outflow_m3"],
                "storage_start": b["storage_start_m3"], "storage_end": b["storage_end_m3"],
                "mass_balance_error_rel": b["mass_balance_error_rel"], "max_depth": hmax,
                "data_completeness": 1.0}
        out.append(DailySummaryV02(
            run_id=run.run_id, date_local=d, timezone="Europe/Madrid", window_utc=w,
            **{k: q(vals[k], u, kd) for k, u, kd in _FIELDS}, status="SIMULATED",
            synthetic=run.synthetic, warnings=warn + [DATA_COMPLETENESS_PROVISIONAL_WARNING]))
    return out


_A = ValueKind.ASSUMPTION
_FIELDS = [("rainfall_volume", "m3", SIM), ("infiltration_volume", "m3", SIM),
           ("drainage_volume", "m3", _A), ("boundary_outflow_volume", "m3", SIM),
           ("storage_start", "m3", SIM), ("storage_end", "m3", SIM),
           ("mass_balance_error_rel", "1", SIM), ("max_depth", "m", SIM),
           ("data_completeness", "1", _A)]


def cells_from_grid(run: StoredRun, d: date, threshold_m: float,
                    min_depth_m: float) -> list[CellOutputV02]:
    f = _day(run, d)
    if f is None:
        return []
    if threshold_m not in THRESHOLD_FIELDS:
        raise ValueError(f"run_grid output supports threshold_m in {sorted(THRESHOLD_FIELDS)}")
    hmax, umax, tab = f["max_depth_m"], f["max_speed_m_s"], f[THRESHOLD_FIELDS[threshold_m]]
    # speed is served only where depth reached SPEED_MIN_DEPTH_M (shallower cells -> null)
    out = []
    for r, c in zip(*np.where(hmax >= min_depth_m), strict=True):
        x, y = run.cell_xy(int(r), int(c))
        out.append(CellOutputV02(
            cell_id=f"r{r}c{c}", x=q(x, "m"), y=q(y, "m"), crs=run.meta["crs"], date_local=d,
            max_depth=q(hmax[r, c], "m"), max_velocity=q(
                umax[r, c] if hmax[r, c] >= SPEED_MIN_DEPTH_M else None, "m/s"),
            time_of_max_utc=None, duration_above_threshold=q(tab[r, c], "s"),
            threshold=q(threshold_m, "m", ValueKind.ASSUMPTION),
            uncertainty=("SYNTHETIC; " if run.synthetic else "")
            + "run_grid per-day fields; time_of_max not provided by run_grid; durations exact "
              "(per solver step)",
            provenance_run_id=run.run_id))
    return out


def grid_segment_stats(run: StoredRun, d: date, cells) -> dict | None:
    """Segment stats from run_grid per-day fields: max and p95 over the segment's cells' daily
    max depth; minutes above X = max over the segment's cells of time above X (step-exact)."""
    f = _day(run, d)
    if f is None or not cells:
        return None
    rr, cc = (list(x) for x in zip(*cells, strict=True))
    h = f["max_depth_m"][rr, cc]
    return {"max_depth_m": float(h.max()), "p95_depth_m": float(np.percentile(h, 95)),
            "minutes_above_0.10m": float(f["time_above_0_10m_s"][rr, cc].max() / 60),
            "minutes_above_0.30m": float(f["time_above_0_30m_s"][rr, cc].max() / 60)}
