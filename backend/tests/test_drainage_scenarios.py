import numpy as np

from bcnflood.solver.drainage import MM_H, load_scenarios
from bcnflood.solver.local_inertial import Domain, State, run


def test_scenarios_labelled_assumption_and_ordered():
    sc = load_scenarios()
    assert {"low", "mid", "high"} <= set(sc)
    assert all(s.kind == "assumption" for s in sc.values())
    assert sc["low"].capacity_mm_h < sc["mid"].capacity_mm_h < sc["high"].capacity_mm_h
    assert sc["mid"].capacity_m_s == 20 * MM_H


def test_higher_capacity_drains_more_synthetic():
    out = []
    for name in ("low", "mid", "high"):
        dom = Domain(z=np.zeros((4, 4)), dx=5.0, manning_n=0.03,
                     drainage_capacity=load_scenarios()[name].capacity_m_s)
        s = State.dry((4, 4))
        _, led = run(dom, s, lambda t: 50 * MM_H, 3600.0, 600.0)
        out.append((led.drainage, s.h.max()))
    assert out[0][0] < out[1][0] < out[2][0] and out[0][1] > out[2][1]
