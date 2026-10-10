"""M2-A3-07 audit of /hotspots (api/hotspots.py, Agent 5) against solver diagnostics (Agent 2).
SYNTHETIC runs only. H1-H3 fixed in 11286b0, see docs/audit/gates_report.md."""
import os
import warnings
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest

hs = pytest.importorskip("bcnflood.api.hotspots")
syn = pytest.importorskip("bcnflood.api.synthetic")
grid = pytest.importorskip("bcnflood.solver.grid")
from bcnflood.api.products import day_index  # noqa: E402
from bcnflood.api.runstore import load_run  # noqa: E402
from bcnflood.data.timewindows import local_day_windows  # noqa: E402
from tests.test_g6_final_audit import _gi  # noqa: E402

CODES = {0: "N", 1: "E", 2: "S", 3: "W"}


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    root = tmp_path_factory.mktemp("runs")
    old = os.environ.get("BCNFLOOD_RUNS")
    os.environ["BCNFLOOD_RUNS"] = str(root)
    syn.make_synthetic_run("hs", root=root, days=syn.DST_DAYS, scenarios=False,
                           rain_mm_h=120.0, snapshot_s=600.0)
    r = load_run("hs")
    yield r
    if old is None:
        os.environ.pop("BCNFLOOD_RUNS", None)
    else:
        os.environ["BCNFLOOD_RUNS"] = old


def _npz(run):
    return np.load(Path(run.meta["launch_dir"]) / "outputs.npz")


def test_ranking_uses_only_simulated_fields(run):
    for d in run.days():
        gj = hs.hotspots(run, d, limit=5)
        f = run.grid[d.isoformat()]
        score = f["max_depth_m"] * f["time_above_0_10m_s"] / 60.0
        feats = gj["features"]
        assert feats, "no hotspots in synthetic run"
        got = [p["properties"]["score"]["value"] for p in feats]
        assert got == sorted(got, reverse=True)
        assert got[0] == pytest.approx(float(score.max()), rel=1e-12)
        for p in feats:
            pr = p["properties"]
            assert pr["score"]["kind"] == "simulated"
            r, c = (int(x) for x in pr["cell_id"][1:].split("c"))
            assert pr["score"]["value"] == pytest.approx(float(score[r, c]), rel=1e-12)
            assert "report" not in pr["provenance"]["selection"].lower()


def test_cell_budget_closes_in_run_outputs(run):
    z = _npz(run)
    keys = [k for k in z.files if "residual_rel" in k]
    assert keys, "per-cell budget not stored"
    assert max(float(np.nanmax(z[k])) for k in keys) < 1e-9


def test_peak_time_is_madrid_local_incl_dst(run):
    d = run.days()[-1]  # 25 Oct 2026, 25 h day (CEST -> CET at 03:00 local)
    for p in hs.hotspots(run, d, limit=5)["features"]:
        t = p["properties"]["peak_time_local"]
        assert t is not None
        ts = datetime.fromisoformat(t)
        assert ts.date() == d
        assert ts.utcoffset() is not None
        # the offset must be the one Madrid actually had at that instant (+02 before 01:00Z
        # on 25 Oct, +01 after), i.e. not a fixed offset and not UTC
        inst = ts.astimezone(hs.MADRID)
        assert inst.utcoffset() == ts.utcoffset()
        assert ts.utcoffset().total_seconds() / 3600 in (1.0, 2.0)


def test_peak_time_matches_per_step_peak(run):
    """H3 fixed (11286b0). Origin confirmed: per-day peak_time_utc_s is seconds after the RUN
    start t0_utc (grid.py:100, summary.json t0_utc), not after the local-day start."""
    z = _npz(run)
    t0 = run.start_utc
    for i, d in enumerate(run.days()):
        pt = z[f"day{i}_peak_time_utc_s"]
        win = local_day_windows(d, d)[0]
        w0, w1 = win.start_utc, win.end_utc
        idx, _, _ = day_index(run, d)
        ts = np.array([(run.time_utc(k) - t0).total_seconds() for k in idx])
        for p in hs.hotspots(run, d, limit=3)["features"]:
            pr = p["properties"]
            r, c = (int(x) for x in pr["cell_id"][1:].split("c"))
            got = datetime.fromisoformat(pr["peak_time_local"])
            assert (got - t0).total_seconds() == pytest.approx(float(pt[r, c]), abs=1e-3)
            assert w0 <= got < w1  # per-day peak lies inside that Madrid day
            # independent: the snapshot nearest the served peak is near the day's envelope
            k = idx[int(np.argmin(np.abs(ts - float(pt[r, c]))))]
            assert run.h[k, r, c] >= 0.8 * run.h[idx, r, c].max()
            assert pr["peak_depth_m"] >= run.h[idx, r, c].max() - 1e-12


def _cliff_case():
    ny, nx = 12, 8
    z = np.tile(np.linspace(3, 0.5, ny)[:, None], (1, nx))
    z[8, :] = 0.0       # collecting row
    b = np.zeros((ny, nx), bool)
    b[9, :] = True      # building / wall row south of it (blocked, sheds no water south)
    z[9, :] = 8.0
    z[10:, :] = 0.2
    rain = np.zeros((3, 1))
    rain[0, 0] = 30.0
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        o = grid.run_grid(_gi(z, hours=3, rain_mm=rain, dx=30.0, building_mask=b))
    return z, o


def test_flux_inflow_direction_is_physical_in_cliff_case():
    z, o = _cliff_case()
    dom = o.diagnostics["dominant_inflow_dir"]
    assert all(CODES[int(v)] == "N" for v in dom[8, 1:-1])  # water arrives from upslope
    assert (o.max_depth_m[8, 1:-1] > 0.2).all()


def _own_face_inflow(z, run_kw):
    """Re-run run_grid while independently accumulating per-face inflow from the solver's
    final (post-limiter) face discharges qx, qy after each step."""
    orig = grid.step
    tot = {}

    def spy(dom, s, dt, f, led, *a, **kw):
        orig(dom, s, dt, f, led, *a, **kw)
        if not tot:
            tot.update({k: np.zeros(s.h.shape) for k in "NESW"})
        tot["N"][1:, :] += np.maximum(s.qy, 0) * dt  # +qy: row r-1 -> r (from north)
        tot["S"][:-1, :] += np.maximum(-s.qy, 0) * dt
        tot["W"][:, 1:] += np.maximum(s.qx, 0) * dt  # +qx: col c-1 -> c (from west)
        tot["E"][:, :-1] += np.maximum(-s.qx, 0) * dt

    grid.step = spy
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            o = grid.run_grid(_gi(z, **run_kw))
    finally:
        grid.step = orig
    return o, np.stack([tot[k] for k in "NESW"])


def _case(name):
    if name == "wall":
        z, _ = _cliff_case()
        b = np.zeros(z.shape, bool)
        b[9, :] = True
        rain = np.zeros((3, 1))
        rain[0, 0] = 30.0
        return z, dict(hours=3, rain_mm=rain, dx=30.0, building_mask=b)
    rng = np.random.default_rng(7)
    z = np.add.outer(np.linspace(4, 0, 20), np.zeros(20)) + rng.normal(0, 0.3, (20, 20))
    em = np.zeros((20, 20), bool)
    em[-1, :] = True
    rain = np.zeros((4, 1))
    rain[0, 0] = 40.0
    return z, dict(hours=4, rain_mm=rain, dx=30.0, edge_outflow_mask=em)


@pytest.mark.parametrize("name", ["wall", "rough"])
def test_dominant_inflow_dir_matches_independent_face_fluxes(name):
    z, kw = _case(name)
    o, mine = _own_face_inflow(z, kw)
    served = np.stack([o.diagnostics["inflow_by_dir_m3"][k] for k in "NESW"])
    np.testing.assert_allclose(served, mine * kw["dx"], rtol=1e-9, atol=1e-9)
    dom = o.diagnostics["dominant_inflow_dir"]
    mine_dom = np.where(mine.max(0) > 0, mine.argmax(0), -1)
    sig = mine.max(0) * kw["dx"] > 1e-6  # skip negligible-inflow cells (argmax ties)
    assert (dom[sig] == mine_dom[sig]).all()
    if name == "wall":
        assert all(CODES[int(v)] == "N" for v in dom[8, 1:-1])


def test_api_inflow_direction_consistent_with_flux(run):
    """H1 fixed: served main_inflow_direction == solver dominant_inflow_dir; D8 is kept only
    as a labelled DEM cross-check."""
    n = 0
    for d in run.days():
        f = run.grid[d.isoformat()]
        for p in hs.hotspots(run, d, limit=5)["features"]:
            pr = p["properties"]
            r, c = (int(x) for x in pr["cell_id"][1:].split("c"))
            code = int(f["dominant_inflow_dir"][r, c])
            assert pr["main_inflow_direction"] == hs.DIR_NAMES.get(code)
            byd = {k: v["value"] for k, v in pr["inflow_by_direction"].items()}
            assert max(byd, key=byd.get) == CODES[code]
            assert "cross-check" in pr["dem_crosscheck"]["label"].lower()
            n += 1
    assert n > 0
    z, _ = _cliff_case()  # D8 still says the dry wall; it must not be the served direction
    assert hs._d8_inflow_direction(z, 8, 3) == "SE"


def test_simulated_contributing_area_served(run):
    d = run.days()[0]
    p = hs.hotspots(run, d, limit=1)["features"][0]["properties"]
    assert p["upstream_contributing_area"]["simulated"]["value"] is not None
    e = p["explanation"]
    v = {k: e[k]["value"] for k in ("rain_in", "roof_in", "inflow", "runoff_out",
                                    "drainage_out", "infiltration_out", "boundary_outflow",
                                    "tank", "storage_end")}
    assert None not in v.values()
    # served whole-run cell budget closes when re-added independently (clip ~0)
    gain = v["rain_in"] + v["roof_in"] + v["inflow"]
    loss = (v["runoff_out"] + v["drainage_out"] + v["infiltration_out"]
            + v["boundary_outflow"] + v["tank"] + v["storage_end"])
    assert abs(gain - loss) <= 1e-6 * max(gain, 1e-12)
    assert e["residual_rel"]["value"] < 1e-9


def test_nothing_from_reports():
    import inspect
    import re
    src = inspect.getsource(hs)
    assert not re.search(r"\bflood.?reports?\b|\bincidents?\b|\bobserved_outcome\b", src, re.I)
