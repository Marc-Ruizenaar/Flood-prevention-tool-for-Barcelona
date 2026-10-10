"""Sea outlet, roof routing, green roofs on buildings, max speed, checkpoint/resume, launcher."""
import pickle
from datetime import UTC, datetime

import numpy as np

from bcnflood.solver import launch
from bcnflood.solver.grid import GridRun, run_grid
from bcnflood.solver.mitigation import Lever
from bcnflood.solver.topology import RoofRouter, label_components, sea_outlet_mask
from tests.test_grid import make


def test_sea_outlet_connected_only():
    z = np.ones((6, 8))
    z[:, -2:] = -1.0  # sea strip on east edge
    z[2, 2] = -0.5  # inland depression: not connected
    m = sea_outlet_mask(z)
    assert m[:, -2:].all() and not m[2, 2] and m.sum() == 12
    act = np.ones((6, 8), bool)
    act[:, -1] = False  # sea as NoData: seeds from NoData side
    m2 = sea_outlet_mask(np.where(act, z, np.nan), act)
    assert m2[:, -2].all() and not m2[2, 2]


def test_label_and_router_conserve():
    b = np.zeros((6, 6), bool)
    b[1:3, 1:3] = True
    b[4, 4] = True
    assert label_components(b).max() == 1
    r = RoofRouter(b, ~b)
    f = np.where(b, 1.0, 0.0)
    add, unr = r.route(f)
    assert unr == 0 and abs(add.sum() - 5.0) < 1e-12 and (add[b] == 0).all()
    full = np.ones((3, 3), bool)
    _, unr2 = RoofRouter(full, ~full).route(np.ones((3, 3)))
    assert unr2 == 9.0


def test_roof_routing_and_green_roof_mass():
    g = make()
    bld = g.building_mask
    o = run_grid(g)
    mb = o.mass_balance
    assert mb["roof_unrouted_m3"] == 0 and mb["mass_balance_error_rel"] < 1e-9
    gr = run_grid(make(mitigation=[Lever("green_roof", bld, {"storage_m": 0.02})]))
    m2 = gr.mass_balance
    assert 0 < m2["roof_storage_m3"] <= 0.02 * 100 * bld.sum() + 1e-9
    assert m2["mass_balance_error_rel"] < 1e-9
    assert abs(m2["rain_applied_m3"] - (m2["rain_m3"] - m2["roof_storage_m3"])) < 1e-9
    nr = run_grid(make(route_roof_rain=False))
    assert nr.mass_balance["roof_unrouted_m3"] > 0
    assert nr.mass_balance["mass_balance_error_rel"] < 1e-9


def test_default_sea_outlet_used():
    z = np.tile(np.linspace(5, -1, 12), (8, 1))
    o = run_grid(make(dem_m=z, outlet_mask=None, hours=6,
                      start=datetime(2026, 10, 3, 22, tzinfo=UTC)))
    assert o.outlet_mask[:, -1].all() and o.mass_balance["outflow_m3"] > 0


def test_checkpoint_resume_bit_identical_and_snapshots():
    g = make(hours=6, snapshot_interval_s=3600.0)
    a = GridRun(g)
    a.advance()
    oa = a.finish()
    b = GridRun(g)
    b.advance(5000.0)
    b = pickle.loads(pickle.dumps(b))
    b.advance()
    ob = b.finish()
    assert np.array_equal(oa.max_depth_m, ob.max_depth_m)
    assert np.array_equal(oa.max_speed_m_s, ob.max_speed_m_s)
    assert oa.snapshots["h"].shape[0] == 7 and np.array_equal(oa.snapshots["h"],
                                                                ob.snapshots["h"])


def test_launcher_smoke_and_gate_refusal(tmp_path):
    g = make(hours=1, start=datetime(2026, 10, 3, 0, tzinfo=UTC), snapshot_interval_s=600.0)
    p = tmp_path / "in.pkl"
    launch.save_inputs(g, p)
    assert launch.main(["--inputs", str(p), "--scenario", "low", "--out", str(tmp_path)]) == 3
    rc = launch.main(["--inputs", str(p), "--scenario", "low", "--out", str(tmp_path),
                      "--synthetic", "--checkpoint-every-s", "900", "--report-every-s", "300"])
    assert rc == 0
    d = tmp_path / "low"
    assert (d / "outputs.npz").exists() and (d / "checkpoint.pkl").exists()
    log = (d / "progress.log").read_text()
    assert "ETA=" in log and "DONE" in log
    z = np.load(d / "outputs.npz")
    assert z["snap_h"].shape[0] == 7


def test_g6_numerics_limits_everywhere(tmp_path):
    import pytest

    from bcnflood.solver.campaign import execute, plan
    from bcnflood.solver.grid import validate
    from bcnflood.solver.local_inertial import (
        Domain,
        NumericsLimitError,
        State,
        piecewise_rain,
        run,
    )
    dom = Domain(z=np.zeros((2, 2)), dx=5.0, manning_n=0.03)
    for kw in ({"alpha": 0.36}, {"dt_max": 2.01}):
        with pytest.raises(NumericsLimitError):
            run(dom, State.dry((2, 2)), lambda t: 0.0, 10.0, 10.0, **kw)
        with pytest.warns(RuntimeWarning, match="OVERRIDE"):
            run(dom, State.dry((2, 2)), lambda t: 0.0, 10.0, 10.0, override=True, **kw)
    with pytest.raises(NumericsLimitError):
        validate(make(alpha=0.7))
    with pytest.raises(NumericsLimitError):
        validate(make(dt_max_s=10.0))
    with pytest.warns(RuntimeWarning):
        validate(make(dt_max_s=10.0, override_numerics=True))
    p = plan(dom)
    rain = piecewise_rain([0, 10], [1e-6])
    with pytest.raises(NumericsLimitError):
        execute(dom, rain, p, dt_max=600.0)
    with pytest.raises(ValueError, match="piecewise_rain"):
        execute(dom, lambda t: 0.0, p)
    inp = tmp_path / "in.pkl"
    launch.save_inputs(_unsafe(), inp)
    assert launch.main(["--inputs", str(inp), "--scenario", "low", "--out", str(tmp_path),
                        "--synthetic"]) == 4


def _unsafe():
    from dataclasses import replace
    g = make(hours=1)
    return replace(g, dt_max_s=10.0)  # bypasses validate; launcher must refuse


def test_run_grid_cuts_every_rain_edge():
    g = make(hours=6, start=datetime(2026, 10, 3, 0, tzinfo=UTC))
    r = GridRun(g)
    assert set(r.edges.tolist()) <= set(r.cuts)
    o = run_grid(g)
    exp = float(np.sum(g.rain_mm.mean(axis=1))) * 1e-3 * 100.0 * g.dem_m.size
    assert abs(o.mass_balance["rain_m3"] - exp) / max(exp, 1e-12) < 1e-12 or exp == 0
