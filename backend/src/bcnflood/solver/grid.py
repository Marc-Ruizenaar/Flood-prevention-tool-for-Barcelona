"""M2-A2-03 Raster entry point: run_grid(GridInputs) -> GridOutputs (Agent 2).

Takes validated arrays only; fetches nothing. SI inside; rainfall given in mm per interval.
Conventions / ASSUMPTIONS (documented, not sourced):
  * building cells and cells outside `active_mask` are blocked: raised by BLOCK_HEIGHT_M so
    no surface water enters. Rain outside `active_mask` is ignored (outside the domain).
  * roof rain (ASSUMPTION, downspouts, no source): rain on each connected building block is
    first reduced by green-roof interception (mitigation lever), then spread equally over the
    open cells adjacent to the block (topology.RoofRouter). Blocks without open neighbours
    are booked as `roof_unrouted_m3`. Set route_roof_rain=False to book all roof rain there.
  * outlets: `outlet_mask` cells are free-outfall sinks. If None and sea_outlet=True, the mask
    is DEM <= 0 m connected to the sea/NoData side (topology.sea_outlet_mask; ASSUMPTION).
  * checkpoint/resume: GridRun is picklable; see launch.py.
  * rainfall: stations x intervals depth [mm]; field = sum_s w_s * rain_s, with weights either
    (n_stations,) uniform-in-space or (n_stations, ny, nx) per cell (e.g. Thiessen/IDW),
    summing to 1 on active cells. Piecewise constant per interval; steps cut at edges.
  * drainage: DrainageScenario (assumption) added to drainage_capacity.
  * mitigation: list of mitigation.Lever (assumption).
Model-time 0 = rain_times_utc[0]. Daily breakdown uses Europe/Madrid local days that fully
lie inside the simulated span (data.timewindows).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from .drainage import DrainageScenario
from .local_inertial import (
    ALPHA_LIMIT,
    DEFAULT_ALPHA,
    DEFAULT_DT_MAX,
    DT_MAX_LIMIT,
    Domain,
    G,
    GreenAmpt,
    Ledger,
    State,
    cfl_dt,
    check_numerics,
    step,
)
from .mitigation import Lever, apply_static
from .topology import RoofRouter, sea_outlet_mask

BLOCK_HEIGHT_M = 100.0
EXPECTED_CRS = "EPSG:25831"


@dataclass
class GridInputs:
    dem_m: np.ndarray
    manning_n: np.ndarray
    ga_k_sat_m_s: np.ndarray
    ga_psi_m: np.ndarray
    ga_delta_theta: np.ndarray
    building_mask: np.ndarray
    dx_m: float
    crs: str
    rain_times_utc: list[datetime]  # interval edges, len = n_intervals + 1, aware
    rain_mm: np.ndarray  # (n_intervals, n_stations) depth per interval [mm]
    station_weights: np.ndarray  # (n_stations,) or (n_stations, ny, nx)
    drainage_scenario: DrainageScenario | None = None
    mitigation: list[Lever] = field(default_factory=list)
    active_mask: np.ndarray | None = None
    pervious_mask: np.ndarray | None = None
    outlet_mask: np.ndarray | None = None
    alpha: float = DEFAULT_ALPHA
    dt_max_s: float = DEFAULT_DT_MAX
    sea_outlet: bool = True
    route_roof_rain: bool = True
    snapshot_interval_s: float | None = None  # store h (float32) + ledger every interval
    speed_min_depth_m: float = 0.01  # faces shallower than this are ignored for max speed
    override_numerics: bool = False  # G6: allow alpha > 0.35 / dt_max > 2 s (warns)
    edge_outflow_mask: np.ndarray | None = None  # critical-depth outflow cells (ASSUMPTION)
    river_outlets: bool = True  # if edge_outflow_mask is None: Besos/Llobregat edge cells
    river_outlet_max_elev_m: float = 10.0
    crop_to_active: bool = True  # compute on the active bounding box only
    diagnostics: bool = True  # M2-A2-06 per-cell budget / inflow directions / peak times
    rain_station_ids: list[str] | None = None  # station id per rain_mm column (same order)
    # per-interval weight overrides {interval index: (n_st, ny, nx)}, e.g. gap re-weighting
    station_weights_by_interval: dict | None = None
    rain_notes: dict | None = None  # provenance / fill log, copied to summary.json
    x0_m: float | None = None  # upper-left corner x of cell (0, 0) in `crs` [m]
    y0_m: float | None = None  # upper-left corner y (row 0 = north; y decreases with row)


@dataclass
class GridOutputs:
    max_depth_m: np.ndarray
    time_above_0_10m_s: np.ndarray
    time_above_0_30m_s: np.ndarray
    daily: list[dict]
    mass_balance: dict
    steps: int
    max_speed_m_s: np.ndarray | None = None
    outlet_mask: np.ndarray | None = None
    snapshots: dict | None = None  # t_s, h (nt,ny,nx) float32, ledger rows, storage
    peak_time_utc_s: np.ndarray | None = None  # seconds after t0_utc of the max depth (NaN=dry)
    diagnostics: dict | None = None  # M2-A2-06
    t0_utc: str | None = None
    crop_slices: tuple | None = None
    units: dict = field(default_factory=lambda: {
        "max_depth_m": "m", "time_above_0_10m_s": "s", "time_above_0_30m_s": "s",
        "max_speed_m_s": "m/s", "volumes": "m3", "kind": "simulated"})


def _req(cond, msg):
    if not cond:
        raise ValueError(msg)


def validate(g: GridInputs) -> None:
    z = np.asarray(g.dem_m)
    _req(z.ndim == 2 and min(z.shape) >= 2, "dem_m must be 2D, >= 2x2")
    shp = z.shape
    for name in ("manning_n", "ga_k_sat_m_s", "ga_psi_m", "ga_delta_theta", "building_mask"):
        _req(np.shape(getattr(g, name)) == shp, f"{name} shape != {shp}")
    for name in ("active_mask", "pervious_mask", "outlet_mask"):
        v = getattr(g, name)
        _req(v is None or (np.shape(v) == shp and np.asarray(v).dtype == bool),
             f"{name} must be bool {shp}")
    _req(np.asarray(g.building_mask).dtype == bool, "building_mask must be bool")
    act = np.ones(shp, bool) if g.active_mask is None else g.active_mask
    _req(np.isfinite(z[act]).all(), "dem_m has non-finite values on active cells")
    _req(np.all((z[act] > -50) & (z[act] < 2000)), "dem_m outside [-50, 2000] m: units?")
    n = np.asarray(g.manning_n)[act]
    _req(np.all((n > 0.005) & (n < 0.5)), "manning_n outside (0.005, 0.5) s m^-1/3")
    k = np.asarray(g.ga_k_sat_m_s)[act]
    _req(np.all((k >= 0) & (k < 1e-3)), "ga_k_sat_m_s outside [0, 1e-3) m/s: units?")
    _req(np.all((np.asarray(g.ga_psi_m)[act] >= 0) & (np.asarray(g.ga_psi_m)[act] < 5)),
         "ga_psi_m outside [0, 5) m")
    dt = np.asarray(g.ga_delta_theta)[act]
    _req(np.all((dt >= 0) & (dt <= 1)), "ga_delta_theta outside [0, 1]")
    _req(np.isfinite(g.dx_m) and 0.5 <= g.dx_m <= 1000, "dx_m outside [0.5, 1000] m")
    _req(g.crs == EXPECTED_CRS, f"crs must be {EXPECTED_CRS}")
    ts = g.rain_times_utc
    _req(all(t.tzinfo is not None for t in ts), "rain_times_utc must be timezone-aware")
    _req(all(b > a for a, b in zip(ts[:-1], ts[1:], strict=True)), "rain times not increasing")
    r = np.asarray(g.rain_mm, float)
    _req(r.ndim == 2 and r.shape[0] == len(ts) - 1, "rain_mm must be (n_intervals, n_stations)")
    _req(np.isfinite(r).all() and (r >= 0).all(), "rain_mm must be finite and >= 0 (no gaps)")
    dts = np.array([(b - a).total_seconds() for a, b in zip(ts[:-1], ts[1:], strict=True)])
    _req(np.all(r / dts[:, None] * 3600 < 500), "rain intensity >= 500 mm/h: units?")
    w = np.asarray(g.station_weights, float)
    ns = r.shape[1]
    _req(g.rain_station_ids is None or (len(g.rain_station_ids) == ns and
         len(set(g.rain_station_ids)) == ns), "rain_station_ids must match rain_mm columns")
    _req(w.shape in ((ns,), (ns, *shp)), "station_weights must be (n_st,) or (n_st, ny, nx)")
    _req((w >= 0).all(), "station_weights must be >= 0")
    tot = w.sum(axis=0)
    _req(np.allclose(tot if w.ndim == 1 else tot[act], 1.0, atol=1e-9),
         "station_weights must sum to 1")
    for k, wk in (g.station_weights_by_interval or {}).items():
        wk = np.asarray(wk, float)
        _req(0 <= int(k) < r.shape[0], f"weight override interval {k} out of range")
        _req(wk.shape == (ns, *shp) and (wk >= 0).all() and np.isfinite(wk).all(),
             f"weight override {k} must be finite >= 0 with shape (n_st, ny, nx)")
        _req(np.allclose(wk.sum(axis=0)[act], 1.0, atol=1e-9),
             f"weight override {k} must sum to 1 on active cells")
    _req(g.drainage_scenario is None or g.drainage_scenario.kind == "assumption",
         "drainage scenario must be kind=assumption")
    _req(np.isfinite(g.alpha) and np.isfinite(g.dt_max_s) and g.alpha > 0 and g.dt_max_s > 0,
         "alpha/dt_max must be finite and > 0")
    check_numerics(g.alpha, g.dt_max_s, g.override_numerics)


CUM_KEYS = ("rain_gross", "roof_storage", "roof_unrouted", "tank_storage", "edge_outflow",
            "tank_release")
ACC_KEYS = ("in_W", "in_E", "in_N", "in_S", "lat_out", "infil", "drain", "outflow", "clip",
            "rain_direct", "roof_in", "tank", "edge_out")
DIR_CODES = {0: "N", 1: "E", 2: "S", 3: "W", -1: "none"}


def crop_inputs(g: GridInputs, sl=None):
    """Crop all (ny, nx) inputs to `sl` (default: bounding box of active_mask).
    Returns (g_c, slices)."""
    from dataclasses import replace
    if sl is None:
        if g.active_mask is None or not g.crop_to_active:
            return g, None
        ys, xs = np.nonzero(g.active_mask)
        sl = (slice(int(ys.min()), int(ys.max()) + 1),
              slice(int(xs.min()), int(xs.max()) + 1))
        if g.active_mask[sl].shape == g.active_mask.shape:
            return g, None
    c = lambda a: None if a is None else np.asarray(a)[sl]  # noqa: E731
    w = np.asarray(g.station_weights)
    levers = [replace(lv, cells=lv.cells[sl]) for lv in g.mitigation]
    return replace(g, dem_m=c(g.dem_m), manning_n=c(g.manning_n),
                   ga_k_sat_m_s=c(g.ga_k_sat_m_s), ga_psi_m=c(g.ga_psi_m),
                   ga_delta_theta=c(g.ga_delta_theta), building_mask=c(g.building_mask),
                   active_mask=c(g.active_mask), pervious_mask=c(g.pervious_mask),
                   outlet_mask=c(g.outlet_mask), edge_outflow_mask=c(g.edge_outflow_mask),
                   station_weights=w[(slice(None), *sl)] if w.ndim == 3 else w,
                   station_weights_by_interval=None if not g.station_weights_by_interval else
                   {k: np.asarray(v)[(slice(None), *sl)]
                    for k, v in g.station_weights_by_interval.items()},
                   mitigation=levers, crop_to_active=False,
                   x0_m=None if g.x0_m is None else g.x0_m + sl[1].start * g.dx_m,
                   y0_m=None if g.y0_m is None else g.y0_m - sl[0].start * g.dx_m), sl


class GridRun:
    """Resumable run. Construct, then advance(t_stop) repeatedly; finish() -> GridOutputs."""

    def __init__(self, g: GridInputs):
        from bcnflood.data.timewindows import local_day_of, local_day_windows

        validate(g)
        self.full_shape = g.dem_m.shape
        g, self.crop = crop_inputs(g)
        self.g = g
        shp = g.dem_m.shape
        act = np.ones(shp, bool) if g.active_mask is None else g.active_mask.copy()
        self.act = act
        self.bld = g.building_mask & act
        blocked = self.bld | ~act
        self.open_ = ~blocked
        outlet = g.outlet_mask
        if outlet is None and g.sea_outlet:
            outlet = sea_outlet_mask(np.where(act, g.dem_m, np.nan), act) & self.open_
        if outlet is not None:
            outlet = outlet & self.open_  # outlets only on open active cells
        self.outlet = outlet
        em = g.edge_outflow_mask
        if em is None and g.river_outlets:
            from .topology import river_edge_outlets
            em = river_edge_outlets(np.where(act, g.dem_m, np.inf), act,
                                    g.river_outlet_max_elev_m,
                                    sea=outlet if outlet is not None else None)["all"]
            if not em.any():
                em = None
        self.edge_out = None if em is None else em & self.open_ & ~(
            outlet if outlet is not None else np.zeros(shp, bool))
        self.numerics_override = not (g.alpha <= ALPHA_LIMIT and g.dt_max_s <= DT_MAX_LIMIT)
        zmax = float(np.max(g.dem_m[act]))
        z = np.where(blocked, zmax + BLOCK_HEIGHT_M, np.where(act, g.dem_m, 0.0))
        n = np.where(act, g.manning_n, 0.03)
        dom = Domain(z=z, dx=g.dx_m, manning_n=n, outlet=outlet,
                     drainage_capacity=np.where(self.open_, g.drainage_scenario.capacity_m_s,
                                                0.0) if g.drainage_scenario else 0.0,
                     infiltration=GreenAmpt(g.ga_k_sat_m_s, g.ga_psi_m, g.ga_delta_theta),
                     pervious=(np.ones(shp, bool) if g.pervious_mask is None
                               else g.pervious_mask) & self.open_)
        self.dom = apply_static(dom, g.mitigation)
        self.area = g.dx_m**2
        self.t0 = g.rain_times_utc[0]
        self.edges = np.array([(t - self.t0).total_seconds() for t in g.rain_times_utc])
        self.rates = np.asarray(g.rain_mm, float) * 1e-3 / np.diff(self.edges)[:, None]
        w = np.asarray(g.station_weights, float)
        self.w = w[:, None, None] * np.ones((1, *shp)) if w.ndim == 1 else w
        self.w_by_k = {int(k): np.asarray(v, float)
                       for k, v in (g.station_weights_by_interval or {}).items()}
        self.router = RoofRouter(self.bld, self.open_) if g.route_roof_rain else None
        self.tanks = [lv for lv in g.mitigation if lv.kind == "tank"]
        self.roofs = [lv for lv in g.mitigation if lv.kind == "green_roof"]
        self.tank_level = [0.0 for _ in self.tanks]  # m3 currently stored
        self.roof_left = [np.where(r.cells & act, float(r.params["storage_m"]), 0.0)
                          for r in self.roofs]
        self.led = Ledger(numerics_override=self.numerics_override)
        self.cum = dict.fromkeys(CUM_KEYS, 0.0)
        self.s = State.dry(shp)
        self.t_end = float(self.edges[-1])
        days = [d for d in local_day_windows(local_day_of(self.t0),
                                             local_day_of(g.rain_times_utc[-1]))
                if d.start_utc >= self.t0 and d.end_utc <= g.rain_times_utc[-1]]
        self.days = days
        self.day_se = [((d.start_utc - self.t0).total_seconds(),
                        (d.end_utc - self.t0).total_seconds()) for d in days]
        cuts = set(self.edges.tolist())
        for a, b in self.day_se:
            cuts |= {a, b}
        if g.snapshot_interval_s:
            cuts |= set(np.arange(0, self.t_end, g.snapshot_interval_s).tolist())
        self.cuts = sorted(cuts | {self.t_end})
        # G6(b): every rain interval edge is a step cut (piecewise-constant rain, exact volume)
        assert set(self.edges.tolist()) <= set(self.cuts), "rain edges must be step cuts"
        self.hmax = np.zeros(shp)
        self.umax = np.zeros(shp)
        self.ta10, self.ta30 = np.zeros(shp), np.zeros(shp)
        self.per_day = [{"hmax": np.zeros(shp), "t10": np.zeros(shp), "t30": np.zeros(shp),
                         "umax": np.zeros(shp), "b0": None, "b1": None} for _ in days]
        self.snaps = {"t_s": [], "h": [], "ledger": [], "storage": []}
        self.acc = {k: np.zeros(shp) for k in ACC_KEYS} if g.diagnostics else None
        self.tpeak = np.full(shp, np.nan)
        for pd in self.per_day:
            pd["tpeak"] = np.full(shp, np.nan)
        self.ci = 0
        self.k = 0
        self._mark()

    # -- bookkeeping
    def storage(self) -> float:
        return float(self.s.h.sum() * self.area)

    def _book(self):
        return (self.led.copy(), dict(self.cum), self.storage())

    def _mark(self):
        t = self.s.t
        for j, (a, b) in enumerate(self.day_se):
            if self.per_day[j]["b0"] is None and abs(t - a) < 1e-6:
                self.per_day[j]["b0"] = self._book()
                if self.acc is not None:
                    self.per_day[j]["in0"] = [self.acc[k].copy()
                                              for k in ("in_N", "in_E", "in_S", "in_W")]
            if self.per_day[j]["b1"] is None and abs(t - b) < 1e-6:
                self.per_day[j]["b1"] = self._book()
                if self.acc is not None:
                    self.per_day[j]["in1"] = [self.acc[k].copy()
                                              for k in ("in_N", "in_E", "in_S", "in_W")]
        si = self.g.snapshot_interval_s
        if si and (abs(t / si - round(t / si)) < 1e-9 or abs(t - self.t_end) < 1e-6):
            led = self.led
            self.snaps["t_s"].append(t)
            self.snaps["h"].append(self.s.h.astype(np.float32))
            self.snaps["ledger"].append([led.rain, led.infiltration, led.drainage,
                                         led.outflow, led.clip, *self.cum.values()])
            self.snaps["storage"].append(self.storage())

    def _speed(self) -> np.ndarray:
        s, z = self.s, self.dom.z
        eta = z + s.h
        hx = np.maximum(eta[:, 1:], eta[:, :-1]) - np.maximum(z[:, 1:], z[:, :-1])
        hy = np.maximum(eta[1:, :], eta[:-1, :]) - np.maximum(z[1:, :], z[:-1, :])
        hm = self.g.speed_min_depth_m
        ux = np.where(hx > hm, np.abs(s.qx) / np.maximum(hx, hm), 0.0)
        uy = np.where(hy > hm, np.abs(s.qy) / np.maximum(hy, hm), 0.0)
        u = np.zeros_like(s.h)
        u[:, :-1] = np.maximum(u[:, :-1], ux)
        u[:, 1:] = np.maximum(u[:, 1:], ux)
        u[:-1, :] = np.maximum(u[:-1, :], uy)
        u[1:, :] = np.maximum(u[1:, :], uy)
        return u

    # -- stepping
    def done(self) -> bool:
        return self.s.t >= self.t_end - 1e-9

    def advance(self, t_stop: float | None = None, max_steps: int | None = None) -> None:
        t_stop = self.t_end if t_stop is None else min(t_stop, self.t_end)
        n = 0
        s, dt_area = self.s, self.area
        while s.t < t_stop - 1e-9 and (max_steps is None or n < max_steps):
            while self.ci < len(self.cuts) and self.cuts[self.ci] <= s.t + 1e-9:
                self.ci += 1
            while self.k + 1 < len(self.edges) - 1 and self.edges[self.k + 1] <= s.t + 1e-9:
                self.k += 1
            nxt = min(self.cuts[self.ci] if self.ci < len(self.cuts) else self.t_end, t_stop)
            dt = min(cfl_dt(self.dom, s, self.g.alpha, self.g.dt_max_s), nxt - s.t)
            f = np.einsum("s,syx->yx", self.rates[self.k], self.w_by_k.get(self.k, self.w))
            f = np.where(self.act, f, 0.0)
            self.cum["rain_gross"] += float(f.sum()) * dt * dt_area
            for i, _ in enumerate(self.roofs):  # green roof first (any lever cell)
                take = np.minimum(self.roof_left[i], f * dt)
                self.roof_left[i] -= take
                f = f - take / dt
                self.cum["roof_storage"] += float(take.sum()) * dt_area
            fb = np.where(self.bld, f, 0.0)
            f = np.where(self.open_, f, 0.0)
            acc = self.acc
            if acc is not None:
                acc["rain_direct"] += f * dt
            if self.router is not None:
                add, unr = self.router.route(fb)
                f = f + add
                if acc is not None:
                    acc["roof_in"] += add * dt
            else:
                unr = float(fb.sum())
            self.cum["roof_unrouted"] += unr * dt * dt_area
            step(self.dom, s, dt, f, self.led, acc=acc)
            if self.edge_out is not None:  # critical-depth free outflow, q = sqrt(g h^3)
                hh = np.where(self.edge_out, s.h, 0.0)
                rem = np.minimum(hh, np.sqrt(G) * hh**1.5 * dt / self.g.dx_m)
                s.h -= rem
                self.cum["edge_outflow"] += float(rem.sum()) * dt_area
                if acc is not None:
                    acc["edge_out"] += rem
            for i, tk in enumerate(self.tanks):
                # drain-down (ASSUMPTION, no source): stored water released to the sewer
                dry = not np.any(self.rates[self.k] > 0)  # current rain interval is dry
                allow = dry or not tk.params.get("drain_down_after_rain_only", False)
                rel = min(self.tank_level[i],
                          float(tk.params.get("drain_down_m3_s", 0.0)) * dt) if allow else 0.0
                self.tank_level[i] -= rel
                self.cum["tank_release"] += rel
                room = float(tk.params["volume_m3"]) - self.tank_level[i]
                rate = float(tk.params.get("inflow_mm_h", np.inf)) * 1e-3 / 3600.0
                cap = np.where(tk.cells, np.minimum(s.h, rate * dt), 0.0)
                want = float(cap.sum()) * dt_area
                if want > room and want > 0:
                    cap *= room / want
                    want = room
                s.h -= cap
                self.tank_level[i] += want
                self.cum["tank_storage"] += want
                if acc is not None:
                    acc["tank"] += cap
            u = self._speed()
            up = s.h > self.hmax
            self.tpeak[up] = s.t
            np.maximum(self.hmax, s.h, out=self.hmax)
            np.maximum(self.umax, u, out=self.umax)
            a10, a30 = dt * (s.h > 0.10), dt * (s.h > 0.30)
            self.ta10 += a10
            self.ta30 += a30
            tmid = s.t - dt / 2
            for j, (a, b) in enumerate(self.day_se):
                if a <= tmid < b:
                    pd = self.per_day[j]
                    upd = s.h > pd["hmax"]
                    pd["tpeak"][upd] = s.t
                    np.maximum(pd["hmax"], s.h, out=pd["hmax"])
                    np.maximum(pd["umax"], u, out=pd["umax"])
                    pd["t10"] += a10
                    pd["t30"] += a30
            if abs(s.t - round(s.t, 6)) < 1e-7:
                s.t = round(s.t, 6)
            self._mark()
            n += 1

    @staticmethod
    def budget(b0, b1) -> dict:
        (l0, c0, s0), (l1, c1, s1) = b0, b1
        t = {"rain_m3": c1["rain_gross"] - c0["rain_gross"],
             "rain_applied_m3": l1.rain - l0.rain,
             "roof_storage_m3": c1["roof_storage"] - c0["roof_storage"],
             "roof_unrouted_m3": c1["roof_unrouted"] - c0["roof_unrouted"],
             "infiltration_m3": l1.infiltration - l0.infiltration,
             "drainage_m3": l1.drainage - l0.drainage, "outflow_m3": l1.outflow - l0.outflow,
             "tank_storage_m3": c1["tank_storage"] - c0["tank_storage"],
             "tank_release_m3": c1["tank_release"] - c0["tank_release"],
             "edge_outflow_m3": c1["edge_outflow"] - c0["edge_outflow"],
             "clip_m3": l1.clip - l0.clip, "storage_start_m3": s0, "storage_end_m3": s1}
        exp = (t["rain_m3"] - t["roof_storage_m3"] - t["roof_unrouted_m3"] + t["clip_m3"]
               - t["infiltration_m3"] - t["drainage_m3"] - t["outflow_m3"]
               - t["tank_storage_m3"] - t["edge_outflow_m3"])
        t["mass_balance_error_rel"] = abs((s1 - s0) - exp) / max(t["rain_m3"], s0, 1e-12)
        return t

    def finish(self) -> GridOutputs:
        if not self.done():
            raise RuntimeError("run not finished")
        daily = []
        for d, pd in zip(self.days, self.per_day, strict=True):
            e = {"local_date": d.local_date.isoformat(), "tz": d.tz,
                 "window_utc": (d.start_utc.isoformat(), d.end_utc.isoformat()),
                 "max_depth_m": pd["hmax"], "max_speed_m_s": pd["umax"],
                 "time_above_0_10m_s": pd["t10"], "time_above_0_30m_s": pd["t30"],
                 "status": "SIMULATED"}
            if pd["b0"] is None or pd["b1"] is None:
                e["status"] = "INCOMPLETE"
            else:
                e["budget"] = self.budget(pd["b0"], pd["b1"])
            daily.append(e)
        mb = self.budget((Ledger(), dict.fromkeys(CUM_KEYS, 0.0), 0.0), self._book())
        snaps = None
        if self.g.snapshot_interval_s:
            snaps = {"t_s": np.array(self.snaps["t_s"]), "h": np.stack(self.snaps["h"]),
                     "ledger": np.array(self.snaps["ledger"]),
                     "ledger_columns": ["rain_applied", "infiltration", "drainage", "outflow",
                                        "clip", *CUM_KEYS],
                     "storage": np.array(self.snaps["storage"])}
        mb["tank_level_m3"] = list(self.tank_level)
        mb["numerics_override"] = self.numerics_override
        mb["numerics"] = {"alpha": self.g.alpha, "dt_max_s": self.g.dt_max_s,
                          "limits": {"alpha": ALPHA_LIMIT, "dt_max_s": DT_MAX_LIMIT}}
        mb["edge_outflow_cells"] = int(0 if self.edge_out is None else self.edge_out.sum())
        mb["edge_outflow_kind"] = "assumption: critical depth q = sqrt(g h^3)"
        diag = self._diagnostics(daily) if self.acc is not None else None
        out = GridOutputs(self.hmax, self.ta10, self.ta30, daily, mb, self.led.steps,
                          self.umax, self.outlet, snaps)
        out.peak_time_utc_s = self.tpeak
        out.diagnostics = diag
        out.t0_utc = self.t0.isoformat()
        return uncrop_outputs(out, self.crop, self.full_shape)

    def _diagnostics(self, daily) -> dict:
        from .hotspots import d8_accumulation, depression_depth, slope

        a, cell_a = self.acc, self.area
        g = self.g
        lat_in = a["in_N"] + a["in_E"] + a["in_S"] + a["in_W"]
        bud = {"rain_in_m": a["rain_direct"], "roof_in_m": a["roof_in"],
               "lateral_in_m": lat_in, "lateral_out_m": a["lat_out"],
               "infiltration_m": a["infil"], "drainage_m": a["drain"],
               "outflow_m": a["outflow"] + a["edge_out"], "tank_m": a["tank"],
               "clip_m": a["clip"], "storage_change_m": self.s.h.copy()}
        res = (bud["rain_in_m"] + bud["roof_in_m"] + lat_in - a["lat_out"] - a["infil"]
               - a["drain"] - bud["outflow_m"] - a["tank"] + a["clip"]
               - bud["storage_change_m"])
        scale = np.maximum.reduce([bud["rain_in_m"] + bud["roof_in_m"] + lat_in,
                                   np.full(res.shape, 1e-12)])
        bud["residual_rel"] = np.abs(res) / scale
        dirs = np.stack([a["in_N"], a["in_E"], a["in_S"], a["in_W"]])
        dom = np.where(dirs.max(0) > 0, dirs.argmax(0), -1)
        act = self.act
        mean_rain = (self.cum["rain_gross"] / cell_a) / max(int(act.sum()), 1)
        contrib = ((lat_in + a["rain_direct"] + a["roof_in"]) / mean_rain * cell_a
                   if mean_rain > 0 else np.zeros_like(lat_in))
        for d, pd in zip(daily, self.per_day, strict=True):
            if "in0" in pd and "in1" in pd:
                dd = np.stack([b - c for b, c in zip(pd["in1"], pd["in0"], strict=True)])
                d["inflow_by_dir_m3"] = {k: dd[i] * cell_a for i, k in enumerate("NESW")}
                d["dominant_inflow_dir"] = np.where(dd.max(0) > 0, dd.argmax(0), -1)
            d["peak_time_utc_s"] = pd["tpeak"]
        zb = np.where(act, g.dem_m, 0.0)
        return {"cell_budget": bud,
                "inflow_by_dir_m3": {k: dirs[i] * cell_a for i, k in enumerate("NESW")},
                "dominant_inflow_dir": dom, "dir_codes": DIR_CODES,
                "contributing_area_flux_m2": contrib,
                "contributing_area_note": "simulated: (lateral inflow + rain on cell) volume / "
                                          "domain-mean gross rain depth; kind=simulated",
                "d8_accumulation_m2_crosscheck": d8_accumulation(zb, act, g.dx_m),
                "depression_depth_m": depression_depth(zb, act),
                "slope_m_m": slope(zb, act, g.dx_m),
                "terrain_note": "D8 = terrain cross-check only (kind=terrain_diagnostic)"}


def run_grid(g: GridInputs) -> GridOutputs:
    r = GridRun(g)
    r.advance()
    return r.finish()


def uncrop_outputs(o: GridOutputs, sl, full_shape):
    """Embed every cropped (ny_c, nx_c) array back into the full grid (0 / NaN padding)."""
    if sl is None:
        return o
    cshape = o.max_depth_m.shape

    def emb(v):
        if isinstance(v, np.ndarray) and v.shape == cshape:
            fill = np.nan if v.dtype.kind == "f" and np.isnan(v).any() else 0
            out = np.full(full_shape, fill, dtype=v.dtype)
            out[sl] = v
            return out
        if isinstance(v, np.ndarray) and v.ndim == 3 and v.shape[1:] == cshape:
            out = np.zeros((v.shape[0], *full_shape), v.dtype)
            out[(slice(None), *sl)] = v
            return out
        if isinstance(v, dict):
            return {k: emb(x) for k, x in v.items()}
        if isinstance(v, list):
            return [emb(x) for x in v]
        return v
    for k, v in list(vars(o).items()):
        setattr(o, k, emb(v))
    o.crop_slices = ((sl[0].start, sl[0].stop), (sl[1].start, sl[1].stop))
    return o
