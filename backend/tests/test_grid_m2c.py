"""M2-A2-06 diagnostics, per-cell budget closure, edge critical-depth outflow, tank drain-down,
crop to active bounds. SYNTHETIC grids only."""
from datetime import UTC, datetime

import numpy as np

from bcnflood.solver.grid import GridRun, run_grid
from bcnflood.solver.hotspots import d8_accumulation, depression_depth, slope
from bcnflood.solver.mitigation import Lever
from tests.test_grid import make

T0 = datetime(2026, 10, 3, 0, tzinfo=UTC)


def test_per_cell_budget_closes_and_diagnostics():
    o = run_grid(make(hours=4, start=T0))
    d = o.diagnostics
    assert d["cell_budget"]["residual_rel"].max() < 1e-9
    b = d["cell_budget"]
    tot = sum(b[k].sum() for k in ("rain_in_m", "roof_in_m"))
    assert abs(tot * 100 - o.mass_balance["rain_m3"]) / o.mass_balance["rain_m3"] < 1e-9
    assert abs(b["lateral_in_m"].sum() - b["lateral_out_m"].sum()) < 1e-9 * tot
    dom = d["dominant_inflow_dir"]
    assert (dom[:, 1:-1][o.max_depth_m[:, 1:-1] > 0] == 3).mean() > 0.5  # flow from W (upslope)
    ca = d["contributing_area_flux_m2"]
    assert ca[:, -2].mean() > ca[:, 1].mean()
    assert np.isfinite(o.peak_time_utc_s[o.max_depth_m > 0]).all()


def test_terrain_helpers():
    z = np.tile(np.arange(5, 0, -1.0), (3, 1))
    act = np.ones_like(z, bool)
    acc = d8_accumulation(z, act, 1.0)
    assert acc[:, -1].sum() == z.size
    zz = np.ones((5, 5))
    zz[2, 2] = 0.2
    assert abs(depression_depth(zz, np.ones_like(zz, bool))[2, 2] - 0.8) < 1e-12
    assert abs(slope(z, act, 1.0)[1, 2] - 1.0) < 1e-12


def test_edge_outflow_booked_and_conserved():
    z = np.tile(np.linspace(5, 0, 12), (8, 1))
    em = np.zeros((8, 12), bool)
    em[:, -1] = True
    g = make(hours=4, start=T0, dem_m=z, outlet_mask=np.zeros((8, 12), bool),
             sea_outlet=False, edge_outflow_mask=em)
    o = run_grid(g)
    mb = o.mass_balance
    assert mb["edge_outflow_m3"] > 0 and mb["outflow_m3"] == 0
    assert mb["mass_balance_error_rel"] < 1e-9
    assert o.diagnostics["cell_budget"]["residual_rel"].max() < 1e-9


def test_tank_drain_down_restores_capacity():
    cells = np.zeros((8, 12), bool)
    cells[:, 9] = True
    res = {}
    for dd in (0.0, 0.01):
        o = run_grid(make(hours=50, mitigation=[Lever("tank", cells, {
            "volume_m3": 5.0, "drain_down_m3_s": dd})]))
        mb = o.mass_balance
        assert mb["mass_balance_error_rel"] < 1e-9
        assert o.diagnostics["cell_budget"]["residual_rel"].max() < 1e-9
        lvl = mb["tank_level_m3"][0]
        assert abs(lvl - (mb["tank_storage_m3"] - mb["tank_release_m3"])) < 1e-9
        assert 0 <= lvl <= 5.0 + 1e-9
        res[dd] = mb
    assert res[0.0]["tank_release_m3"] == 0 and res[0.01]["tank_release_m3"] > 0
    assert res[0.01]["tank_storage_m3"] > res[0.0]["tank_storage_m3"]  # capacity restored


def test_crop_to_active_matches_uncropped():
    act = np.zeros((8, 12), bool)
    act[2:7, 1:11] = True
    kw = dict(hours=3, start=T0, active_mask=act, building_mask=np.zeros((8, 12), bool))
    a = GridRun(make(**kw))
    assert a.s.h.shape == (5, 10)
    a.advance()
    oa = a.finish()
    ob = run_grid(make(crop_to_active=False, **kw))
    assert oa.max_depth_m.shape == (8, 12) and oa.crop_slices == ((2, 7), (1, 11))
    np.testing.assert_allclose(oa.max_depth_m, ob.max_depth_m, rtol=0, atol=1e-12)
    assert abs(oa.mass_balance["rain_m3"] - ob.mass_balance["rain_m3"]) < 1e-9


def test_river_edge_outlets_identifies_low_corners_only():
    from bcnflood.solver.topology import river_edge_outlets
    ny, nx = 20, 20
    yy, xx = np.mgrid[:ny, :nx]
    z = 2.0 + 20.0 * (yy / ny) * (1 - xx / nx) + 50.0 * (yy < 3)  # high ridge on north edge
    z[yy < 8] -= 0
    z[(yy < 6) & (xx > 14)] = 3.0  # low NE corner (Besos-like)
    z[(yy > 14) & (xx < 5)] = 4.0  # low SW corner (Llobregat-like)
    act = np.ones((ny, nx), bool)
    m = river_edge_outlets(z, act, 10.0, sea=np.zeros((ny, nx), bool))
    assert m["besos"].any() and m["llobregat"].any() and m["kind"] == "assumption"
    assert not m["all"][0, :10].any()  # ridge edge stays closed


def test_nan_inf_limits_and_override_recorded():
    import pytest

    from bcnflood.solver.grid import validate
    from bcnflood.solver.local_inertial import (
        Domain,
        NumericsLimitError,
        State,
        check_numerics,
        run,
    )
    for a, d in ((float("nan"), 1.0), (0.3, float("nan")), (float("inf"), 1.0),
                 (0.3, float("inf")), (-0.1, 1.0), (0.3, 0.0)):
        with pytest.raises(NumericsLimitError):
            check_numerics(a, d)
    with pytest.raises(NumericsLimitError):
        check_numerics(float("nan"), 1.0, override=True)
    with pytest.raises(ValueError):
        validate(make(alpha=float("nan")))
    with pytest.raises(ValueError):
        validate(make(dt_max_s=float("inf"), override_numerics=True))
    dom = Domain(z=np.zeros((2, 2)), dx=5.0, manning_n=0.03)
    with pytest.warns(RuntimeWarning):
        _, led = run(dom, State.dry((2, 2)), lambda t: 0.0, 10.0, 10.0, dt_max=5.0,
                     override=True)
    assert led.numerics_override
    _, led2 = run(dom, State.dry((2, 2)), lambda t: 0.0, 10.0, 10.0)
    assert not led2.numerics_override
    with pytest.warns(RuntimeWarning):
        o = run_grid(make(hours=1, start=T0, dt_max_s=5.0, override_numerics=True))
    assert o.mass_balance["numerics_override"] is True


def test_30m_synthetic_river_and_sea_outlets_conserve():
    """30 m synthetic grid: sea strip (free outfall) + low NE/SW boundary corners
    (critical-depth river outlets, assumption) + closed high ridge."""
    ny, nx = 24, 24
    yy, xx = np.mgrid[:ny, :nx]
    z = 40.0 - 1.5 * yy + 0.0 * xx  # slopes down to the south
    z[(yy < 10) & (xx > 18)] = 3.0 + 0.1 * yy[(yy < 10) & (xx > 18)]  # low NE edge plain
    z[(yy > 12) & (xx < 4)] = 2.0  # low SW plain
    z[yy >= 22] = -1.0  # sea strip on the south edge
    ridge = (yy < 3) & (xx <= 16)
    z[ridge] += 100.0  # high ridge on the north edge: must stay closed
    act = np.ones((ny, nx), bool)
    g = make(ny=ny, nx=nx, hours=6, start=T0, dem_m=z, dx_m=30.0, outlet_mask=None,
             building_mask=np.zeros((ny, nx), bool), active_mask=act)
    r = GridRun(g)
    assert r.outlet[22:, :].all() and r.edge_out is not None and r.edge_out.any()
    assert not (r.edge_out & ridge).any() and not (r.edge_out & r.outlet).any()
    r.advance()
    o = r.finish()
    mb = o.mass_balance
    assert mb["edge_outflow_m3"] > 0 and mb["outflow_m3"] > 0
    assert mb["mass_balance_error_rel"] < 1e-9
    assert o.diagnostics["cell_budget"]["residual_rel"].max() < 1e-9


def test_zero_ks_on_pervious_cells_no_nan():
    o = run_grid(make(hours=4, start=T0, ga_k_sat_m_s=np.zeros((8, 12)),
                      pervious_mask=np.ones((8, 12), bool)))
    assert o.mass_balance["infiltration_m3"] == 0
    assert all(np.isfinite(v) for d in o.daily for v in d["budget"].values())
    assert np.isfinite(o.mass_balance["mass_balance_error_rel"])
    from bcnflood.solver.local_inertial import GreenAmpt
    cap = GreenAmpt(np.array([0.0, 1e-6]), 0.1, 0.3).capacity(np.zeros(2))
    assert cap[0] == 0 and np.isinf(cap[1])


def test_origin_kept_through_crop_and_in_summary(tmp_path):
    import json

    from bcnflood.solver import launch
    act = np.zeros((8, 12), bool)
    act[2:7, 1:11] = True
    g = make(hours=1, start=T0, active_mask=act, building_mask=np.zeros((8, 12), bool),
             x0_m=1000.0, y0_m=5000.0, rain_station_ids=["X4", "D5"])
    r = GridRun(g)
    assert (r.g.x0_m, r.g.y0_m) == (1000.0 + 1 * 10.0, 5000.0 - 2 * 10.0)
    p = tmp_path / "in.pkl"
    launch.save_inputs(g, p)
    assert launch.main(["--inputs", str(p), "--scenario", "mid", "--out", str(tmp_path),
                        "--synthetic"]) == 0
    s = json.loads((tmp_path / "mid" / "summary.json").read_text())
    assert s["rain_station_ids"] == ["X4", "D5"]
    assert launch.load_inputs(p).rain_station_ids == ["X4", "D5"]
    assert s["grid"]["crs"] == "EPSG:25831" and s["grid"]["crop_slices"] == [[2, 7], [1, 11]]
    z = np.load(tmp_path / "mid" / "outputs.npz")
    for k in ("budget_residual_rel", "contributing_area_flux_m2", "inflow_N_m3",
              "dominant_inflow_dir", "peak_time_utc_s", "depression_depth_m", "slope_m_m",
              "d8_accumulation_m2_crosscheck"):
        assert k in z.files and z[k].shape == (8, 12)


def test_rain_station_ids_validated():
    import pytest

    from bcnflood.solver.grid import validate
    with pytest.raises(ValueError, match="rain_station_ids"):
        validate(make(rain_station_ids=["X4"]))
    with pytest.raises(ValueError, match="rain_station_ids"):
        validate(make(rain_station_ids=["X4", "X4"]))
