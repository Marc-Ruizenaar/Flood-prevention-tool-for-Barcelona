"""M2-A3-01 audit tests (Agent 3, Scientific Auditor). SYNTHETIC inputs only, no Barcelona data.

These tests are independent of the M1 tests in test_solver.py: they re-derive the scheme from the
equations in docs/first_task_report.md section 3 and compare against analytic solutions
(Green-Ampt / Mein-Larson ponding
kinematic-wave planar runoff at equilibrium).
Tests marked xfail(strict=True) document confirmed solver defects (see
docs/audit/m2_synthetic_benchmark_audit.md)
they will turn into XPASS failures once fixed, so the
owner (Agent 2) must notify Agent 3 to flip them.
"""
import numpy as np
import pytest

from bcnflood.solver.local_inertial import (
    DEFAULT_ALPHA,
    DEFAULT_DT_MAX,
    Domain,
    GreenAmpt,
    Ledger,
    NumericsLimitError,
    State,
    check_numerics,
    mass_balance_error,
    piecewise_rain,
    run,
    step,
)

G = 9.81
MM_H = 1e-3 / 3600.0
MB_TOL = 1e-9


# ---------------------------------------------------------------- independent reference step
def ref_step(z, h, qx, qy, n, dx, dt, r, h_dry=1e-6):
    """Re-derived from report section 3 (Bates 2010 / de Almeida 2012), written without looking
    at array tricks in the solver. Returns (h_new, qx, qy, min_h_before_clip)."""
    ny, nx = z.shape
    eta = z + h
    qx, qy = qx.copy(), qy.copy()
    for j in range(ny):
        for i in range(nx - 1):
            hf = max(eta[j, i], eta[j, i + 1]) - max(z[j, i], z[j, i + 1])
            if hf > h_dry:
                s = (eta[j, i + 1] - eta[j, i]) / dx
                fric = 1 + G * dt * n * n * abs(qx[j, i]) / hf ** (7 / 3)
                qx[j, i] = (qx[j, i] - G * hf * dt * s) / fric
            else:
                qx[j, i] = 0.0
    for j in range(ny - 1):
        for i in range(nx):
            hf = max(eta[j, i], eta[j + 1, i]) - max(z[j, i], z[j + 1, i])
            if hf > h_dry:
                s = (eta[j + 1, i] - eta[j, i]) / dx
                fric = 1 + G * dt * n * n * abs(qy[j, i]) / hf ** (7 / 3)
                qy[j, i] = (qy[j, i] - G * hf * dt * s) / fric
            else:
                qy[j, i] = 0.0
    # limiter: outgoing volume <= stored volume
    out = np.zeros_like(h)
    for j in range(ny):
        for i in range(nx - 1):
            out[j, i] += max(qx[j, i], 0)
            out[j, i + 1] += max(-qx[j, i], 0)
    for j in range(ny - 1):
        for i in range(nx):
            out[j, i] += max(qy[j, i], 0)
            out[j + 1, i] += max(-qy[j, i], 0)
    sc = np.ones_like(h)
    m = out * dt / dx > h
    sc[m] = h[m] / (out[m] * dt / dx)
    for j in range(ny):
        for i in range(nx - 1):
            qx[j, i] *= sc[j, i] if qx[j, i] > 0 else sc[j, i + 1]
    for j in range(ny - 1):
        for i in range(nx):
            qy[j, i] *= sc[j, i] if qy[j, i] > 0 else sc[j + 1, i]
    hn = h.copy()
    for j in range(ny):
        for i in range(nx - 1):
            hn[j, i] -= dt * qx[j, i] / dx
            hn[j, i + 1] += dt * qx[j, i] / dx
    for j in range(ny - 1):
        for i in range(nx):
            hn[j, i] -= dt * qy[j, i] / dx
            hn[j + 1, i] += dt * qy[j, i] / dx
    return hn + r * dt, qx, qy, hn.min()


def _rough_case(seed=12345):
    rng = np.random.default_rng(seed)  # fixed seed -> deterministic synthetic terrain
    z = rng.uniform(0, 0.3, (6, 7))
    h = rng.uniform(0, 0.05, (6, 7)) * (rng.uniform(size=(6, 7)) > 0.3)
    return z, h


def test_step_matches_independent_rederivation():
    z, h = _rough_case()
    dom = Domain(z=z, dx=2.0, manning_n=0.03)
    s = State.dry(z.shape)
    s.h = h.copy()
    qx, qy = s.qx.copy(), s.qy.copy()
    hh = h.copy()
    led = Ledger()
    worst_neg = 0.0
    for _ in range(50):
        dt = 0.2
        hh, qx, qy, hmin = ref_step(z, hh, qx, qy, 0.03, 2.0, dt, 5 * MM_H)
        worst_neg = min(worst_neg, hmin)
        step(dom, s, dt, 5 * MM_H, led)
        hh = np.maximum(hh, 0.0)
    np.testing.assert_allclose(s.h, hh, rtol=1e-10, atol=1e-14)
    np.testing.assert_allclose(s.qx, qx, rtol=1e-10, atol=1e-14)
    # the round-off clip at local_inertial.py:129 must only ever touch ~1e-15 values
    assert worst_neg > -1e-12


# ---------------------------------------------------------------- ledger checked independently
def test_rain_ledger_equals_analytic_volume():
    ny, nx, dx, r, t_end = 7, 9, 3.0, 25 * MM_H, 5400.0
    z = np.tile(np.linspace(1, 0, nx), (ny, 1))
    out = np.zeros((ny, nx), bool)
    out[:, -1] = True
    dom = Domain(z=z, dx=dx, manning_n=0.03, outlet=out)
    s = State.dry(z.shape)
    snaps, led = run(dom, s, lambda t: r, t_end, 900.0)
    assert led.rain == pytest.approx(r * t_end * nx * ny * dx * dx, rel=1e-12)
    # storage recomputed independently from depths, not from the ledger
    assert snaps[-1].storage == pytest.approx(float(s.h.sum()) * dx * dx, rel=1e-14)
    assert mass_balance_error(0.0, snaps[-1].storage, led) < MB_TOL


def test_rain_breakpoint_not_aligned_with_output():
    """D2 fix (565c242): steps are cut at breakpoints declared by piecewise_rain."""
    dom = Domain(z=np.zeros((4, 4)), dx=5.0, manning_n=0.03)
    s = State.dry((4, 4))
    r, dur = 20 * MM_H, 1805.0
    _, led = run(dom, s, piecewise_rain([0.0, dur], [r]), 3600.0, 600.0)
    assert led.rain == pytest.approx(r * dur * 16 * 25, rel=1e-9)  # observed -2e-14


def test_rain_plain_callable_error_bounded_by_dt_max():
    """Residual of D2: a callable WITHOUT .breakpoints is still sampled at step start, so the
    rain volume error is bounded by rate*dt_max (observed +0.055 % with dt_max=2 s)."""
    dom = Domain(z=np.zeros((4, 4)), dx=5.0, manning_n=0.03)
    s = State.dry((4, 4))
    r, dur = 20 * MM_H, 1805.0
    _, led = run(dom, s, lambda t: r if t < dur else 0.0, 3600.0, 600.0)
    exact = r * dur * 16 * 25
    assert abs(led.rain - exact) <= r * DEFAULT_DT_MAX * 16 * 25 + 1e-12


# ---------------------------------------------------------------- Green-Ampt vs analytic
def _green_ampt_analytic(k, p, r, t_end):
    """Mein-Larson: ponding at tp = K P / (r (r-K)); afterwards
    K (t - tp) = F - Fp - P ln((P+F)/(P+Fp)). Solved by bisection."""
    tp = k * p / (r * (r - k))
    fp = r * tp
    if t_end <= tp:
        return r * t_end

    def g(f):
        return k * (t_end - tp) - (f - fp - p * np.log((p + f) / (p + fp)))
    a, b = fp, 10.0
    for _ in range(200):
        m = 0.5 * (a + b)
        a, b = (a, m) if g(a) * g(m) <= 0 else (m, b)
    return 0.5 * (a + b)


@pytest.mark.parametrize("k_mmh,r_mmh", [(10, 50), (5, 30)])
def test_green_ampt_matches_mein_larson(k_mmh, r_mmh):
    k, r, psi, dth = k_mmh * MM_H, r_mmh * MM_H, 0.11, 0.3
    dom = Domain(z=np.zeros((3, 3)), dx=5.0, manning_n=0.03, infiltration=GreenAmpt(k, psi, dth))
    errs = []
    for dt_max in (10.0, 1.0):
        s = State.dry((3, 3))
        # override=True justified: infiltration-only on flat terrain (no flux, no CFL
        # instability possible); dt_max=10 s is needed to show first-order dt convergence.
        run(dom, s, lambda t: r, 3600.0, 600.0, dt_max=dt_max, override=dt_max > 2.0)
        f_inf = s.f_cum[1, 1]  # D4 fix: F starts at 0
        errs.append(abs(f_inf / _green_ampt_analytic(k, psi * dth, r, 3600.0) - 1))
    assert errs[0] < 2e-3   # observed ~7.9e-4 / 7.1e-4 at dt=10 s
    assert errs[1] < errs[0] / 5  # converges with dt (explicit, ~1st order)


# ---------------------------------------------------------------- kinematic-wave plane
def _plane(dx, alpha=DEFAULT_ALPHA, dt_max=DEFAULT_DT_MAX, length=400.0, slope=0.01, n=0.03,
           r=50 * MM_H, t_end=3 * 3600.0):
    nx = int(length / dx)
    x = np.arange(nx) * dx
    z = np.tile((length - x) * slope, (3, 1))
    out = np.zeros((3, nx), bool)
    out[:, -1] = True
    dom = Domain(z=z, dx=dx, manning_n=n, outlet=out)
    s = State.dry(z.shape)
    snaps, led = run(dom, s, lambda t: r, t_end, 600.0, alpha=alpha, dt_max=dt_max)
    j = nx // 2
    hk = (n * r * (j + 0.5) * dx / np.sqrt(slope)) ** 0.6  # KW equilibrium depth
    return s.h[1, j] / hk, snaps, led, dom


@pytest.mark.parametrize("dx", [20.0, 10.0, 5.0])
def test_kinematic_plane_equilibrium_alpha035(dx):
    ratio, snaps, led, dom = _plane(dx, 0.35)
    assert abs(ratio - 1) < 0.05  # observed +3.0 %, +1.6 %, +0.9 %
    assert mass_balance_error(0.0, snaps[-1].storage, led) < MB_TOL


@pytest.mark.parametrize("dx", [10.0, 5.0])
def test_kinematic_plane_equilibrium_solver_defaults(dx):
    """D1 fix (565c242): defaults alpha=0.35, dt_max=2 s."""
    ratio, *_ = _plane(dx)
    assert abs(ratio - 1) < 0.05


def test_old_unsafe_settings_are_rejected():
    """D1 residual closed by 4c80f23: alpha>0.35 or dt_max>2 s raise unless override=True."""
    with pytest.raises(NumericsLimitError):
        _plane(10.0, alpha=0.7, dt_max=10.0)
    with pytest.raises(NumericsLimitError):
        _plane(10.0, alpha=0.35, dt_max=2.5)
    with pytest.warns(RuntimeWarning, match="OVERRIDE"):
        check_numerics(0.7, 10.0, override=True)


def test_nan_numerics_rejected():
    """G6-a closed by 3185aeb: NaN rejected even with override; inf/<=0 rejected."""
    for al, dt in ((float("nan"), 2.0), (0.35, float("nan"))):
        with pytest.raises(NumericsLimitError):
            check_numerics(al, dt)
        with pytest.raises(NumericsLimitError):
            check_numerics(al, dt, override=True)
    for al, dt in ((float("inf"), 2.0), (0.0, 2.0), (0.35, -1.0)):
        with pytest.raises(NumericsLimitError):
            check_numerics(al, dt)


# ---------------------------------------------------------------- tightened M1 checks
def test_depression_settles_to_sill_from_above():
    nx, ny, dx = 41, 3, 5.0
    x = np.arange(nx)
    z = np.abs(x - 15).astype(float) * 0.05
    z[25:] = 0.5 - (x[25:] - 25) * 0.02
    z = np.tile(z, (ny, 1))
    out = np.zeros_like(z, bool)
    out[:, -1] = True
    dom = Domain(z=z, dx=dx, manning_n=0.03, outlet=out)
    s = State.dry(z.shape)
    _, led = run(dom, s, lambda t: 300 * MM_H if t < 3600 else 0.0, 12 * 3600.0, 900.0)
    eta = (z + s.h)[1, 15]
    # physically eta -> sill (0.5 m) from ABOVE; a leak below the sill is a bug.
    assert 0.5 <= eta < 0.5 + 2e-3  # observed 0.50065
    # bowl storage below sill per row is 25 m^3 (analytic), so ponded volume >= that
    bowl = slice(6, 25)
    assert (s.h[1, bowl].sum() * dx * dx) >= 25.0 * dx - 1e-9


def test_midnight_restart_carries_infiltration_state():
    ga = GreenAmpt(k_sat=5 * MM_H, psi=0.11, delta_theta=0.3)
    z = np.tile(np.abs(np.arange(21) - 10) * 0.05, (3, 1)).astype(float)
    dom = Domain(z=z, dx=5.0, manning_n=0.03, infiltration=ga)
    rain = lambda t: 30 * MM_H if 79200 <= t < 93600 else 0.0  # noqa: E731
    a = State.dry(z.shape)
    run(dom, a, rain, 172800.0, 3600.0)
    b = State.dry(z.shape)
    run(dom, b, rain, 86400.0, 3600.0)
    # restart from a deep copy (as a run store would) at a NON-output-aligned interval
    b = b.copy()
    run(dom, b, rain, 172800.0, 1800.0)
    # dt sequence differs after a non-aligned restart -> O(1e-8) differences are expected
    np.testing.assert_allclose(b.f_cum, a.f_cum, rtol=1e-6)
    np.testing.assert_allclose(b.h, a.h, rtol=1e-6, atol=1e-9)
