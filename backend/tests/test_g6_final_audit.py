"""G6 final audit (Agent 3) of 3185aeb: override recording, critical-depth edge outflow at 30 m
(run_grid), tank drain-down booking. SYNTHETIC grids only, no Barcelona data."""
import json
import warnings
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

grid = pytest.importorskip("bcnflood.solver.grid")
from bcnflood.solver.local_inertial import (  # noqa: E402
    Domain,
    State,
    piecewise_rain,
    run,
)
from bcnflood.solver.mitigation import (  # noqa: E402
    Lever,
    mass_balance_error_mitigated,
    run_mitigated,
)

G = 9.81
T0 = datetime(2026, 10, 3, 0, tzinfo=UTC)


def _gi(z, hours=6, rain_mm=None, dx=30.0, **kw):
    ny, nx = z.shape
    times = [T0 + timedelta(hours=i) for i in range(hours + 1)]
    rain = np.zeros((hours, 1)) if rain_mm is None else rain_mm
    args = dict(dem_m=z, manning_n=np.full_like(z, 0.03), ga_k_sat_m_s=np.zeros_like(z),
                ga_psi_m=np.full_like(z, 0.11), ga_delta_theta=np.full_like(z, 0.3),
                building_mask=np.zeros((ny, nx), bool), dx_m=dx, crs="EPSG:25831",
                rain_times_utc=times, rain_mm=rain, station_weights=np.array([1.0]),
                outlet_mask=np.zeros((ny, nx), bool), sea_outlet=False, river_outlets=False,
                route_roof_rain=False, pervious_mask=np.zeros((ny, nx), bool))
    args.update(kw)
    return grid.GridInputs(**args)


def test_override_recorded_in_ledger():
    dom = Domain(z=np.zeros((3, 3)), dx=5.0, manning_n=0.03)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        _, led = run(dom, State.dry((3, 3)), piecewise_rain([0, 60], [1e-6]), 120.0, 60.0,
                     dt_max=10.0, override=True)
    assert led.numerics_override is True
    _, led2 = run(dom, State.dry((3, 3)), piecewise_rain([0, 60], [1e-6]), 120.0, 60.0)
    assert led2.numerics_override is False


def test_override_recorded_in_run_grid_and_summary_json(tmp_path):
    launch = pytest.importorskip("bcnflood.solver.launch")
    z = np.tile(np.linspace(1, 0, 6), (3, 1))
    rain = np.zeros((2, 1))
    rain[0, 0] = 10.0
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        r = grid.GridRun(_gi(z, hours=2, rain_mm=rain, dt_max_s=5.0, override_numerics=True))
        r.advance()
        launch.write_outputs(r, tmp_path, "audit")
    summ = json.loads((tmp_path / "summary.json").read_text())
    assert summ["numerics_override"] is True
    assert summ["numerics"]["dt_max_s"] == 5.0
    assert summ["mass_balance"]["numerics_override"] is True
    o = grid.run_grid(_gi(z, hours=2, rain_mm=rain))
    assert o.mass_balance["numerics_override"] is False


def _pond30(nx=40, ny=3, h0=0.5, hours=3, **kw):
    z = np.zeros((ny, nx))
    em = np.zeros((ny, nx), bool)
    em[:, -1] = True
    g = _gi(z, hours=hours, edge_outflow_mask=em, snapshot_interval_s=60.0, **kw)
    r = grid.GridRun(g)
    r.s.h[:] = h0
    r.advance()
    return r.finish(), em


def test_critical_depth_outlet_30m_bounded_booked_no_reflection():
    o, em = _pond30()
    snaps = o.snapshots
    h, t, st = snaps["h"].astype(float), snaps["t_s"], snaps["storage"]
    dx = 30.0
    cols = snaps["ledger_columns"]
    eo = snaps["ledger"][:, cols.index("edge_outflow")]
    # (1) independent bound: volume out in each interval <= sqrt(g h^3)*width*dt, with h
    # bounded by the domain max depth at the interval start (flat bed draining: depths only
    # decrease, so no cell, incl. the edge cell before removal, exceeds it)
    width = em.sum() * dx
    # snapshot 0 is written at GridRun init, before the pond is set: start at k=2
    for k in range(2, len(t)):
        hmax = float(h[k - 1].max())
        assert eo[k] - eo[k - 1] <= np.sqrt(G) * hmax**1.5 * width * (t[k] - t[k - 1]) * 1.0001
    # (2) mass booked
    s0 = 0.5 * em.size * dx * dx
    assert abs((s0 - st[-1]) - eo[-1]) / s0 < 1e-9
    # (run_grid's own MB is not used: its start storage is taken before the pond is set)
    # (3) no reflection: storage monotone, and depth never increases anywhere after t0
    assert (np.diff(st[1:]) <= 1e-9 * s0).all()
    assert (np.diff(h[1:], axis=0) <= 1e-9).all()
    # (4) no ponding at the outlet: profile decreases toward the edge
    prof = h[-1][1]
    assert (np.diff(prof) <= 1e-12).all()


def test_critical_depth_outlet_slower_than_free_outfall_sink():
    """Critical-depth edge must drain no faster than the h=0 free-outfall sink (old outlet)."""
    o, em = _pond30(hours=1)
    crit_left = float(o.snapshots["storage"][-1])
    z = np.zeros((3, 40))
    dom = Domain(z=z, dx=30.0, manning_n=0.03, outlet=em)
    s = State.dry(z.shape)
    s.h[:] = 0.5
    sn, _ = run(dom, s, piecewise_rain([0, 1], [0.0]), 3600.0, 600.0)
    assert crit_left >= sn[-1].storage


def test_tank_drain_down_booked_and_labelled():
    nx, ny, dx = 30, 6, 5.0
    z = np.tile((nx * dx - np.arange(nx) * dx) * 0.01, (ny, 1))
    out = np.zeros((ny, nx), bool)
    out[:, -1] = True
    dom = Domain(z=z, dx=dx, manning_n=0.03, outlet=out)
    m = np.zeros((ny, nx), bool)
    m[:, 20:24] = True
    lv = Lever("tank", m, {"volume_m3": 2.0, "inflow_mm_h": 200, "drain_down_m3_s": 1e-3})
    assert lv.label == "assumption" and "no source" in lv.source
    rain = piecewise_rain([0, 3600, 5400, 9000], [60e-3 / 3600, 0.0, 60e-3 / 3600])
    _, _, led, ml, st = run_mitigated(dom, State.dry(z.shape), rain, 12000.0, 600.0, [lv])
    rel, lvl = ml.extra["tank_release"], ml.extra["tank_level"][0]
    assert rel > 0
    assert abs(lvl - (ml.tank_storage - rel)) < 1e-9 and 0 <= lvl <= 2.0 + 1e-12
    assert ml.tank_storage > 2.0  # drain-down restored capacity
    assert mass_balance_error_mitigated(0.0, st[-1], led, ml) < 1e-9


def test_zero_ksat_pervious_cells_stay_finite():
    """D6 closed by c59af83: Ks=0 cells give capacity 0, not 0*inf=NaN."""
    z = np.tile(np.linspace(1, 0, 6), (3, 1))
    rain = np.zeros((2, 1))
    rain[0, 0] = 10.0
    o = grid.run_grid(_gi(z, hours=2, rain_mm=rain, pervious_mask=None))
    assert np.isfinite(o.max_depth_m).all()
    assert o.mass_balance["mass_balance_error_rel"] < 1e-9
