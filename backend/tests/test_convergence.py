"""M2-A3-02 grid / time-step sensitivity (Agent 3). SYNTHETIC cases from Agent 2's harness
(solver/convergence.py, solver/reference_cases.py). Tolerances fixed BEFORE running (plan M2-A3-02):
  T1 relative change in peak depth and peak outflow between the two finest levels < 5 %
  T2 observed order >= ~1 (we accept >= 0.8) against the analytic case
  T3 mass balance < 1e-9 at every level
xfail(strict) marks document measured failures (docs/audit/gates_report.md, G6)."""
import numpy as np
import pytest

conv = pytest.importorskip("bcnflood.solver.convergence")
refc = pytest.importorskip("bcnflood.solver.reference_cases")

MB_TOL = 1e-9


@pytest.fixture(scope="module")
def kp():
    return refc.KinematicPlane()


@pytest.fixture(scope="module")
def kp_grid_035(kp):
    return conv.grid_study(kp, 50.0, levels=4, alpha=0.35)


def _kp_errs(kp, st):
    out = []
    for lv in st.levels:
        m = kp.compare_mask(lv)
        ex = kp.exact_depth(lv, 3600.0)
        out.append(np.abs(lv.final_state.h - ex)[m].mean() / ex[m].mean())
    return out


def test_kp_mass_balance_all_levels(kp_grid_035):
    assert max(lv.mass_balance_rel for lv in kp_grid_035.levels) < MB_TOL


def test_kp_grid_peak_change_finest_two(kp_grid_035):
    a, b = kp_grid_035.levels[-2:]
    assert conv.relative_change(a.peak_depth, b.peak_depth) < 0.05        # observed 3.4 %
    assert conv.relative_change(a.peak_outflow_rate, b.peak_outflow_rate) < 0.05  # 0.1 %


def test_kp_observed_order(kp, kp_grid_035):
    # after 565c242 (dt_max=2 s): 0.040, 0.0219, 0.0122, 0.0070 -> orders 0.87, 0.84, 0.82
    assert min(conv.orders(_kp_errs(kp, kp_grid_035))) >= 0.8


def test_kp_order_not_kink_limited(kp_grid_035):
    """A2 claims the ~0.8 order is limited by the analytic kink. Measured away from the kink
    (x < x_kink - 150 m) the order is the same (0.84, 0.85, 0.80), and grid self-convergence
    gives 0.88, 0.90. The order is intrinsic to the scheme/boundaries, not the kink."""
    errs = []
    for lv in kp_grid_035.levels:
        kp = refc.KinematicPlane()
        ny, nx = lv.final_state.h.shape
        x = (np.arange(nx) + 0.5) * lv.dx
        m = np.tile(x < kp.kink_x(3600.0) - 150.0, (ny, 1))
        errs.append(np.abs(lv.final_state.h - kp.exact_depth(lv, 3600.0))[m].mean())
    o = conv.orders(errs)
    assert min(o) >= 0.75 and max(o) < 1.0


def test_kp_alpha_refinement(kp):
    st = conv.alpha_study(kp, 12.5, (0.35, 0.175))
    a, b = st.levels
    assert conv.relative_change(a.peak_depth, b.peak_depth) < 0.05  # observed 1.7 %
    assert max(lv.mass_balance_rel for lv in st.levels) < MB_TOL


def test_kp_fixed_dt_refinement(kp):
    st = conv.fixed_dt_study(kp, 12.5, (4.0, 2.0, 1.0))
    p = [lv.peak_depth for lv in st.levels]
    assert conv.relative_change(p[1], p[2]) < 1e-3


def test_kp_default_alpha_grid_stable(kp):
    st = conv.grid_study(kp, 25.0, levels=2)  # solver defaults after D1 fix
    a, b = st.levels
    assert conv.relative_change(a.peak_depth, b.peak_depth) < 0.05


def test_thacker_froude_limit():
    """Thacker is an exact solution of full SWE, not local-inertial (dropped d(q^2/h)/dx =
    u^2 dh/dx != 0), so it is a Froude-limit test, not an order test. dx/dt refinement does
    not reduce error (alpha 0.35->0.0875: 0.01143->0.01134 m). Acceptance (stated here):
      (a) L1(h) decreases monotonically as bulk Fr is halved 0.23 -> 0.028,
      (b) the last two halvings reduce L1 by >= 2.8x each (~Fr^1.5 or better),
      (c) L1 < 1e-3 m (0.2 % of h0) at bulk Fr = 0.028, (d) mass balance < 1e-9.
    Observed at dx=0.02 m: 0.0115, 0.00508, 0.00150, 0.000472 m."""
    errs = []
    for b in (0.5, 0.25, 0.125, 0.0625):
        tb = refc.ThackerBowl(b=b)
        lv = conv.run_level(tb, 0.02, dt_max=0.01)
        t = lv.snaps[-1].t
        errs.append(np.abs(lv.final_state.h - tb.exact_depth(lv, t)).mean())
        assert lv.mass_balance_rel < MB_TOL
    assert all(a > b for a, b in zip(errs[:-1], errs[1:], strict=True))
    assert errs[1] / errs[2] >= 2.8 and errs[2] / errs[3] >= 2.8
    assert errs[-1] < 1e-3
