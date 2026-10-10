"""Builder aggregation (synthetic arrays), XEMA parsing, subdomain cut, lever configs."""
import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from bcnflood.solver.bcn_inputs import (
    aggregate_surface,
    fill_missing_nearest,
    read_xema,
    thiessen_weights,
)
from bcnflood.solver.grid import GridRun, run_grid
from bcnflood.solver.subdomain import cut_around_hotspot, lever_configs
from tests.test_grid import make

CFG = json.loads((Path(__file__).resolve().parents[1] / "config/mitigation_levers.json")
                 .read_text())


def test_aggregate_no_nan_and_conservative_ks():
    f = 6
    dem = np.ones((12, 12))
    valid = np.ones((12, 12), bool)
    roof = np.zeros((12, 12), bool)
    roof[:6, :6] = True  # block 0: all roof
    roof[6:9, 0:6] = True  # block 2: half roof
    ks = np.where(np.arange(12)[None, :] < 9, 0.0, 1.0) * np.ones((12, 1))  # sealed left
    psi = np.where(ks > 0, 10.0, np.nan)
    por = np.where(ks > 0, 0.4, np.nan)
    n = np.full((12, 12), 0.015)
    a = aggregate_surface(dem, valid, roof, n, ks, psi, por, f=f)
    for k in ("ga_k_sat_m_s", "ga_psi_m", "ga_delta_theta", "manning_n"):
        assert np.isfinite(a[k]).all()
    assert a["building_mask"][0, 0] and a["building_mask"][1, 0]  # 1.0 and 0.5 >= threshold
    # block (0,1): cols 6..11, 3 of 6 cols pervious with Ks 1 cm/h -> 0.5 cm/h
    assert abs(a["ga_k_sat_m_s"][0, 1] * 360000 - 0.5) < 1e-12
    assert abs(a["ga_psi_m"][0, 1] - 0.10) < 1e-12 and abs(a["ga_delta_theta"][0, 1] - 0.4) < 1e-12
    assert a["ga_k_sat_m_s"][1, 0] == 0 and a["ga_psi_m"][1, 0] == 0


def test_xema_parse_fill_and_thiessen(tmp_path):
    t0 = datetime(2026, 10, 1, 22, tzinfo=UTC)
    recs = lambda vals: [{"codi_variable": "35", "codi_base": "SH", "codi_estat": "",  # noqa: E731
                          "data_lectura": f"2026-10-01T{22 + i // 2:02d}:{30 * (i % 2):02d}:00.000",
                          "valor_lectura": str(v)} for i, v in enumerate(vals) if v is not None]
    pa, pb = tmp_path / "a.json", tmp_path / "b.json"
    pa.write_text(json.dumps(recs([1.0, 2.0, 3.0, 0.0])))
    pb.write_text(json.dumps(recs([0.5, None, 1.5, 0.0])))
    r, qc = read_xema({"A": pa, "B": pb}, t0=t0, n=4)
    assert np.isnan(r[1, 1]) and qc["B"]["blank"] == 3
    xy = np.array([[0.0, 0.0], [10.0, 0.0]])
    f, log = fill_missing_nearest(r, xy, ["A", "B"])
    assert f[1, 1] == 2.0 and log == [{"interval": 1, "station": "B", "from": "A",
                                        "value_mm": 2.0}]
    w = thiessen_weights(np.array([[1.0, 9.0]]), np.array([[0.0, 0.0]]), xy)
    assert w[:, 0, 0].tolist() == [1.0, 0.0] and w[:, 0, 1].tolist() == [0.0, 1.0]


def _valley():
    ny, nx = 30, 30
    yy, xx = np.mgrid[:ny, :nx]
    z = 0.2 * np.abs(xx - 15) + 0.1 * (ny - yy) + 0.0
    z[25:28, 14:17] -= 1.0  # depression = hotspot near the outlet end
    return z


def test_subdomain_contains_upstream_and_conserves():
    z = _valley()
    g = make(ny=30, nx=30, hours=6, start=datetime(2026, 10, 3, 0, tzinfo=UTC), dem_m=z,
             dx_m=30.0, building_mask=np.zeros((30, 30), bool),
             active_mask=np.ones((30, 30), bool), outlet_mask=None)
    gs, meta = cut_around_hotspot(g, (26, 15), margin_cells=2)
    assert meta["status"] == "CONDITIONAL" and gs.dem_m.size < z.size
    assert meta["d8_upstream_area_m2"] > 50 * 900
    gs2, meta2 = cut_around_hotspot(g, (26, 15), margin_cells=1, flux_contrib_area_m2=6e5)
    assert meta2["box_active_area_m2"] >= 6e5 or meta2["cells"] == z.size
    o = run_grid(gs)
    assert o.mass_balance["mass_balance_error_rel"] < 1e-9


def test_lever_configs_labels_and_mass():
    assert all(c["label"] == "assumption, illustrative, Orchestrator-set; not engineering design"
               for c in CFG["configs"])
    z = _valley()
    bld = np.zeros((30, 30), bool)
    bld[5:20:3, 3:12:2] = True
    g = make(ny=30, nx=30, hours=8, start=datetime(2026, 10, 3, 0, tzinfo=UTC), dem_m=z,
             dx_m=30.0, building_mask=bld, active_mask=np.ones((30, 30), bool),
             outlet_mask=None, ga_k_sat_m_s=np.where(np.arange(30)[None, :] % 2 == 0, 0.0,
                                                    1e-6) * np.ones((30, 1)))
    gs, meta = cut_around_hotspot(g, (26, 15), margin_cells=3)
    confs = lever_configs(gs, meta["hotspot_sub"], CFG)
    assert set(confs) == {"baseline", "drain", "suds", "tank", "green_roof"}
    res = {k: run_grid(v) for k, v in confs.items()}
    for k, o in res.items():
        assert o.mass_balance["mass_balance_error_rel"] < 1e-9, k
        assert o.diagnostics["cell_budget"]["residual_rel"].max() < 1e-9, k
    assert all("not engineering design" in lv.source for v in confs.values()
               for lv in v.mitigation)
    assert res["drain"].mass_balance["drainage_m3"] > res["baseline"].mass_balance["drainage_m3"]
    assert res["suds"].mass_balance["infiltration_m3"] > \
        res["baseline"].mass_balance["infiltration_m3"]
    assert res["green_roof"].mass_balance["roof_storage_m3"] > 0
    t = res["tank"].mass_balance
    assert 0 < t["tank_storage_m3"] <= t["rain_m3"]
    assert res["tank"].max_depth_m.sum() <= res["baseline"].max_depth_m.sum()


def test_tank_drains_only_after_rain_and_never_over_captures():
    from bcnflood.solver.mitigation import Lever
    cells = np.zeros((8, 12), bool)
    cells[:, 10] = True
    g = make(hours=8, start=datetime(2026, 10, 3, 0, tzinfo=UTC),
             mitigation=[Lever("tank", cells, {"volume_m3": 1e6, "inflow_mm_h": 1e9,
                                               "drain_down_m3_s": 1.0,
                                               "drain_down_after_rain_only": True})])
    r = GridRun(g)
    r.advance(5 * 3600.0)  # rain in hours 2-5 of make(): still raining until t=5 h
    assert r.cum["tank_release"] == 0 and r.cum["tank_storage"] > 0
    assert (r.s.h >= 0).all()
    r.advance()
    o = r.finish()
    assert o.mass_balance["tank_release_m3"] > 0
    assert o.mass_balance["mass_balance_error_rel"] < 1e-9


def test_per_interval_weight_override_gap_fill():
    import pytest

    from bcnflood.solver.bcn_inputs import idw_gap_fill
    from bcnflood.solver.grid import validate
    ny, nx = 8, 12
    xy = np.array([[0.0, 0.0], [120.0, 0.0], [60.0, 80.0]])
    names = ["A", "D5", "C"]
    yc, xc = np.mgrid[:ny, :nx] * 10.0 + 5.0
    w = thiessen_weights(xc, yc, xy)
    raw = np.zeros((6, 3))
    raw[2:5] = [10.0, 20.0, 30.0]
    raw[3, 1] = np.nan  # D5 missing in interval 3
    act = np.ones((ny, nx), bool)
    rain, over, log = idw_gap_fill(raw, w, xc, yc, names, xy, act, 100.0)
    assert list(over) == [3] and rain[3, 1] == 0 and over[3][1].sum() == 0
    assert np.allclose(over[3].sum(0), 1.0) and log[0]["fill_volume_m3"] > 0
    g = make(hours=6, start=datetime(2026, 10, 3, 0, tzinfo=UTC), rain_mm=rain,
             station_weights=w, station_weights_by_interval=over, sea_outlet=False,
             rain_station_ids=names)
    o = run_grid(g)
    exp = sum((np.einsum("s,syx->yx", rain[i], over.get(i, w)) * 1e-3 * 100.0).sum()
              for i in range(6))
    assert abs(o.mass_balance["rain_m3"] - exp) / exp < 1e-12
    assert o.mass_balance["mass_balance_error_rel"] < 1e-9
    bad = {3: over[3] * 0.5}
    with pytest.raises(ValueError, match="override"):
        validate(make(hours=6, rain_mm=rain, station_weights=w,
                      station_weights_by_interval=bad))
