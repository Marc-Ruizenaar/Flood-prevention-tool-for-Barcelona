import pytest
from fastapi.testclient import TestClient

from bcnflood.api.main import app
from bcnflood.schemas import AgentReport, DatasetInventory

c = TestClient(app)


def test_health():
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json()["simulation_results_available"] is False


def test_datasets_valid_and_honest():
    r = c.get("/datasets")
    inv = DatasetInventory.model_validate(r.json())
    ids = {d.id: d for d in inv.datasets}
    assert ids["drainage_capacity"].status == "MISSING"
    assert ids["meteocat_xema_api"].status == "MISSING"
    assert not any(d.status == "APPROVED" for d in inv.datasets)


def test_datasets_filter():
    r = c.get("/datasets", params={"status": "MISSING"})
    assert all(d["status"] == "MISSING" for d in r.json()["datasets"])


def test_stubs_return_errors_not_data():
    assert c.get("/days/2026-10-03/summary").status_code == 409
    assert c.get("/days/2026-10-03/cells").status_code == 409
    assert c.get("/days/2026-10-09/summary").status_code == 404
    assert c.get("/days/2026-10-03/streets").status_code == 501
    assert c.get("/exports/geotiff").status_code == 501
    assert c.get("/timeseries").status_code == 409


def test_agent_report_schema():
    AgentReport(agent="agent2_hydrology", task_id="M1", status="REVIEW_REQUIRED", summary="x",
                artifacts_changed=[], tests_run=1, tests_passed=1, tests_failed=0,
                blocking_issues=[], assumptions=[], next_actions=[])


# ---- M2-A5-02: gates -------------------------------------------------------------------------
import json  # noqa: E402
from datetime import UTC, date, datetime, timedelta  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402

from bcnflood.api.contract import daily_from_solver, not_run_daily  # noqa: E402
from bcnflood.api.runstore import BCN_RUN_ID, load_run  # noqa: E402
from bcnflood.api.synthetic import make_synthetic_run  # noqa: E402
from bcnflood.data.timewindows import local_day_window  # noqa: E402
from bcnflood.schemas import Quantity, ValueKind  # noqa: E402
from bcnflood.schemas.contract_v02 import (  # noqa: E402
    DATA_COMPLETENESS_PROVISIONAL_WARNING,
    CellOutputV02,
    DailySummaryV02,
    GateReport,
)

ALL = [f"G{i}" for i in range(1, 9)]


def _gatefile(tmp_path, monkeypatch, statuses):
    p = tmp_path / "gates.json"
    p.write_text(json.dumps({"gates": {k: {"status": v} for k, v in statuses.items()}}))
    monkeypatch.setenv("BCNFLOOD_GATES", str(p))


def _win(d):
    w = local_day_window(d)
    return (w.start_utc, w.end_utc)


def test_gates_missing_file_is_closed(tmp_path, monkeypatch):
    monkeypatch.setenv("BCNFLOOD_GATES", str(tmp_path / "nope.json"))
    r = c.get("/gates").json()
    GateReport.model_validate(r)
    assert r["source_found"] is False and r["all_passed"] is False
    assert [g["id"] for g in r["gates"]] == ALL
    assert all(g["status"] == "UNKNOWN" for g in r["gates"])


def test_gates_one_pending_refuses_runs(tmp_path, monkeypatch):
    st = dict.fromkeys(ALL, "PASSED")
    st["G8"] = "PENDING"
    _gatefile(tmp_path, monkeypatch, st)
    assert c.get("/gates").json()["all_passed"] is False
    r = c.post("/runs")
    assert r.status_code == 409 and "G8=PENDING" in r.json()["detail"]
    assert set(r.json()) == {"error", "detail", "status_code"}
    assert c.get("/cells").status_code == 409
    assert c.get("/daily").status_code == 409
    assert c.get("/timeseries").status_code == 409


def test_gates_bogus_status_never_passes(tmp_path, monkeypatch):
    _gatefile(tmp_path, monkeypatch, dict.fromkeys(ALL, "passed"))
    assert c.get("/gates").json()["all_passed"] is False
    assert c.post("/runs").status_code == 409


def test_gates_all_passed_run_creation_501_and_not_run_daily(tmp_path, monkeypatch):
    _gatefile(tmp_path, monkeypatch, dict.fromkeys(ALL, "PASSED"))
    monkeypatch.setenv("BCNFLOOD_RUNS", str(tmp_path / "runs"))
    assert c.get("/gates").json()["all_passed"] is True
    assert c.post("/runs").status_code == 501
    # R8: gates open but no Barcelona run stored -> NOT_RUN rows, all values null
    rows = c.get("/daily").json()
    assert len(rows) == 6 and all(r["status"] == "NOT_RUN" for r in rows)
    for r in rows:
        DailySummaryV02.model_validate(r)
        assert all(v["value"] is None for v in r.values() if isinstance(v, dict))


def test_gates_is_read_only():
    assert c.post("/gates").status_code == 405
    assert c.put("/gates").status_code == 405


def test_gates_reads_real_file(monkeypatch):
    monkeypatch.delenv("BCNFLOOD_GATES", raising=False)
    r = c.get("/gates").json()
    raw = json.loads(Path(r["source"]).read_text())["gates"]
    assert r["source"].endswith("docs/release_gates.json") and r["source_found"] is True
    assert {g["id"]: g["status"] for g in r["gates"]} == {k: v["status"] for k, v in raw.items()}
    if not r["all_passed"]:
        assert c.post("/runs").status_code == 409


def test_unknown_run_404(tmp_path, monkeypatch):
    monkeypatch.setenv("BCNFLOOD_RUNS", str(tmp_path))
    assert c.get("/runs/x").status_code == 404
    assert c.get("/runs/x/daily").status_code == 404
    assert c.get("/runs/..%2Fetc/daily").status_code == 404


# ---- R2/R7/R8: mapping -----------------------------------------------------------------------
def _quantities(obj):
    if isinstance(obj, dict):
        if {"value", "unit", "kind"} <= set(obj):
            yield obj
        for v in obj.values():
            yield from _quantities(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _quantities(v)


def _assert_quantities_valid(js):
    qs = list(_quantities(js))
    assert qs
    kinds = {k.value for k in ValueKind}
    for qq in qs:
        assert qq["unit"] and qq["kind"] in kinds, qq


def test_incomplete_row_all_null():
    a = daily_from_solver({"window": (0, 1), "status": "INCOMPLETE"}, run_id="x",
                          date_local=date(2026, 10, 3), timezone="Europe/Madrid",
                          window_utc=_win(date(2026, 10, 3)), synthetic=True,
                          drainage_capacity_m_s=0.0)
    assert a.status == "INCOMPLETE"
    assert all(v.value is None for _, v in a if isinstance(v, Quantity))
    assert DATA_COMPLETENESS_PROVISIONAL_WARNING not in a.warnings


def test_not_run_representable():
    a = not_run_daily(run_id="x", date_local=date(2026, 10, 3), timezone="Europe/Madrid",
                      window_utc=_win(date(2026, 10, 3)))
    assert a.status == "NOT_RUN" and a.max_depth.value is None


# ---- M2-A5-03 + endpoints on SYNTHETIC run_grid output (launcher layout) ----------------------
@pytest.fixture(scope="module")
def synth(tmp_path_factory):
    from bcnflood.api.synthetic import DST_DAYS
    root = tmp_path_factory.mktemp("runs")
    make_synthetic_run("synthetic-test", root=root, days=DST_DAYS)
    return root


@pytest.fixture
def api(synth, monkeypatch, tmp_path):
    monkeypatch.setenv("BCNFLOOD_RUNS", str(synth))
    monkeypatch.setenv("BCNFLOOD_GATES", str(tmp_path / "missing.json"))  # gates closed
    return synth


def _summary(run_id="synthetic-test"):
    run = load_run(run_id)
    return run, run.meta["summary"]


def test_runstore_reads_launch_layout(api):
    run, summ = _summary()
    assert run.meta["layout"] == "launch" and run.grid is not None
    assert run.meta["dx_m"] == 10.0  # read from inputs.pkl, not hardcoded
    assert "clip" in run.meta["ledger_columns"]
    assert run.ledger.shape[1] == len(summ["snapshot_ledger_columns"])
    assert Path(run.meta["inputs_pkl"]).exists()
    assert run.meta["drainage_scenarios"]["mid"] == "synthetic-test"


def test_e2e_synthetic_daily_traceable(api):
    run, summ = _summary()
    js = c.get("/runs/synthetic-test/daily").json()
    _assert_quantities_valid(js)
    assert [r["date_local"] for r in js] == ["2026-10-24", "2026-10-25"]
    for a, e in zip(js, summ["daily"], strict=True):
        DailySummaryV02.model_validate(a)
        b = e["budget"]
        assert a["status"] == "SIMULATED" and a["synthetic"] is True
        assert a["rainfall_volume"]["value"] == b["rain_m3"]
        assert a["drainage_volume"]["value"] == b["drainage_m3"] > 0  # baseline = mid drainage
        assert a["boundary_outflow_volume"]["value"] == b["outflow_m3"]
        assert a["mass_balance_error_rel"]["value"] == b["mass_balance_error_rel"] < 1e-9
        assert a["max_depth"]["value"] == float(run.grid[e["local_date"]]["max_depth_m"].max())
        area = run.h.shape[1] * run.h.shape[2] * 100.0
        assert b["rain_m3"] == pytest.approx(0.040 * 2 * area, rel=1e-9)  # 40 mm/h x 2 h
        assert a["drainage_volume"]["kind"] == "assumption"
        assert DATA_COMPLETENESS_PROVISIONAL_WARNING in a["warnings"]
    w = [datetime.fromisoformat(x) for x in js[1]["window_utc"]]
    assert w[1] - w[0] == timedelta(hours=25)
    assert datetime.fromisoformat(js[0]["window_utc"][0]).astimezone(UTC).hour == 22
    assert c.get("/daily", params={"run_id": "synthetic-test"}).json() == js


def test_cells_from_grid(api):
    run, _ = _summary()
    day = run.grid["2026-10-24"]
    for thr, fld in ((0.10, "time_above_0_10m_s"), (0.30, "time_above_0_30m_s")):
        r = c.get("/cells", params={"run_id": "synthetic-test", "date": "2026-10-24",
                                    "threshold_m": thr, "min_depth_m": 0.0})
        js = r.json()
        assert r.status_code == 200 and len(js) == day["max_depth_m"].size
        _assert_quantities_valid([x for x in js if x["max_velocity"]["value"] is not None])
        for cell in js:
            CellOutputV02.model_validate(cell)
            rr, cc = (int(x) for x in cell["cell_id"][1:].split("c"))
            h = float(day["max_depth_m"][rr, cc])
            assert cell["max_depth"]["value"] == h
            v = cell["max_velocity"]["value"]
            assert v == (float(day["max_speed_m_s"][rr, cc]) if h >= 0.01 else None)
            assert cell["max_velocity"]["unit"] == "m/s"
            assert cell["duration_above_threshold"]["value"] == float(day[fld][rr, cc])
    assert c.get("/cells", params={"run_id": "synthetic-test", "date": "2026-10-24",
                                   "threshold_m": 0.2}).status_code == 409
    assert c.get("/cells", params={"run_id": "synthetic-test",
                                   "date": "2026-10-03"}).status_code == 404


def test_timeseries(api):
    r = c.get("/timeseries", params={"run_id": "synthetic-test", "row": 2, "col": 10})
    assert r.status_code == 200
    run = load_run("synthetic-test")
    pts = r.json()["points"]
    assert [p["depth"]["value"] for p in pts] == pytest.approx(run.h[:, 2, 10].tolist())
    _assert_quantities_valid(r.json())
    assert c.get("/timeseries", params={"run_id": "synthetic-test", "row": 99,
                                        "col": 0}).status_code == 404


def test_day_index_half_open(api):
    from bcnflood.api.products import day_index
    run = load_run("synthetic-test")
    i0, a0, b0 = day_index(run, date(2026, 10, 24))
    i1, a1, _ = day_index(run, date(2026, 10, 25))
    assert not set(i0) & set(i1) and b0 == a1
    assert all(a0 <= run.t[i] < b0 for i in i0)


def test_geojson_and_geotiff_exports(api):
    g = c.get("/runs/synthetic-test/export/geojson", params={"date": "2026-10-24"})
    assert g.status_code == 200 and g.headers["content-type"].startswith("application/geo+json")
    fc = g.json()
    assert fc["type"] == "FeatureCollection" and fc["features"]
    lon, lat = fc["features"][0]["geometry"]["coordinates"][0][0]
    assert 1.5 < lon < 2.5 and 41 < lat < 42
    t = c.get("/runs/synthetic-test/export/geotiff", params={"date": "2026-10-24"})
    assert t.status_code == 200 and t.content[:2] in (b"II", b"MM")
    import rasterio
    with rasterio.MemoryFile(t.content) as mf, mf.open() as ds:
        run = load_run("synthetic-test")
        np.testing.assert_array_equal(
            ds.read(1), run.grid["2026-10-24"]["max_depth_m"].astype("float32"))
        assert ds.crs.to_epsg() == 25831 and ds.tags()["units"] == "m"
        assert ds.transform.a == run.meta["dx_m"]


def _fake_real(tmp_path, monkeypatch):
    from bcnflood.api.synthetic import DST_DAYS
    root = tmp_path / "r"
    make_synthetic_run("fake-real", root=root, scenarios=False, days=DST_DAYS)
    meta = root / "fake-real" / "meta.json"
    m = json.loads(meta.read_text())
    m["synthetic"] = False
    meta.write_text(json.dumps(m))
    monkeypatch.setenv("BCNFLOOD_RUNS", str(root))


def test_nonsynthetic_run_gated_then_served(api, tmp_path, monkeypatch):
    _fake_real(tmp_path, monkeypatch)
    for u in ("/runs/fake-real/daily", "/simulations/fake-real/streets?date=2026-10-24",
              "/simulations/fake-real/mitigation",
              "/simulations/fake-real/hotspots?date=2026-10-24",
              "/runs/fake-real/export/geotiff?date=2026-10-24"):
        assert c.get(u).status_code == 409, u
    _gatefile(tmp_path, monkeypatch, dict.fromkeys(ALL, "PASSED"))
    assert c.get("/runs/fake-real/daily").status_code == 200


# ---- M2-A5-04 streets ------------------------------------------------------------------------
def test_streets_geojson(api):
    r = c.get("/simulations/synthetic-test/streets", params={"date": "2026-10-25"})
    assert r.status_code == 200
    fc = r.json()
    assert fc["properties"]["synthetic"] is True and fc["properties"]["crs"] == "EPSG:4326"
    keys = {"date", "max_depth_m", "p95_depth_m", "minutes_above_0.10m", "minutes_above_0.30m",
            "flood_class", "drainage_scenario_spread", "uncertainty_status", "data_quality",
            "aggregation_method"}
    run = load_run("synthetic-test")
    from bcnflood.api.streets import _cells_on, load_segments
    segs, _ = load_segments(run)
    day = run.grid["2026-10-25"]
    for f, s in zip(fc["features"], segs, strict=True):
        assert f["geometry"]["type"] == "LineString"
        p = f["properties"]
        assert keys <= set(p) and p["date"] == "2026-10-25"
        rr, cc = (list(x) for x in zip(*_cells_on(run, s["coords"]), strict=True))
        assert p["max_depth_m"] == float(day["max_depth_m"][rr, cc].max())
        assert p["minutes_above_0.10m"] == pytest.approx(
            float(day["time_above_0_10m_s"][rr, cc].max()) / 60)
        assert p["minutes_above_0.10m"] <= 25 * 60  # bounded by the 25 h day
        assert p["p95_depth_m"] <= p["max_depth_m"]
        sp = p["drainage_scenario_spread"]["max_depth_m"]
        assert set(sp) == {"low", "mid", "high"}
        # spread brackets the baseline: less drainage -> deeper, more -> shallower
        assert sp["high"] - 1e-12 <= p["max_depth_m"] <= sp["low"] + 1e-12
        assert p["drainage_scenario_spread"]["baseline_scenario"] == "mid"
        assert sp["mid"] == p["max_depth_m"]
        assert p["drainage_scenario_spread"]["range_m"] == pytest.approx(sp["low"] - sp["high"])
    assert any(f["properties"]["drainage_scenario_spread"]["range_m"] > 0
               for f in fc["features"])
    assert c.get("/simulations/synthetic-test/streets",
                 params={"date": "2026-10-02"}).status_code == 404


def test_example_streets_file_is_labelled_synthetic():
    fc = json.loads((Path(__file__).resolve().parents[1] / "examples" / "streets_day.geojson")
                    .read_text())
    assert fc["properties"]["synthetic"] is True and "SYNTHETIC" in fc["label"]
    assert "2026-10-02" <= fc["properties"]["date"] <= "2026-10-07"
    assert any(f["properties"]["drainage_scenario_spread"]["range_m"] > 0
               for f in fc["features"])
    for f in fc["features"]:
        p = f["properties"]
        sp = p["drainage_scenario_spread"]["max_depth_m"]
        assert sp["high"] - 1e-12 <= p["max_depth_m"] <= sp["low"] + 1e-12


def test_highway_filter():
    from bcnflood.api.streets import ROAD_CLASSES, is_road
    for h in ("footway", "path", "steps", "cycleway", "track", "pedestrian", "corridor",
              "bridleway", "elevator", "platform", "construction", "proposed", "bus_stop",
              "ladder"):
        assert not is_road({"highway": h}), h
    for h in ("residential", "primary", "service", "living_street", "motorway_link"):
        assert is_road({"highway": h}), h
    assert not is_road({"highway": "service", "area": True})
    assert "footway" not in ROAD_CLASSES


def test_streets_osm_source(api, tmp_path, monkeypatch):
    from bcnflood.api import streets as st
    if not st.OSM_STREETS.exists():
        pytest.skip("M2-A1-07 OSM street file not present")
    root = tmp_path / "osm"
    from bcnflood.api.synthetic import DST_DAYS
    make_synthetic_run("synthetic-osm", root=root, scenarios=False, days=DST_DAYS)
    meta = root / "synthetic-osm" / "meta.json"
    m = json.loads(meta.read_text())
    m["street_source"] = "osm"
    meta.write_text(json.dumps(m))
    monkeypatch.setenv("BCNFLOOD_RUNS", str(root))
    fc = c.get("/simulations/synthetic-osm/streets", params={"date": "2026-10-24"}).json()
    assert fc["properties"]["street_network_stub"] is False
    assert all(f["id"].startswith("osm-") for f in fc["features"])
    segs = st._osm_segments(load_run("synthetic-osm"))
    assert segs and all(s["highway"] in st.ROAD_CLASSES for s in segs)


# ---- M2-A5-05 mitigation ---------------------------------------------------------------------
def test_mitigation_default_scenarios(api):
    r = c.get("/simulations/synthetic-test/mitigation")
    assert r.status_code == 200
    js = r.json()
    assert "not a guarantee" in js["disclaimer"]
    assert js["max_depth_definition"] == "max over all solver steps in the local day"
    run = load_run("synthetic-test")
    for d in js["days"]:
        # baseline peak (mitigation) == max over street cells of the same step-max field
        assert d["baseline"]["peak_depth"]["value"] <= float(
            run.grid[d["date"]]["max_depth_m"].max())
        assert d["baseline"]["peak_depth"]["value"] > 0
        prev = 0.0
        for name in ("drain_plus_10mm_h", "drain_plus_20mm_h", "drain_plus_30mm_h"):
            s = d["scenarios"][name]
            assert s["label"] == "model scenario" and s["lever_kind"] == "assumption"
            dp = s["delta_peak_depth"]["value"]
            assert dp <= 1e-12 and dp <= prev + 1e-12
            prev = dp
    st = c.get("/simulations/synthetic-test/streets", params={"date": "2026-10-24"}).json()
    peak_streets = max(f["properties"]["max_depth_m"] for f in st["features"])
    assert js["days"][0]["baseline"]["peak_depth"]["value"] == peak_streets  # same definition


def test_mitigation_post_custom_and_invalid(api):
    body = {"scenarios": [{"name": "drain_col10", "levers": [
        {"kind": "drain", "cells": [[2, 10], [3, 10]], "params": {"extra_mm_h": 50}}]}]}
    r = c.post("/simulations/synthetic-test/mitigation", json=body)
    assert r.status_code == 200 and set(r.json()["days"][0]["scenarios"]) == {"drain_col10"}
    bad = {"scenarios": [{"name": "x", "levers": [{"kind": "wall", "params": {}}]}]}
    assert c.post("/simulations/synthetic-test/mitigation", json=bad).status_code == 409


def test_mitigation_works_on_nonsynthetic_when_gates_open(api, tmp_path, monkeypatch):
    _fake_real(tmp_path, monkeypatch)
    _gatefile(tmp_path, monkeypatch, dict.fromkeys(ALL, "PASSED"))
    body = {"scenarios": [{"name": "d", "levers": [{"kind": "drain", "cells": "all",
                                                    "params": {"extra_mm_h": 10}}]}]}
    r = c.post("/simulations/fake-real/mitigation", json=body)
    assert r.status_code == 200 and r.json()["synthetic"] is False


def test_numerics_within_g6_limits(api):
    from bcnflood.solver.launch import load_inputs
    g = load_inputs(load_run("synthetic-test").meta["inputs_pkl"])
    assert g.alpha <= 0.35 and g.dt_max_s <= 2.0 and not g.override_numerics


# ---- QA against the real 3-7 Oct run (skipped until it exists) -------------------------------
def test_qa_real_bcn_run():
    run = load_run(BCN_RUN_ID)
    if run is None:
        pytest.skip(f"real run {BCN_RUN_ID} not in run store yet")
    from bcnflood.api.products import daily
    rows = daily(run)
    assert {r.date_local.isoformat() for r in rows} >= {f"2026-10-0{i}" for i in range(3, 8)}
    for r in rows:
        assert not r.synthetic
        if r.status == "SIMULATED":
            assert r.mass_balance_error_rel.value < 1e-9
            assert 0 <= r.max_depth.value < 20


# ---- M2-A5-06 hotspots -----------------------------------------------------------------------
def test_hotspots_ranking_is_purely_numeric(api):
    r = c.get("/simulations/synthetic-test/hotspots", params={"date": "2026-10-24", "limit": 5})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/geo+json")
    fc = r.json()
    assert fc["properties"]["synthetic"] is True and "peak_depth_m" in fc["properties"][
        "score_formula"]
    run = load_run("synthetic-test")
    day = run.grid["2026-10-24"]
    score = day["max_depth_m"] * day["time_above_0_10m_s"] / 60
    feats = fc["features"]
    assert feats and [f["properties"]["rank"] for f in feats] == list(range(1, len(feats) + 1))
    assert feats[0]["properties"]["score"]["value"] == pytest.approx(score.max())
    sc = [f["properties"]["score"]["value"] for f in feats]
    assert sc == sorted(sc, reverse=True)
    xy = []
    for f in feats:
        p = f["properties"]
        rr, cc = (int(x) for x in p["cell_id"][1:].split("c"))
        assert p["peak_depth_m"] == float(day["max_depth_m"][rr, cc])
        assert p["score"]["value"] == pytest.approx(score[rr, cc])
        assert p["minutes_above_0.30m"] == float(day["time_above_0_30m_s"][rr, cc] / 60)
        assert p["flood_class"] in {"dry", "low", "moderate", "high", "severe"}
        lon, lat = f["geometry"]["coordinates"]
        assert 1.9 < lon < 2.4 and 41.2 < lat < 41.6
        xy.append(run.cell_xy(rr, cc))
        ex = p["explanation"]
        assert ex["stored_depth_peak"]["value"] == p["peak_depth_m"]
        dg = run.meta["diag"]
        for key, arr in (("rain_in", "rain_in_m"), ("inflow", "lateral_in_m"),
                         ("runoff_out", "lateral_out_m"), ("drainage_out", "drainage_m"),
                         ("infiltration_out", "infiltration_m")):
            assert ex[key]["value"] == pytest.approx(float(dg[f"budget_{arr}"][rr, cc]) * 100.0)
            assert ex[key]["unit"] == "m3"
        assert ex["rain_in"]["value"] == pytest.approx(0.160 * 100.0)  # 2 days x 80 mm
        assert ex["residual_rel"]["value"] < 1e-6
        assert p["unavailable"] == {}
        # simulated inflow is primary; D8 only as labelled DEM cross-check
        dirs = {k: day[f"inflow_{k}_m3"][rr, cc] for k in "NESW"}
        assert p["main_inflow_direction"] == max(dirs, key=dirs.get)
        assert p["inflow_by_direction"]["N"]["value"] == float(dirs["N"])
        assert p["dem_crosscheck"]["kind"] == "terrain_diagnostic"
        assert "cross-check" in p["dem_crosscheck"]["label"]
        uca = p["upstream_contributing_area"]
        assert uca["simulated"]["kind"] == "simulated"
        assert uca["simulated"]["value"] == float(dg["contributing_area_flux_m2"][rr, cc])
        assert uca["d8_cross_check"]["kind"] == "terrain_diagnostic"
        pt = float(day["peak_time_utc_s"][rr, cc])
        got = datetime.fromisoformat(p["peak_time_local"])
        assert (got - run.start_utc).total_seconds() == pytest.approx(pt, abs=1e-3)
        assert p["peak_time_resolution"] == "solver step"
        assert p["local_slope"]["value"] == float(dg["slope_m_m"][rr, cc])
        lr = p["local_rainfall"]
        assert lr["label"] == "IDW estimate from 4 gauges, unvalidated for 3-7 Oct"
        assert lr["day_total"]["value"] is None and lr["reason"]  # synthetic: no gauge data
        assert p["model_forcing_rain"]["value"] == pytest.approx(80.0)
        assert p["peak_time_local"].endswith("+02:00") or p["peak_time_local"].endswith("+01:00")
        sp = p["drainage_scenario_spread"]["max_depth_m"]
        assert sp["high"] - 1e-12 <= p["peak_depth_m"] <= sp["low"] + 1e-12
    for i in range(len(xy)):  # de-duplicated within 100 m
        for j in range(i):
            assert np.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]) > 100.0


def test_hotspots_with_mitigation(api):
    r = c.get("/simulations/synthetic-test/hotspots",
              params={"date": "2026-10-24", "limit": 1, "include_mitigation": "true"})
    best = r.json()["features"][0]["properties"]["explanation"]["best_mitigation"]
    assert best["label"].startswith("model scenario") and best["delta_peak_depth"]["value"] <= 0


def test_example_hotspots_file():
    fc = json.loads((Path(__file__).resolve().parents[1] / "examples" / "hotspots_day.geojson")
                    .read_text())
    assert fc["properties"]["synthetic"] is True and "SYNTHETIC" in fc["label"]
    assert "2026-10-02" <= fc["properties"]["date"] <= "2026-10-07" and fc["features"]


def test_hotspot_idw_rainfall():
    from bcnflood.api.hotspots import G1_STATIONS, local_rain_idw
    from bcnflood.data.rain_idw import idw_point, load_stations
    st = load_stations(str(G1_STATIONS))
    assert {s.id for s in st} == {"D5", "WU", "X4", "X8"}
    vals = {"D5": 10.0, "WU": 20.0, "X4": 30.0, "X8": None}
    x, y = 430500.0, 4582500.0
    r = local_rain_idw(vals, x, y)
    ref = idw_point(x, y, st, vals, power=2.0, k=4)
    assert r["day_total"] == {"value": ref.value, "unit": "mm", "kind": "estimate"}
    assert r["stations"] == ref.stations and r["weights"] == ref.weights
    assert len(r["distances_m"]) == 3 and r["excluded_missing"] == ["X8"]
    assert sum(r["weights"]) == pytest.approx(1.0) and 10.0 <= r["day_total"]["value"] <= 30.0
    assert r["label"] == "IDW estimate from 4 gauges, unvalidated for 3-7 Oct"
    miss = local_rain_idw(dict.fromkeys(vals), x, y)
    assert miss["day_total"]["value"] is None and miss["reason"]
    assert local_rain_idw(None, x, y)["reason"]


def test_flux_upstream_follows_simulated_inflow():
    from bcnflood.api.hotspots import flux_upstream
    z = np.zeros((3, 3))
    f = {f"inflow_{k}_m3": z.copy() for k in "NESW"}
    f["inflow_W_m3"][1, 2] = 10.0   # (1,2) fed from the west by (1,1)
    f["inflow_N_m3"][1, 1] = 5.0    # (1,1) fed from the north by (0,1)
    f["inflow_S_m3"][1, 1] = 0.1    # < 5 % of (1,1) inflow -> not followed
    assert flux_upstream(f, 1, 2) == {(1, 2), (1, 1), (0, 1)}
    assert flux_upstream({}, 1, 2) is None
