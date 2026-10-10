"""Agent 2 M2 regression tests: audit fixes D1-D5, local-day daily output, mitigation mass."""
from datetime import UTC, date, datetime

import numpy as np

from bcnflood.solver import convergence as conv
from bcnflood.solver.daily import local_daily_summaries, local_day_edges
from bcnflood.solver.local_inertial import (
    Domain,
    GreenAmpt,
    State,
    mass_balance_error,
    piecewise_rain,
    run,
)
from bcnflood.solver.mitigation import (
    Lever,
    delta_max_depth,
    mass_balance_error_mitigated,
    run_mitigated,
)
from bcnflood.solver.reference_cases import KinematicPlane

MM_H = 1e-3 / 3600


def test_d1_default_kinematic_plane_converges():
    kp = KinematicPlane()
    st = conv.grid_study(kp, 50.0, levels=4)
    e = conv.errors_vs_reference(st, kp.exact_depth, 1800.0, "L1", kp.compare_mask)
    assert all(a > b for a, b in zip(e[:-1], e[1:], strict=True))
    assert min(conv.orders(e)) > 0.7
    pk = [lv.peak_depth for lv in st.levels]
    assert conv.relative_change(pk[-2], pk[-1]) < 0.05
    assert max(lv.mass_balance_rel for lv in st.levels) < 1e-9


def test_d2_rain_breakpoint_exact_volume():
    dom = Domain(z=np.zeros((5, 5)), dx=5.0, manning_n=0.03)
    s = State.dry((5, 5))
    _, led = run(dom, s, piecewise_rain([0, 1805], [50 * MM_H]), 3600.0, 600.0)
    exact = 50 * MM_H * 1805 * 25 * 25
    assert abs(led.rain - exact) / exact < 1e-12


def test_d4_no_seeded_infiltration_and_d5_face_n():
    assert np.all(State.dry((3, 3)).f_cum == 0)
    ga = GreenAmpt(1e-6, 0.11, 0.3)
    assert np.isinf(ga.capacity(np.zeros(1)))[0]
    n = np.array([[0.01, 0.05]])
    dom = Domain(z=np.zeros((1, 2)), dx=1.0, manning_n=n)
    s = State.dry((1, 2))
    s.h[:] = [0.2, 0.1]
    run(dom, s, lambda t: 0.0, 1.0, 1.0)  # smoke: runs with n^2-mean faces
    assert np.isfinite(s.h).all()


def test_local_day_edges_dst():
    t0 = datetime(2026, 10, 23, 22, tzinfo=UTC)  # local midnight 24 Oct
    e = local_day_edges(date(2026, 10, 24), date(2026, 10, 26), t0)
    assert np.diff(e).tolist() == [86400.0, 90000.0, 86400.0]


def test_local_daily_summaries_labels():
    t0 = datetime(2026, 10, 1, 22, tzinfo=UTC)
    dom = Domain(z=np.zeros((3, 3)), dx=5.0, manning_n=0.03, drainage_capacity=1 * MM_H)
    s = State.dry((3, 3))
    snaps, _ = run(dom, s, piecewise_rain([3600, 7200], [10 * MM_H]), 2 * 86400.0, 3600.0)
    d = local_daily_summaries(snaps, date(2026, 10, 2), date(2026, 10, 3), t0)
    assert [x["local_date"] for x in d] == ["2026-10-02", "2026-10-03"]
    assert all(x["mass_balance_error_rel"] < 1e-9 for x in d)


def _slope():
    nx, ny = 30, 4
    z = np.tile((nx - np.arange(nx)) * 0.1, (ny, 1))
    out = np.zeros((ny, nx), bool)
    out[:, -1] = True
    return Domain(z=z, dx=5.0, manning_n=0.03, outlet=out,
                  infiltration=GreenAmpt(2 * MM_H, 0.11, 0.3),
                  pervious=np.zeros((ny, nx), bool))


def test_mitigation_levers_conserve_mass_and_reduce_depth():
    dom = _slope()
    rain = piecewise_rain([0, 1800], [60 * MM_H])
    cells = np.zeros(dom.z.shape, bool)
    cells[:, 20:25] = True
    roof = np.zeros(dom.z.shape, bool)
    roof[:, :5] = True
    t0, base, *_ = run_mitigated(dom, State.dry(dom.z.shape), rain, 7200.0, 3600.0, [])
    levers = [Lever("drain", cells, {"extra_mm_h": 10.0}),
              Lever("suds", cells, {"k_sat_m_s": 20 * MM_H}),
              Lever("tank", cells, {"volume_m3": 5.0, "inflow_mm_h": 100.0}),
              Lever("green_roof", roof, {"storage_m": 0.01})]
    s = State.dry(dom.z.shape)
    _, scen, led, mled, sto = run_mitigated(dom, s, rain, 7200.0, 3600.0, levers)
    assert mled.tank_storage > 0 and mled.tank_storage <= 5.0 + 1e-12
    assert mled.roof_storage > 0
    assert mass_balance_error_mitigated(sto[0], sto[-1], led, mled) < 1e-9
    d = delta_max_depth(base, scen)
    assert len(d) == 2 and d[0].sum() < 0


def test_tank_full_stops_capturing():
    dom = _slope()
    cells = np.zeros(dom.z.shape, bool)
    cells[:, -2] = True
    s = State.dry(dom.z.shape)
    _, _, led, mled, sto = run_mitigated(dom, s, piecewise_rain([0, 3600], [80 * MM_H]),
                                         3600.0, 600.0,
                                         [Lever("tank", cells, {"volume_m3": 0.5})])
    assert abs(mled.tank_storage - 0.5) < 1e-12
    assert mass_balance_error_mitigated(sto[0], sto[-1], led, mled) < 1e-9
    assert mass_balance_error(sto[0], sto[-1], led) > 1e-9  # tank volume really left surface


def test_gci_and_kink_band_helpers():
    g = conv.gci(1.0, 0.5, 0.25)  # exact first order, error halves
    assert abs(g["p"] - 1) < 1e-12 and abs(g["f_extrapolated"]) < 1e-12
    kp = KinematicPlane()
    st = conv.grid_study(kp, 50.0, levels=3)
    m = kp.compare_mask_kink(100.0)
    e = conv.errors_vs_reference(st, kp.exact_depth, 1800.0, "L1", lambda lv: m(lv, 1800.0))
    assert min(conv.orders(e)) >= 0.5
