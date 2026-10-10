"""M2-A3-06 audit of /streets aggregation and /mitigation API (Agent 3). SYNTHETIC runs only.
Independent recomputation of p95 / minutes-above / flood_class; WGS84 lon/lat order; footway
filtering; VALID_DAYS. xfail(strict) = confirmed defect (docs/audit/gates_report.md)."""
import gzip
import json
from types import SimpleNamespace

import numpy as np
import pytest

S = pytest.importorskip("bcnflood.api.streets")
syn = pytest.importorskip("bcnflood.api.synthetic")
from bcnflood.api.products import day_index  # noqa: E402
from bcnflood.api.runstore import load_run  # noqa: E402


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    """Synthetic run_grid run over the DST pair 24-25 Oct (25 h day), 60 s snapshots so the
    per-step fields can be checked against an independent snapshot-based aggregation."""
    import os
    root = tmp_path_factory.mktemp("runs")
    old = os.environ.get("BCNFLOOD_RUNS")
    os.environ["BCNFLOOD_RUNS"] = str(root)
    syn.make_synthetic_run("audit", root=root, days=syn.DST_DAYS, scenarios=False,
                           rain_mm_h=120.0, snapshot_s=60.0)
    r = load_run("audit")
    yield r
    if old is None:
        os.environ.pop("BCNFLOOD_RUNS", None)
    else:
        os.environ["BCNFLOOD_RUNS"] = old


def _snap_day(run, d):
    """Independent: snapshots in the half-open local-day window [a, b)."""
    _, a, b = day_index(run, d)
    m = (run.t >= a - 1e-6) & (run.t < b - 1e-6)
    return run.h[m].astype(float), a, b


@pytest.mark.parametrize("v,cls", [(-0.01, "dry"), (0.0, "dry"), (0.0499, "dry"), (0.05, "low"),
                                   (0.1499, "low"), (0.15, "moderate"), (0.2999, "moderate"),
                                   (0.30, "high"), (0.4999, "high"), (0.50, "severe"),
                                   (None, None)])
def test_flood_class_thresholds(v, cls):
    assert S.flood_class(v) == cls


def test_p95_and_max_match_independent(run):
    """M2 resolution: max/p95 use per-step per-cell daily max fields. Checked against (a) a
    direct recomputation from the served per-day fields and (b) an independent 60 s
    snapshot aggregation (snapshots can only under-sample the true max)."""
    for d in run.days():
        hs, _, _ = _snap_day(run, d)
        f = run.grid[d.isoformat()]["max_depth_m"]
        assert (f >= hs.max(0) - 1e-6).all()  # per-step max >= any sampled value
        assert np.abs(f - hs.max(0)).max() < max(2e-3, 0.02 * f.max())
        for seg in S.load_segments(run)[0]:
            cells = S._cells_on(run, seg["coords"])
            st = S.segment_stats(run, d, cells)
            rr, cc = (list(x) for x in zip(*cells, strict=True))
            assert st["max_depth_m"] == pytest.approx(float(f[rr, cc].max()), rel=1e-12)
            assert st["p95_depth_m"] == pytest.approx(float(np.percentile(f[rr, cc], 95)),
                                                      rel=1e-12)
            assert st["p95_depth_m"] == pytest.approx(
                float(np.percentile(hs.max(0)[rr, cc], 95)), abs=max(2e-3, 0.02 * f.max()))


def test_minutes_above_no_day_boundary_double_count(run):
    """S1 resolution: per-step time-above fields. Per cell, each day <= its length (25 h on
    25 Oct) and day1 + day2 equals the independent snapshot total over the whole run
    (within one snapshot per threshold crossing), so nothing at midnight is counted twice."""
    days = run.days()
    tot_served = np.zeros(run.h.shape[1:])
    tot_snap = np.zeros(run.h.shape[1:])
    for d in days:
        hs, a, b = _snap_day(run, d)
        t10 = run.grid[d.isoformat()]["time_above_0_10m_s"]
        assert (t10 <= (b - a) + 1e-6).all()
        tot_served += t10
        tot_snap += (hs > 0.10).sum(0) * 60.0
    crossings = np.abs(np.diff((run.h.astype(float) > 0.10).astype(int), axis=0)).sum(0)
    assert tot_served.max() > 0
    assert (np.abs(tot_served - tot_snap) <= 60.0 * (crossings + 1) + 1e-6).all()
    for d in days:  # segment minutes = max over the segment's cells (documented definition)
        t10 = run.grid[d.isoformat()]["time_above_0_10m_s"]
        for seg in S.load_segments(run)[0]:
            cells = S._cells_on(run, seg["coords"])
            rr, cc = (list(x) for x in zip(*cells, strict=True))
            assert S.segment_stats(run, d, cells)["minutes_above_0.10m"] == pytest.approx(
                float(t10[rr, cc].max()) / 60.0, rel=1e-12)


def test_geometry_is_wgs84_lon_lat(run):
    gj = S.streets_geojson(run, run.days()[-1])
    assert gj["properties"]["crs"] == "EPSG:4326"
    for f in gj["features"]:
        lon, lat = np.array(f["geometry"]["coordinates"]).T
        assert ((1.9 < lon) & (lon < 2.4)).all() and ((41.2 < lat) & (lat < 41.6)).all()


def test_osm_footways_filtered():
    """S2 closed: api/streets.py ROAD_CLASSES / is_road."""
    if not S.OSM_STREETS.exists():
        pytest.skip("OSM street file absent")
    fc = json.loads(gzip.decompress(S.OSM_STREETS.read_bytes()))
    hw = {f"osm-{f['properties']['osm_id']}": f["properties"].get("highway")
          for f in fc["features"]}
    fake = SimpleNamespace(h=np.zeros((1, 100, 100)),
                           meta={"x0_m": 430000.0, "y0_m": 4582500.0, "dx_m": 5.0})
    S._OSM_CACHE = None
    segs = S._osm_segments(fake)
    assert segs, "no OSM segments in the test window"
    bad = {"footway", "steps", "elevator", "corridor", "path", "ladder", "platform",
           "proposed", "construction", "bus_stop"}
    assert not [s for s in segs if hw.get(s["id"]) in bad]


def test_valid_days_include_2_oct():
    from bcnflood.api.main import VALID_DAYS
    assert {f"2026-10-0{k}" for k in range(2, 8)} <= set(VALID_DAYS)


def test_no_flood_report_inputs():
    """No module under src/ reads evaluation / flood-report data (static scan)."""
    import pathlib
    import re
    src = pathlib.Path(__file__).resolve().parents[1] / "src" / "bcnflood"
    pat = re.compile(r"\bflood.?reports?\b|\bincidents?\b|evaluation/|\bbombers\b"
                     r"|\bdenuncia", re.I)  # word boundaries: 'coincident' must not match
    hits = [p for p in src.rglob("*.py") if pat.search(p.read_text())]
    assert hits == []
