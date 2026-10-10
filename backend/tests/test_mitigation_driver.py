"""End-to-end option-B driver on SYNTHETIC data (launcher subprocesses, --synthetic)."""
import json
from datetime import UTC, datetime

import numpy as np

from bcnflood.solver import launch, mitigation_driver
from bcnflood.solver.bcn_inputs import idw_gap_fill, thiessen_weights
from bcnflood.solver.grid import crop_inputs
from tests.test_grid import make


def _synthetic():
    ny, nx = 30, 30
    yy, xx = np.mgrid[:ny, :nx]
    z = 0.2 * np.abs(xx - 15) + 0.1 * (ny - yy)
    z[25:28, 14:17] -= 1.0
    bld = np.zeros((ny, nx), bool)
    bld[5:20:3, 3:12:2] = True
    xy = np.array([[0.0, 0.0], [900.0, 0.0], [450.0, 900.0]])
    yc, xc = np.mgrid[:ny, :nx] * 30.0 + 15.0
    w = thiessen_weights(xc, yc, xy)
    raw = np.zeros((26, 3))
    raw[2:6] = [10.0, 15.0, 20.0]
    raw[3, 1] = np.nan
    rain, over, _ = idw_gap_fill(raw, w, xc, yc, ["A", "D5", "C"], xy,
                                 np.ones((ny, nx), bool), 900.0)
    return make(ny=ny, nx=nx, hours=26, start=datetime(2026, 10, 2, 22, tzinfo=UTC), dem_m=z,
                dx_m=30.0, building_mask=bld, active_mask=np.ones((ny, nx), bool),
                outlet_mask=None, rain_mm=rain, station_weights=w,
                station_weights_by_interval=over, rain_station_ids=["A", "D5", "C"],
                ga_k_sat_m_s=np.where(xx % 2 == 0, 0.0, 1e-6), x0_m=0.0, y0_m=900.0)


def test_overrides_sliced_into_subdomain():
    g = _synthetic()
    sl = (slice(10, 30), slice(5, 25))
    gc, _ = crop_inputs(g, sl)
    assert gc.station_weights_by_interval[3].shape == (3, 20, 20)
    np.testing.assert_array_equal(gc.station_weights_by_interval[3],
                                  g.station_weights_by_interval[3][:, 10:30, 5:25])


def test_driver_end_to_end_synthetic(tmp_path, monkeypatch):
    import dataclasses
    g = _synthetic()
    g = dataclasses.replace(g, rain_mm=g.rain_mm * 8.0)  # ponds > 0.10 m so /hotspots ranks
    p = tmp_path / "base_in.pkl"
    launch.save_inputs(g, p)
    assert launch.main(["--inputs", str(p), "--scenario", "mid", "--out",
                        str(tmp_path / "base"), "--synthetic"]) == 0
    res = mitigation_driver.run(tmp_path / "base" / "mid", [{"top": 1}], tmp_path / "mit",
                                parallel=3, synthetic=True, margin_cells=3)
    assert res["status"] == "CONDITIONAL"
    for v in res["hotspots"].values():
        e = v["meta"]["edges"]
        assert e["boundary_cells"] == (e["sea_outlet_cells"] + e["critical_depth_cells"]
                                       + e["closed_cells"])
        assert all(c["status"] == "ok" for c in v["configs"].values())
    (name, h), = res["hotspots"].items()
    assert h["meta"]["status"] == "CONDITIONAL"
    assert set(h["configs"]) == {"baseline", "drain", "suds", "tank", "green_roof"}
    assert all(v["returncode"] == 0 for v in h["configs"].values())
    for c in ("drain", "suds", "tank", "green_roof"):
        v = h["configs"][c]
        assert v["mass_balance_error_rel"] < 1e-9 and v["days"]
    d = np.load(tmp_path / "mit" / "deltas.npz")
    assert any(k.endswith("_delta_max_depth_m") for k in d.files)
    # tank at the hotspot is not guaranteed monotone (+1.2 mm observed here: lowering h at the
    # cell steepens inflow gradients); only finiteness is asserted
    assert all(np.isfinite(x["hotspot_delta_m"]) for x in h["configs"]["tank"]["days"].values())
    sub = json.loads((tmp_path / "mit" / name / "baseline" / "mid" / "summary.json")
                     .read_text())
    assert sub["rain_station_ids"] == ["A", "D5", "C"]
    # gate check: without --synthetic and without a passing gates file the launcher refuses
    res2 = mitigation_driver.run(tmp_path / "base" / "mid", [{"top": 1}], tmp_path / "mit2",
                                 parallel=2, synthetic=False, margin_cells=3)
    assert all(v["returncode"] == 3 and v["status"] == "failed"
               for h2 in res2["hotspots"].values() for v in h2["configs"].values())
    # CLI exits non-zero when any config is rejected
    hsf = tmp_path / "hs.json"
    hsf.write_text('[{"top": 1}]')
    monkeypatch.setattr(mitigation_driver, "MASS_TOL", -1.0)
    rc = mitigation_driver.main(["--baseline", str(tmp_path / "base" / "mid"), "--hotspots",
                                 str(hsf), "--out", str(tmp_path / "mit3"), "--synthetic",
                                 "--parallel", "2"])
    assert rc == 2


def test_rank_matches_hotspots_rule_and_dedupe():
    from bcnflood.solver.mitigation_driver import rank_hotspots
    h = np.zeros((10, 10))
    t = np.zeros((10, 10))
    h[2, 2], t[2, 2] = 0.5, 600   # score 5
    h[2, 4], t[2, 4] = 0.9, 60    # score 0.9, deeper but lower score; 60 m away -> deduped
    h[8, 8], t[8, 8] = 0.2, 1200  # score 4
    arr = {"day0_max_depth_m": h, "day0_time_above_0_10m_s": t}

    class Z(dict):
        files = list(arr)
    bz = Z(arr)
    summ = {"grid": {"dx_m": 30.0}, "daily": [{"local_date": "2026-10-03"}]}
    assert rank_hotspots(bz, summ, 3) == [(2, 2), (8, 8)]


def test_mass_tolerance_rejects(tmp_path, monkeypatch):
    from bcnflood.solver import mitigation_driver as md
    assert not md._accept({"returncode": 0, "mass_balance_error_rel": 2e-9})
    assert not md._accept({"returncode": 0, "mass_balance_error_rel": float("nan")})
    assert md._accept({"returncode": 0, "mass_balance_error_rel": 5e-10})
