import numpy as np

from bcnflood.solver.campaign import execute, plan
from bcnflood.solver.local_inertial import Domain, piecewise_rain

MM_H = 1e-3 / 3600


def test_plan_2_to_7_oct_local_days():
    p = plan(Domain(z=np.zeros((2, 2)), dx=5.0, manning_n=0.03))
    assert len(p.day_edges_s) == 7 and p.day_edges_s[0] == 0.0
    assert p.t0_utc.isoformat() == "2026-10-01T22:00:00+00:00"
    assert set(p.scenarios) == {"low", "mid", "high"}


def test_execute_synthetic_spinup_excluded_and_mass():
    dom = Domain(z=np.zeros((2, 2)), dx=5.0, manning_n=0.03)
    p = plan(dom, dt_max=600.0)
    rain = piecewise_rain([20 * 3600, 30 * 3600, 100 * 3600, 102 * 3600],
                          [5 * MM_H, 0.0, 40 * MM_H])  # SYNTHETIC
    res = execute(dom, rain, p, dt_max=600.0, override=True)  # fast synthetic
    for r in res.values():
        assert r["spinup"]["status"] == "SPINUP" and r["spinup"]["local_date"] == "2026-10-02"
        assert [d["local_date"] for d in r["results"]][0] == "2026-10-03"
        assert len(r["results"]) == 5
        assert all(d["mass_balance_error_rel"] < 1e-9 for d in r["results"])
    drains = [res[k]["ledger"].drainage for k in ("low", "mid", "high")]
    assert drains[0] < drains[1] <= drains[2]
