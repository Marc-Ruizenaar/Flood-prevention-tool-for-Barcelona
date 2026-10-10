"""Synthetic benchmarks (owned by Agent 3). All rainfall/terrain here is SYNTHETIC test input,
not Barcelona data. Mass-balance tolerance MB_TOL = 1e-9 relative: the scheme is conservative by
construction, so any error above float64 round-off accumulation indicates a bug."""
import numpy as np
import pytest

from bcnflood.solver.daily import daily_summaries
from bcnflood.solver.local_inertial import Domain, GreenAmpt, State, mass_balance_error, run

MB_TOL = 1e-9
MM_H = 1e-3 / 3600.0  # 1 mm/h in m/s


def const(r):
    return lambda t: r


def storm(r, dur):
    return lambda t: r if t < dur else 0.0


def slope_domain(nx=40, ny=5, dx=10.0, s=0.01, n=0.03, **kw):
    x = np.arange(nx) * dx
    z = np.tile((nx * dx - x) * s, (ny, 1))
    outlet = np.zeros((ny, nx), bool)
    outlet[:, -1] = True
    return Domain(z=z, dx=dx, manning_n=n, outlet=outlet, **kw)


def depression_domain(**kw):
    nx, ny, dx = 41, 3, 5.0
    x = np.arange(nx)
    z = np.abs(x - 15).astype(float) * 0.05  # bowl centred at 15
    z[25:] = 0.5 - (x[25:] - 25) * 0.02     # sill at x=25 (z=0.5), then down to outlet
    z = np.tile(z, (ny, 1))
    outlet = np.zeros_like(z, bool)
    outlet[:, -1] = True
    return Domain(z=z, dx=dx, manning_n=0.03, outlet=outlet, **kw)


def test_flat_uniform_rain_analytic():
    dom = Domain(z=np.zeros((10, 10)), dx=5.0, manning_n=0.03)
    s = State.dry((10, 10))
    r = 20 * MM_H
    snaps, led = run(dom, s, const(r), 3600.0, 600.0)
    np.testing.assert_allclose(s.h, r * 3600.0, rtol=1e-12)  # 20 mm
    assert np.abs(s.qx).max() < 1e-12 and np.abs(s.qy).max() < 1e-12
    assert mass_balance_error(0, snaps[-1].storage, led) < MB_TOL


def test_sloping_plane_flows_downslope_and_conserves_mass():
    dom = slope_domain()
    s = State.dry(dom.z.shape)
    snaps, led = run(dom, s, storm(50 * MM_H, 1800), 7200.0, 600.0)
    assert led.outflow > 0
    assert (s.qx >= -1e-12).all()  # all flow downslope
    # audit fix: quantitative check vs kinematic-wave equilibrium h=(n r x / sqrt(S))^0.6
    # (t_c ~1550 s < 1800 s); M1 version passed on a wrong (unstable) solution.
    hk = (0.03 * 50 * MM_H * 20.5 * 10.0 / np.sqrt(0.01)) ** 0.6
    assert abs(snaps[3].h[2, 20] / hk - 1) < 0.10
    # steady-ish at t=1800 depth grows downslope
    h_mid = snaps[3].h[2]
    assert h_mid[30] > h_mid[5]
    assert mass_balance_error(0, snaps[-1].storage, led) < MB_TOL


def test_depression_with_outlet_ponds_to_sill_level():
    dom = depression_domain()
    s = State.dry(dom.z.shape)
    # 300 mm in 1 h: bowl storage below sill (~25 m^3/m) < rain volume (~61 m^3/m), so it spills
    snaps, led = run(dom, s, storm(300 * MM_H, 3600), 12 * 3600.0, 900.0)
    eta = dom.z + s.h
    assert led.outflow > 0  # spilled over sill to outlet
    # ponded water surface near sill elevation (0.5 m), bowl centre wettest
    assert 0.5 <= eta[1, 15] < 0.502  # audit: one-sided, settles to the sill from above
    assert s.h[1, 15] == pytest.approx(s.h.max())
    assert mass_balance_error(0, snaps[-1].storage, led) < MB_TOL


def _run_dep(**kw):
    dom = depression_domain(**kw)
    s = State.dry(dom.z.shape)
    snaps, led = run(dom, s, storm(100 * MM_H, 3600), 6 * 3600.0, 900.0)
    assert mass_balance_error(0, snaps[-1].storage, led) < MB_TOL
    return s, led


def test_infiltration_reduces_runoff():
    s0, l0 = _run_dep()
    ga = GreenAmpt(k_sat=10 * MM_H, psi=0.11, delta_theta=0.3)  # sandy-loam-like, synthetic
    s1, l1 = _run_dep(infiltration=ga)
    assert l1.infiltration > 0
    assert l1.outflow < l0.outflow
    assert s1.h.sum() < s0.h.sum()


def test_impervious_increases_runoff():
    ga = GreenAmpt(k_sat=10 * MM_H, psi=0.11, delta_theta=0.3)
    shape = depression_domain().z.shape
    _, lp = _run_dep(infiltration=ga, pervious=np.ones(shape, bool))
    _, li = _run_dep(infiltration=ga, pervious=np.zeros(shape, bool))
    assert li.outflow > lp.outflow and li.infiltration == 0


def test_drainage_reduces_accumulation():
    s0, l0 = _run_dep()
    s1, l1 = _run_dep(drainage_capacity=20 * MM_H)
    assert l1.drainage > 0
    assert s1.h.max() < s0.h.max()


def test_obstacle_blocks_flow():
    def dom_with(gap):
        nx, ny = 30, 9
        z = np.zeros((ny, nx))
        z[:, 15] = 10.0  # wall
        if gap:
            z[4, 15] = 0.0
        return Domain(z=z, dx=2.0, manning_n=0.03)

    def go(gap):
        dom = dom_with(gap)
        s = State.dry(dom.z.shape)
        s.h[:, :10] = 0.5  # synthetic initial pond upstream
        run(dom, s, const(0.0), 600.0, 60.0)
        return s

    closed, opened = go(False), go(True)
    assert closed.h[:, 16:].max() == 0.0
    assert opened.h[:, 16:].sum() > 0.0


def test_no_negative_depth_extreme():
    dom = slope_domain(s=0.2, n=0.01)
    s = State.dry(dom.z.shape)
    snaps, led = run(dom, s, storm(200 * MM_H, 600), 3600.0, 60.0)
    assert min(sn.h.min() for sn in snaps) >= 0.0
    # positivity is forced by the clip; the real check is that the clip moved ~no water
    assert led.clip <= 1e-12 * led.rain
    assert mass_balance_error(0, snaps[-1].storage, led) < MB_TOL


def test_reproducible():
    a, b = State.dry((5, 40)), State.dry((5, 40))
    run(slope_domain(), a, storm(30 * MM_H, 900), 3600.0, 300.0)
    run(slope_domain(), b, storm(30 * MM_H, 900), 3600.0, 300.0)
    assert np.array_equal(a.h, b.h) and np.array_equal(a.qx, b.qx)


def test_rainfall_sensitivity():
    # audit fix: M1 depths (10/30/60 mm) never filled the 25 m^3/m bowl, so outflow was only
    # rain downstream of the sill. Use depths that spill and test the bowl's share of outflow.
    outs = []
    for r in (100, 300, 400):
        s = State.dry((3, 41))
        _, led = run(depression_domain(), s, storm(r * MM_H, 3600), 12 * 3600.0, 900.0)
        downstream = r * 1e-3 * 16 * 3 * 25  # rain on x>=25 (incl. sill) goes to the outlet
        outs.append(led.outflow - downstream)
    assert outs[0] <= 0.0  # bowl (25 m^3/m) spills only above 200 mm (125 m catchment)
    assert 0 < outs[1] < outs[2]


def test_two_day_midnight_continuity_and_daily_summaries():
    day = 86400.0
    ga = GreenAmpt(k_sat=5 * MM_H, psi=0.11, delta_theta=0.3)

    def rain(t):  # synthetic storm straddling midnight 22:00-02:00
        return 30 * MM_H if 22 * 3600 <= t < 26 * 3600 else 0.0

    dom = depression_domain(infiltration=ga, drainage_capacity=2 * MM_H)
    s = State.dry(dom.z.shape)
    snaps, led = run(dom, s, rain, 2 * day, 3600.0)

    # restart at midnight from carried state must equal continuous run
    s2 = State.dry(dom.z.shape)
    run(dom, s2, rain, day, 3600.0)
    h_mid = s2.h.copy()
    np.testing.assert_allclose(h_mid, snaps[24].h, rtol=0, atol=0)
    assert h_mid.sum() > 0  # water present at midnight -> carry-over meaningful
    run(dom, s2, rain, 2 * day, 3600.0)
    np.testing.assert_allclose(s2.h, s.h, rtol=1e-12, atol=1e-15)
    np.testing.assert_allclose(s2.f_cum, s.f_cum, rtol=1e-12, atol=1e-15)

    days = daily_summaries(snaps, [0.0, day, 2 * day])
    assert all(d["status"] == "SIMULATED" for d in days)
    assert sum(d["rain_m3"] for d in days) == pytest.approx(led.rain, rel=1e-12)
    assert sum(d["outflow_m3"] for d in days) == pytest.approx(led.outflow, rel=1e-12)
    assert days[0]["storage_end_m3"] == days[1]["storage_start_m3"]
    assert days[0]["rain_m3"] == pytest.approx(2 * 3600 * 30 * MM_H * dom.z.size * 25, rel=1e-9)
    for d in days:
        assert d["mass_balance_error_rel"] < MB_TOL
    assert days[1]["max_depth_m"] == pytest.approx(max(sn.max_depth for sn in snaps[24:]))
    assert mass_balance_error(0, snaps[-1].storage, led) < MB_TOL
