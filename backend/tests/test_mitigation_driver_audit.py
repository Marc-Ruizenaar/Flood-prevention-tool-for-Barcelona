"""M2-A3-05 follow-up: audit of the option-B mitigation driver (55f6ff4) on SYNTHETIC data.
Checks: configs differ from the subdomain baseline ONLY in levers (identical forcing, grid,
drainage, numerics); every lever labelled assumption; safe numerics, no override; mass incl.
tank/roof storage closes per config."""
import dataclasses
import json
import warnings
from pathlib import Path

import numpy as np
import pytest

sub = pytest.importorskip("bcnflood.solver.subdomain")
grid = pytest.importorskip("bcnflood.solver.grid")
from bcnflood.solver.local_inertial import ALPHA_LIMIT, DT_MAX_LIMIT  # noqa: E402
from tests.test_mitigation_driver import _synthetic  # noqa: E402

CFG = json.loads((Path(__file__).resolve().parents[1] / "config" / "mitigation_levers.json")
                 .read_text())


@pytest.fixture(scope="module")
def configs():
    g = _synthetic()
    g = dataclasses.replace(g, rain_mm=g.rain_mm * 8.0)  # heavy enough to exceed mid drainage
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        hmax = grid.run_grid(g).max_depth_m
    cell = tuple(int(v) for v in np.unravel_index(np.nanargmax(hmax), hmax.shape))
    gs, meta = sub.cut_around_hotspot(g, cell, margin_cells=3)
    hm = tuple(meta["hotspot_sub"])
    return gs, sub.lever_configs(gs, hm, CFG)


def _eq(a, b):
    if isinstance(a, np.ndarray):
        return np.array_equal(a, b, equal_nan=a.dtype.kind == "f")
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(_eq(a[k], b[k]) for k in a)
    if isinstance(a, list | tuple) and a and isinstance(a[0], np.ndarray):
        return len(a) == len(b) and all(_eq(x, y) for x, y in zip(a, b, strict=True))
    return a == b


def test_configs_differ_from_baseline_only_in_levers(configs):
    _, cf = configs
    assert set(cf) == {"baseline", "drain", "suds", "tank", "green_roof"}
    base = cf["baseline"]
    assert base.mitigation == []
    for name, gc in cf.items():
        for f in dataclasses.fields(gc):
            if f.name == "mitigation":
                continue
            assert _eq(getattr(gc, f.name), getattr(base, f.name)), (name, f.name)


def test_levers_labelled_and_numerics_safe(configs):
    _, cf = configs
    for name, gc in cf.items():
        assert gc.alpha <= ALPHA_LIMIT and gc.dt_max_s <= DT_MAX_LIMIT
        assert gc.override_numerics is False
        for lv in gc.mitigation:
            assert "assumption" in lv.source.lower(), name
        assert (len(gc.mitigation) > 0) == (name != "baseline")


@pytest.mark.parametrize("name", ["baseline", "drain", "suds", "tank", "green_roof"])
def test_mass_balance_including_storage(configs, name):
    _, cf = configs
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        o = grid.run_grid(cf[name])
    mb = o.mass_balance
    assert mb["numerics_override"] is False
    assert mb["mass_balance_error_rel"] < 1e-9
    if name == "tank":
        assert mb["tank_storage_m3"] + mb["tank_release_m3"] > 0, "tank not exercised"
        # tank_storage_m3 = cumulative captured (refills after drain-down allowed);
        # level = captured - released must stay within the tank volume
        lvl = mb["tank_level_m3"][0]
        assert lvl == pytest.approx(mb["tank_storage_m3"] - mb["tank_release_m3"], rel=1e-9)
        assert 0 <= lvl <= CFG["configs"][3]["levers"][0]["volume_m3"] + 1e-9
