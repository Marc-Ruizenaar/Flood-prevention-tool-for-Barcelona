"""Tests for the ML pipeline. Run:  ml/.venv/Scripts/python -m pytest ml/tests -q"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from sklearn.model_selection import GroupKFold

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))

from build_dataset import excess_rain, make_label  # noqa: E402
from config import (CALIBRATION_BANDS, CAVEAT, DATA_ML, FEATURES, FORBIDDEN, LABEL_DEPTH_M,  # noqa: E402
                    MIN_STEP_ROWS, OUT)
from evaluate import (class_metrics, fit_calibrator, nested_calibrated, reliability_bins,  # noqa: E402
                      reliability_block, spatial_cv, trust_assessment)
from geo import block_ids  # noqa: E402
from predict_scenarios import expected_share, is_extrapolated, risk_score  # noqa: E402
from train import make_model  # noqa: E402

CONTRACT_TOP = {"version", "kind", "caveat", "generated_at", "model", "metrics", "trust",
                "improvements", "segments", "scenarios"}


def synthetic_frame(n_seg=300, seed=0):
    rng = np.random.default_rng(seed)
    x, y = rng.uniform(0, 3000, n_seg), rng.uniform(0, 3000, n_seg)
    base = pd.DataFrame({"segment_id": [f"s{i}" for i in range(n_seg)], "x_m": x, "y_m": y})
    base["block"] = block_ids(x, y, 0.0, 0.0, 500.0)
    for f in FEATURES:
        base[f] = rng.normal(size=n_seg)
    frames = []
    for date, ex in [("2026-10-02", 0.0), ("2026-10-03", 83.4)]:
        t = base.copy()
        t["date"] = date
        t["excess_rain_mm"] = ex
        t["label"] = (rng.random(n_seg) < (0.5 if ex else 0.05)).astype(int)
        t["excluded_edge_ponding"] = False
        frames.append(t)
    return pd.concat(frames, ignore_index=True)


def test_spatial_blocks_never_share_a_segment_across_train_and_test():
    df = synthetic_frame()
    d, folds, _ = spatial_cv(df, make_model)
    ids = d["segment_id"].to_numpy()
    blocks = d["block"].to_numpy()
    assert len(folds) == 5
    for tr, te in folds:
        assert set(ids[tr]).isdisjoint(set(ids[te]))
        assert set(blocks[tr]).isdisjoint(set(blocks[te]))
    assert not np.isnan(d["oof"]).any()


def test_label_threshold():
    assert LABEL_DEPTH_M == 0.15
    got = make_label([0.0, 0.1499, 0.15, 0.151, 2.0]).tolist()
    assert got == [0, 0, 1, 1, 1]


def test_dataset_labels_follow_threshold_if_built():
    path = ML / "out" / "dataset.csv"
    if not path.exists():
        pytest.skip("dataset.csv not built")
    d = pd.read_csv(path)
    assert ((d["depth_m"] >= 0.15).astype(int) == d["label"]).all()


def test_extrapolation_flag():
    rng = [15.5, 143.4]
    assert not is_extrapolated(100, 20, rng)
    assert is_extrapolated(150, 20, rng)      # rain above trained range
    assert is_extrapolated(10, 20, rng)       # rain below trained range
    assert is_extrapolated(100, 10, rng)      # drainage differs
    assert is_extrapolated(100, 30, rng)


def test_excess_rain_formula():
    assert float(excess_rain(143.4, 20)) == pytest.approx(83.4)
    assert float(excess_rain(15.5, 20)) == 0.0
    assert float(excess_rain(100, 30)) == 10.0


def test_risk_score_range_and_rounding():
    assert risk_score([0.0, 0.0]) == 0.0
    assert risk_score([1.0, 1.0]) == 10.0
    assert risk_score([0.123, 0.5]) == round(10 * 0.3115, 1)


def test_confusion_sums_to_n():
    rng = np.random.default_rng(1)
    y = rng.integers(0, 2, 500)
    p = rng.random(500)
    m = class_metrics(y, p)
    c = m["confusion"]
    assert c["tp"] + c["fp"] + c["fn"] + c["tn"] == m["n"] == 500
    assert sum(b["n"] for b in m["calibration"]) == 500


def test_single_class_gives_null_auc_not_nan():
    m = class_metrics(np.zeros(20, dtype=int), np.linspace(0, 1, 20))
    assert m["roc_auc"] is None
    assert m["precision"] is None or not math.isnan(m["precision"])


def test_trust_is_low_for_two_storms():
    t = trust_assessment(spatial_auc=0.95, loso_aucs=[0.95, 0.95], lift_300=3.0, n_points=50, trained_storms=2)
    assert t["level"] == "low"
    failed = [r for r in t["rules"] if not r["passed"]]
    assert failed and len(t["reasons"]) == len(failed)


def test_trust_high_possible_with_enough_evidence():
    t = trust_assessment(spatial_auc=0.9, loso_aucs=[0.85, 0.9], lift_300=2.0, n_points=30, trained_storms=6)
    assert t["level"] == "high"


def test_trust_medium():
    t = trust_assessment(spatial_auc=0.8, loso_aucs=[0.7, 0.8], lift_300=1.0, n_points=10, trained_storms=3)
    assert t["level"] == "medium"


def _walk(o):
    if isinstance(o, dict):
        for v in o.values():
            yield from _walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v)
    else:
        yield o


def test_scenarios_json_matches_contract():
    path = DATA_ML / "scenarios.json"
    assert path.exists(), "run ml/predict_scenarios.py first"
    raw = path.read_text(encoding="utf-8")
    assert len(raw.encode("utf-8")) < 3_000_000
    data = json.loads(raw, parse_constant=lambda c: pytest.fail(f"non-finite constant {c}"))
    assert set(data) == CONTRACT_TOP
    assert data["version"] == 2 and data["kind"] == "ml_scenario"
    assert data["caveat"] == CAVEAT
    n = len(data["segments"])
    assert n > 0
    for s in data["segments"]:
        assert set(s) == {"id", "name", "lon", "lat", "elev_m"}
    ids = [s["id"] for s in data["scenarios"]]
    assert len(ids) == 15 and len(set(ids)) == 15
    for sc in data["scenarios"]:
        assert len(sc["p"]) == n
        assert sc["id"] == f"r{sc['rain_mm']}_d{sc['drainage_mm_h']}"
        assert 0 <= sc["risk_score"] <= 10
        assert round(sc["risk_score"], 1) == sc["risk_score"]
        assert 0 <= sc["share_flooded"] <= 1
        assert all(0 <= v <= 1 for v in sc["p"])
        assert len(sc["top"]) == 10
        assert sc["extrapolated"] == (sc["drainage_mm_h"] != 20 or not (15.5 <= sc["rain_mm"] <= 143.4))
        xs = np.array([[t["lon"], t["lat"]] for t in sc["top"]])
        kx, ky = 111320 * math.cos(math.radians(41.385)), 110574
        for i in range(10):
            for j in range(i + 1, 10):
                d = math.hypot((xs[i, 0] - xs[j, 0]) * kx, (xs[i, 1] - xs[j, 1]) * ky)
                assert d >= 195, "top segments must be about 200 m apart"
    for v in _walk(data):
        if isinstance(v, float):
            assert math.isfinite(v)
    low = raw.lower()
    for w in FORBIDDEN:
        assert w.lower() not in low, f"forbidden word {w!r}"
    assert data["model"]["secondary_labels"].startswith(("not obtained", "used"))
    cal = data["model"]["calibration"]
    assert cal["method"] == "isotonic" and cal["fitted_on"] == "spatial out-of-fold predictions"
    assert cal["n"] > 0 and cal["note"].startswith("Percentages mean:")
    assert all(round(v, 3) == v for sc in data["scenarios"] for v in sc["p"])
    assert cal["bands"] == CALIBRATION_BANDS == {"medium": 0.3, "high": 0.6}
    assert cal["min_step_rows"] == MIN_STEP_ROWS
    assert all(st["n"] >= MIN_STEP_ROWS for st in cal["steps"]) or len(cal["steps"]) == 1
    for sc in data["scenarios"]:
        assert 0 <= sc["expected_share"] <= 1
        assert sc["expected_share"] == round(float(np.mean(sc["p"])), 4)
    assert set(data["metrics"]["leave_one_storm_out"]) == {
        "train_2026_10_02_test_2026_10_03", "train_2026_10_03_test_2026_10_02"}


def test_top_lists_skip_edge_artefact_segments():
    dataset, path = OUT / "dataset.csv", DATA_ML / "scenarios.json"
    if not dataset.exists():
        pytest.skip("ml/out/dataset.csv not built")
    df = pd.read_csv(dataset)
    artefacts = set(df.loc[df["excluded_edge_ponding"].astype(bool), "segment_id"].astype(str))
    assert artefacts, "expected some excluded edge-ponding segments"
    data = json.loads(path.read_text(encoding="utf-8"))
    ids = [s["id"] for s in data["segments"]]
    for sc in data["scenarios"]:
        picked = {ids[t["segment_index"]] for t in sc["top"]}
        assert picked.isdisjoint(artefacts), f"{sc['id']} alerts on an edge artefact"


# ----------------------------------------------------------------------------- calibration
RELIABILITY_KEYS = {"bins", "bins_raw", "brier_before", "brier_after", "at_70", "sentence"}
BIN_KEYS = {"from", "to", "predicted_mean", "observed_rate", "n"}


def scored_frame(n=800, seed=3):
    """OOF-like scores that are too confident: true rate is pulled halfway to 0.5."""
    rng = np.random.default_rng(seed)
    df = synthetic_frame(n_seg=n // 2, seed=seed)
    score = rng.random(len(df))
    df["oof"] = score
    df["label"] = (rng.random(len(df)) < 0.25 + 0.5 * score).astype(int)
    return df


def block_folds(df):
    return list(GroupKFold(n_splits=5).split(df, df["label"], df["block"]))


def test_calibrator_is_monotonic_and_bounded():
    df = scored_frame()
    cal = fit_calibrator(df["oof"], df["label"])
    grid = np.linspace(-0.5, 1.5, 400)  # includes values outside the fitted range
    out = cal.predict(grid)
    assert (np.diff(out) >= -1e-12).all(), "calibrated p must never fall as the raw score rises"
    assert out.min() >= 0.0 and out.max() <= 1.0


def test_every_calibrated_step_rests_on_at_least_30_rows():
    # A steep, noisy relation makes plain isotonic produce tiny steps at the top. Pooling must remove them.
    rng = np.random.default_rng(11)
    n = 1500
    raw = rng.random(n)
    y = (rng.random(n) < np.where(raw > 0.95, 1.0, 0.1 + 0.4 * raw)).astype(int)
    cal = fit_calibrator(raw, y)
    steps = cal.steps()
    assert len(steps) >= 1
    assert all(st["n"] >= MIN_STEP_ROWS for st in steps)
    assert sum(st["n"] for st in steps) == n
    ps = [st["p"] for st in steps]
    assert ps == sorted(ps), "step table must be monotonic"
    out = cal.predict(np.linspace(-0.5, 1.5, 500))
    assert (np.diff(out) >= -1e-12).all() and out.min() >= 0.0 and out.max() <= 1.0


def test_pooling_blocks_a_100_percent_top_step():
    raw = np.linspace(0, 1, 400)
    y = np.zeros(400, dtype=int)
    y[-10:] = 1  # ten sure flooded rows at the very top, a plateau of 100% on 10 rows
    cal = fit_calibrator(raw, y)
    assert all(st["n"] >= MIN_STEP_ROWS for st in cal.steps())
    assert cal.predict(np.array([1.0]))[0] < 1.0


def test_expected_share_is_mean_p_rounded():
    assert expected_share([0.0, 0.5, 1.0, 0.25]) == 0.4375
    assert expected_share(np.array([0.1, 0.2, 0.2])) == 0.1667


def test_reliability_block_keys_and_row_counts():
    df = scored_frame()
    folds = block_folds(df)
    block, nested = reliability_block(df["oof"], df["label"], folds)
    assert set(block) == RELIABILITY_KEYS
    assert len(nested) == len(df)
    assert not np.isnan(nested).any() and nested.min() >= 0 and nested.max() <= 1
    for name in ("bins", "bins_raw"):
        assert len(block[name]) == 5
        assert all(set(b) == BIN_KEYS for b in block[name])
        assert sum(b["n"] for b in block[name]) == len(df)
        assert [b["from"] for b in block[name]] == [0.0, 0.2, 0.4, 0.6, 0.8]
    assert block["at_70"] is None or (block["at_70"]["from"], block["at_70"]["to"]) == (0.6, 0.8)
    assert isinstance(block["sentence"], str) and block["sentence"]
    assert 0 <= block["brier_after"] <= 1 and 0 <= block["brier_before"] <= 1


def test_nested_calibration_never_uses_the_held_out_fold():
    df = scored_frame()
    folds = block_folds(df)
    oof, y = df["oof"].to_numpy(), df["label"].to_numpy()
    nested = nested_calibrated(oof, y, folds)
    for tr, te in folds:
        expected = fit_calibrator(oof[tr], y[tr]).predict(oof[te])
        assert np.allclose(nested[te], expected)


def test_reliability_bins_sum_and_include_one():
    p = np.array([0.0, 0.19, 0.2, 0.99, 1.0])
    y = np.array([0, 0, 1, 1, 1])
    bins = reliability_bins(p, y)
    assert sum(b["n"] for b in bins) == 5
    assert bins[-1]["n"] == 2 and bins[-1]["observed_rate"] == 1.0
    empty = reliability_bins(np.array([0.1]), np.array([0]))
    assert empty[3]["n"] == 0 and empty[3]["predicted_mean"] is None


def test_scenarios_json_reliability_matches_metrics_json():
    metrics_path, sc_path = DATA_ML / "metrics.json", DATA_ML / "scenarios.json"
    assert metrics_path.exists() and sc_path.exists(), "run train.py and predict_scenarios.py first"
    m = json.loads(metrics_path.read_text(encoding="utf-8"))
    d = json.loads(sc_path.read_text(encoding="utf-8"))
    rel = d["metrics"]["reliability"]
    assert rel == m["metrics"]["reliability"]
    assert set(rel) == RELIABILITY_KEYS
    n_eval = d["model"]["calibration"]["n"]
    assert sum(b["n"] for b in rel["bins"]) == n_eval == sum(b["n"] for b in rel["bins_raw"])
    assert sum(d["metrics"]["calibrated_confusion"]["confusion"].values()) == n_eval
    assert d["metrics"]["calibrated_confusion"]["n"] == n_eval
    assert rel["brier_after"] <= rel["brier_before"] + 1e-9
    if rel["at_70"] is not None:
        assert rel["at_70"] in rel["bins"]
