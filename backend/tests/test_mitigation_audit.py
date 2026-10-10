"""M2-A3-05 audit of solver.mitigation and solver.campaign (Agent 3). SYNTHETIC only."""
import numpy as np
import pytest

mit = pytest.importorskip("bcnflood.solver.mitigation")
from bcnflood.solver.local_inertial import (  # noqa: E402
    Domain,
    GreenAmpt,
    State,
    piecewise_rain,
    run,
)

MM_H = 1e-3 / 3600.0


def _dom():
    nx, ny, dx = 30, 6, 5.0
    z = np.tile((nx * dx - np.arange(nx) * dx) * 0.01, (ny, 1))
    out = np.zeros((ny, nx), bool)
    out[:, -1] = True
    return Domain(z=z, dx=dx, manning_n=0.03, outlet=out,
                  infiltration=GreenAmpt(5 * MM_H, 0.11, 0.3))


def _levers(shape):
    m = np.zeros(shape, bool)
    m[:, 20:24] = True
    roof = np.zeros(shape, bool)
    roof[:2, :10] = True
    return [mit.Lever("tank", m, {"volume_m3": 5.0, "inflow_mm_h": 200}),
            mit.Lever("green_roof", roof, {"storage_m": 0.02}),
            mit.Lever("drain", m, {"extra_mm_h": 10}),
            mit.Lever("suds", roof, {"k_sat_m_s": 20 * MM_H})], m, roof


def test_mass_balance_with_tank_and_roof_storage():
    dom = _dom()
    levers, m, roof = _levers(dom.z.shape)
    s = State.dry(dom.z.shape)
    _, _, led, ml, st = mit.run_mitigated(dom, s, piecewise_rain([0, 3600], [60 * MM_H]),
                                          7200.0, 600.0, levers)
    assert mit.mass_balance_error_mitigated(0.0, st[-1], led, ml) < 1e-9  # observed 2e-14
    assert ml.tank_storage == pytest.approx(5.0, rel=1e-9)  # never exceeds the tank volume
    assert 0 < ml.roof_storage <= roof.sum() * 0.02 * dom.dx**2 + 1e-12


def test_baseline_is_identical_to_plain_run():
    dom = _dom()
    rain = piecewise_rain([0, 3600], [60 * MM_H])
    a, b = State.dry(dom.z.shape), State.dry(dom.z.shape)
    _, fields, la, _, st = mit.run_mitigated(dom, a, rain, 7200.0, 600.0, [])
    snaps, lb = run(dom, b, rain, 7200.0, 600.0)
    assert np.array_equal(a.h, b.h) and la.steps == lb.steps
    # run_mitigated reports the max over each interval (all steps); run() snapshots are
    # instantaneous. Interval max >= value at the interval end and at its start.
    hm = np.array([f.max() for f in fields])
    inst = np.array([s.max_depth for s in snaps])
    assert (hm >= inst[1:] - 1e-15).all() and (hm >= inst[:-1] - 1e-15).all()
    assert st[-1] == pytest.approx(snaps[-1].storage, rel=1e-14)


def test_tank_delta_vs_baseline_sign_and_dt_insensitive():
    dom = _dom()
    levers, m, _ = _levers(dom.z.shape)
    rain = piecewise_rain([0, 3600], [60 * MM_H])
    firsts = []
    for dt_max in (2.0, 1.0):
        _, f0, *_ = mit.run_mitigated(dom, State.dry(dom.z.shape), rain, 7200.0, 600.0, [],
                                      dt_max=dt_max)
        _, f1, *_ = mit.run_mitigated(dom, State.dry(dom.z.shape), rain, 7200.0, 600.0,
                                      levers[:1], dt_max=dt_max)
        delta = mit.delta_max_depth(f0, f1)
        assert max(float(d.max()) for d in delta) <= 1e-12  # a tank never raises max depth
        firsts.append(float(delta[0][m].min()))
    assert firsts[0] < 0 and firsts[0] == pytest.approx(firsts[1], rel=0.05)


def test_levers_must_be_labelled_assumption():
    dom = _dom()
    with pytest.raises(ValueError):
        mit.apply_static(dom, [mit.Lever("drain", np.ones(dom.z.shape, bool),
                                         {"extra_mm_h": 1}, label="measured")])
    levers, *_ = _levers(dom.z.shape)
    assert all(lv.label == "assumption" and "no source" in lv.source for lv in levers)


def test_campaign_rejects_unsafe_forcing():
    """C1 closed by 4c80f23 (campaign.py:54-56)."""
    camp = pytest.importorskip("bcnflood.solver.campaign")
    dom = _dom()
    p = camp.plan(dom)
    with pytest.raises((ValueError, TypeError)):
        camp.execute(dom, lambda t: 0.0, p, alpha=0.7, dt_max=10.0)
    with pytest.raises(ValueError, match="piecewise_rain"):
        camp.execute(dom, lambda t: 0.0, p)  # safe numerics but no breakpoints
