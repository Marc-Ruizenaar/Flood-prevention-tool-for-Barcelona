"""M2-A2-04 Continuous multi-day run over Madrid local days x drainage scenarios (Agent 2).

PREPARATION ONLY. This module runs whatever Domain/rain it is given; it fetches no data.
A Barcelona run must not be started until gates G1-G8 pass (docs/milestone2_plan.md).

Design: one continuous run per drainage scenario from local 00:00 of `spinup_day`
(default 2 Oct 2026) to local 24:00 of `end_day` (7 Oct), output every local day (DST-aware
edges from data.timewindows). The spin-up day is reported with status "SPINUP" and excluded
from `results`. State is never reset between days.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from datetime import date

import numpy as np

from .daily import local_daily_summaries, local_day_edges
from .drainage import load_scenarios
from .local_inertial import DEFAULT_ALPHA, DEFAULT_DT_MAX, Domain, State, check_numerics, run


@dataclass
class CampaignPlan:
    spinup_day: date
    first_day: date
    end_day: date
    t0_utc: object
    day_edges_s: list[float]
    scenarios: dict
    n_cells: int
    dx: float
    est_steps_upper: int  # at dt_max (wet steps can be smaller)


def plan(dom: Domain, spinup_day=date(2026, 10, 2), end_day=date(2026, 10, 7),
         dt_max: float = DEFAULT_DT_MAX, scenario_names=("low", "mid", "high")) -> CampaignPlan:
    from bcnflood.data.timewindows import local_day_window

    t0 = local_day_window(spinup_day).start_utc
    edges = local_day_edges(spinup_day, end_day, t0)
    sc = load_scenarios()
    return CampaignPlan(spinup_day, date.fromordinal(spinup_day.toordinal() + 1), end_day, t0,
                        edges, {k: sc[k] for k in scenario_names}, int(dom.z.size), dom.dx,
                        int(np.ceil(edges[-1] / dt_max)))


def execute(dom: Domain, rain_fn, p: CampaignPlan, alpha=DEFAULT_ALPHA,
            dt_max=DEFAULT_DT_MAX, output_interval: float = 3600.0,
            override: bool = False) -> dict:
    """Run each drainage scenario continuously. rain_fn(t) in model seconds from p.t0_utc.
    output_interval must divide every local-day length (3600 s works on DST days)."""
    check_numerics(alpha, dt_max, override)
    if not getattr(rain_fn, "breakpoints", None):
        raise ValueError("campaign rain must come from piecewise_rain (breakpoints required)")
    out = {}
    for name, scn in p.scenarios.items():
        d = copy.deepcopy(dom)
        d.drainage_capacity = np.asarray(d.drainage_capacity, float) + scn.capacity_m_s
        s = State.dry(d.z.shape)
        snaps, led = run(d, s, rain_fn, p.day_edges_s[-1], output_interval, alpha, dt_max,
                         override=override)
        days = local_daily_summaries(snaps, p.spinup_day, p.end_day, p.t0_utc)
        for x in days:
            x["drainage_scenario"] = {"name": name, "capacity_mm_h": scn.capacity_mm_h,
                                      "kind": "assumption"}
        days[0]["status"] = "SPINUP"
        out[name] = {"spinup": days[0], "results": days[1:], "ledger": led}
    return out
