"""M2-A2-05 Mitigation scenarios (Agent 2). Re-runs the physics with 4 levers.

RESULTS ARE MODEL SCENARIOS, NOT GUARANTEES. Every lever parameter is kind="assumption".
No lever value has a primary or literature source in this repo: each `source` field says so.
Values must be set by the caller (defaults are placeholders for synthetic tests only).

Levers (all implemented with the unchanged local-inertial step + extra booked sinks):
  drain     : drainage_capacity += extra_mm_h on selected cells (sink rate, ledger.drainage)
  suds      : permeable paving/SUDS: selected cells become pervious with a given Green-Ampt
              k_sat (needs dom.infiltration, ledger.infiltration)
  tank      : detention tanks at chosen cells with a finite volume [m^3]; each step the tank
              captures surface water up to its inflow rate and free volume (booked as
              tank_storage = cumulative capture). Optional drain_down_m3_s (ASSUMPTION, no
              source) empties the tank to the sewer (booked tank_release; level = capture -
              release), restoring capacity.
  green_roof: rain interception on building cells up to a storage depth [m] (booked as
              roof storage; excess rain passes through)
Output per local day: delta in max depth per cell vs baseline (scenario - baseline) [m].
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field

import numpy as np

from .local_inertial import (
    DEFAULT_ALPHA,
    DEFAULT_DT_MAX,
    Domain,
    GreenAmpt,
    Ledger,
    State,
    cfl_dt,
    check_numerics,
    step,
)

NO_SOURCE = "no source: placeholder ASSUMPTION, must be set/approved by the user"


@dataclass
class Lever:
    kind: str  # drain | suds | tank | green_roof
    cells: np.ndarray  # bool mask (ny, nx)
    params: dict
    label: str = "assumption"
    source: str = NO_SOURCE


@dataclass
class MitigationLedger:
    tank_storage: float = 0.0  # m^3 currently held in tanks
    roof_storage: float = 0.0  # m^3 intercepted on green roofs
    extra: dict = field(default_factory=dict)


def apply_static(dom: Domain, levers: list[Lever]) -> Domain:
    d = copy.deepcopy(dom)
    shape = d.z.shape
    for lv in levers:
        if lv.label != "assumption":
            raise ValueError("every lever must be labelled 'assumption'")
        if lv.kind == "drain":
            cap = np.broadcast_to(np.asarray(d.drainage_capacity, float), shape).copy()
            cap[lv.cells] += lv.params["extra_mm_h"] * 1e-3 / 3600.0
            d.drainage_capacity = cap
        elif lv.kind == "suds":
            if d.infiltration is None:
                raise ValueError("suds lever needs a Green-Ampt baseline")
            ga = d.infiltration
            k = np.broadcast_to(np.asarray(ga.k_sat, float), shape).copy()
            k[lv.cells] = lv.params["k_sat_m_s"]
            psi = np.broadcast_to(np.asarray(ga.psi, float), shape).copy()
            dth = np.broadcast_to(np.asarray(ga.delta_theta, float), shape).copy()
            if "psi_m" in lv.params:
                psi[lv.cells] = lv.params["psi_m"]
            if "delta_theta" in lv.params:
                dth[lv.cells] = lv.params["delta_theta"]
            d.infiltration = GreenAmpt(k, psi, dth)
            perv = np.ones(shape, bool) if d.pervious is None else d.pervious.copy()
            perv[lv.cells] = True
            d.pervious = perv
    return d


def run_mitigated(dom: Domain, s: State, rain_fn, t_end: float, output_interval: float,
                  levers: list[Lever], alpha=DEFAULT_ALPHA, dt_max=DEFAULT_DT_MAX,
                  h_dry=1e-6, breakpoints=None, override: bool = False):
    """Like local_inertial.run but with tank and green-roof levers applied each step.
    Returns (times, max_depth_fields_per_interval, ledger, mitigation_ledger, storages)."""
    check_numerics(alpha, dt_max, override)
    d = apply_static(dom, levers)
    area = d.dx**2
    tanks = [lv for lv in levers if lv.kind == "tank"]
    roofs = [lv for lv in levers if lv.kind == "green_roof"]
    tank_level = [0.0 for _ in tanks]
    roof_left = [np.where(r.cells, float(r.params["storage_m"]), 0.0) for r in roofs]
    led, mled = Ledger(), MitigationLedger()
    bps = breakpoints if breakpoints is not None else getattr(rain_fn, "breakpoints", ())
    bps = sorted(b for b in bps if s.t < b < t_end)
    times, hmax_fields, storages = [s.t], [], [float(s.h.sum() * area)]
    hmax = s.h.copy()
    next_out = s.t + output_interval
    while s.t < t_end - 1e-9:
        nb = min([b - s.t for b in bps if b > s.t + 1e-9], default=np.inf)
        dt = min(cfl_dt(d, s, alpha, dt_max), next_out - s.t, t_end - s.t, nb)
        r = rain_fn(s.t)
        # green roofs: intercept rain before it reaches the surface (book as roof storage).
        # Implemented as negative-free pre-step: step adds rain uniformly, then we remove the
        # intercepted depth from those cells (bounded by the rain just added).
        step(d, s, dt, r, led, h_dry)
        for i, _ in enumerate(roofs):
            take = np.minimum(np.minimum(roof_left[i], r * dt), s.h)
            s.h -= take
            roof_left[i] -= take
            mled.roof_storage += float(take.sum()) * area
        for i, tk in enumerate(tanks):
            # drain-down (ASSUMPTION, no source): stored water released to the sewer
            rel = min(tank_level[i], float(tk.params.get("drain_down_m3_s", 0.0)) * dt)
            tank_level[i] -= rel
            mled.extra["tank_release"] = mled.extra.get("tank_release", 0.0) + rel
            room = float(tk.params["volume_m3"]) - tank_level[i]
            rate = float(tk.params.get("inflow_mm_h", np.inf)) * 1e-3 / 3600.0
            cap_depth = np.where(tk.cells, np.minimum(s.h, rate * dt), 0.0)
            want = float(cap_depth.sum()) * area
            if want > room and want > 0:
                cap_depth *= room / want
                want = room
            s.h -= cap_depth
            tank_level[i] += want
            mled.tank_storage += want  # cumulative volume captured from the surface
        mled.extra["tank_level"] = list(tank_level)
        np.maximum(hmax, s.h, out=hmax)
        if s.t >= next_out - 1e-9 or s.t >= t_end - 1e-9:
            s.t = round(s.t, 6)
            times.append(s.t)
            hmax_fields.append(hmax.copy())
            storages.append(float(s.h.sum() * area))
            hmax = s.h.copy()
            next_out += output_interval
    return times, hmax_fields, led, mled, storages


def mass_balance_error_mitigated(storage0, storage1, led: Ledger, mled: MitigationLedger):
    exp = (led.rain + led.clip - led.infiltration - led.drainage - led.outflow
           - mled.tank_storage - mled.roof_storage)
    return abs((storage1 - storage0) - exp) / max(led.rain, storage0, 1e-12)


def delta_max_depth(base_fields, scen_fields):
    """Per-interval (e.g. per local day) scenario - baseline max depth per cell [m].
    Negative = reduction. kind='simulated' (model scenario, not a guarantee)."""
    return [s - b for b, s in zip(base_fields, scen_fields, strict=True)]
