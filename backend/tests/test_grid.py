"""Synthetic-grid tests for solver.grid.run_grid (no Barcelona data)."""
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from bcnflood.solver.drainage import load_scenarios
from bcnflood.solver.grid import GridInputs, run_grid, validate
from bcnflood.solver.mitigation import Lever


def make(ny=8, nx=12, hours=50, start=datetime(2026, 10, 2, 22, tzinfo=UTC), **kw):
    z = np.tile(np.linspace(5, 0, nx), (ny, 1))
    b = np.zeros((ny, nx), bool)
    b[3:5, 4:6] = True
    out = np.zeros((ny, nx), bool)
    out[:, -1] = True
    times = [start + timedelta(hours=i) for i in range(hours + 1)]
    rain = np.zeros((hours, 2))
    rain[2:5, 0] = 20.0
    rain[2:5, 1] = 40.0
    rain[30:31, :] = 60.0
    args = dict(dem_m=z, manning_n=np.full_like(z, 0.03), ga_k_sat_m_s=np.full_like(z, 1e-6),
                ga_psi_m=np.full_like(z, 0.11), ga_delta_theta=np.full_like(z, 0.3),
                building_mask=b, dx_m=10.0, crs="EPSG:25831", rain_times_utc=times,
                rain_mm=rain, station_weights=np.array([0.5, 0.5]), outlet_mask=out,
                dt_max_s=2.0)
    args.update(kw)
    return GridInputs(**args)


def test_outputs_shapes_days_and_mass():
    o = run_grid(make())
    assert o.max_depth_m.shape == (8, 12)
    assert (o.max_depth_m[3:5, 4:6] == 0).all()  # buildings blocked
    assert o.mass_balance["mass_balance_error_rel"] < 1e-9
    assert o.mass_balance["roof_unrouted_m3"] == 0 and o.max_speed_m_s.max() > 0
    assert [d["local_date"] for d in o.daily] == ["2026-10-03", "2026-10-04"]
    for d in o.daily:
        assert d["status"] == "SIMULATED" and d["budget"]["mass_balance_error_rel"] < 1e-9
    total_rain = sum(d["budget"]["rain_m3"] for d in o.daily)
    assert total_rain <= o.mass_balance["rain_m3"] + 1e-9
    assert (o.time_above_0_30m_s <= o.time_above_0_10m_s).all()


def test_rain_volume_exact_with_weights():
    o = run_grid(make())
    exp = (3 * 30e-3 + 60e-3) * 100.0 * 8 * 12  # gross incl. roofs (routed)
    assert o.mass_balance["rain_m3"] == pytest.approx(exp, rel=1e-12)


def test_spatial_weights_and_scenarios_and_mitigation_conserve():
    w = np.zeros((2, 8, 12))
    w[0, :, :6] = 1
    w[1, :, 6:] = 1
    cells = np.zeros((8, 12), bool)
    cells[:, 9:11] = True
    base = run_grid(make(station_weights=w))
    mit = run_grid(make(station_weights=w, drainage_scenario=load_scenarios()["mid"],
                        mitigation=[Lever("tank", cells, {"volume_m3": 20.0}),
                                    Lever("green_roof", np.zeros((8, 12), bool),
                                          {"storage_m": 0.01})]))
    assert mit.mass_balance["mass_balance_error_rel"] < 1e-9
    assert 0 < mit.mass_balance["tank_storage_m3"] <= 20.0 + 1e-9
    assert mit.max_depth_m.sum() < base.max_depth_m.sum()


@pytest.mark.parametrize("change,msg", [
    ({"crs": "EPSG:4326"}, "crs"),
    ({"manning_n": np.full((8, 12), 3.0)}, "manning"),
    ({"ga_k_sat_m_s": np.full((8, 12), 0.01)}, "k_sat"),
    ({"station_weights": np.array([0.5, 0.6])}, "sum to 1"),
    ({"rain_mm": np.full((50, 2), np.nan)}, "finite"),
    ({"rain_mm": np.full((50, 2), 900.0)}, "500 mm/h"),
    ({"dem_m": np.zeros((8, 11))}, "shape"),
    ({"rain_times_utc": [datetime(2026, 10, 3) + timedelta(hours=i) for i in range(51)]},
     "aware"),
])
def test_validation(change, msg):
    with pytest.raises(ValueError, match=msg):
        validate(make(**change))
