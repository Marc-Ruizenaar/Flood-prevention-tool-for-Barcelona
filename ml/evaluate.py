"""Metrics, cross-validation, real-world check and trust rules.

Pure functions where possible so the tests can call them directly.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance
from sklearn.isotonic import IsotonicRegression
from sklearn.model_selection import GroupKFold

from config import (CV_FOLDS, FEATURES, HIGH_LIFT_300, HIGH_LOSO_AUC, HIGH_MIN_REAL_POINTS,
                    HIGH_MIN_STORMS, MED_LOSO_AUC, MED_MIN_STORMS, MED_SPATIAL_AUC, MIN_STEP_ROWS,
                    RADII_M, THRESHOLD, TOP_N, TOP_SPREAD_M)
from geo import greedy_top


# ----------------------------------------------------------------------------- helpers
def clean(obj):
    """Make an object JSON safe: numpy -> python, NaN/Inf -> None."""
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        v = float(obj)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def _safe_div(a, b):
    return float(a) / float(b) if b else None


def roc_auc(y, p):
    """Rank-based AUC (Mann-Whitney). None when only one class is present."""
    y = np.asarray(y).astype(int)
    p = np.asarray(p, dtype=float)
    n_pos, n_neg = int(y.sum()), int((1 - y).sum())
    if n_pos == 0 or n_neg == 0:
        return None
    ranks = pd.Series(p).rank(method="average").to_numpy()
    return float((ranks[y == 1].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def class_metrics(y, p, threshold=THRESHOLD) -> dict:
    """The ClassMetrics object of the contract."""
    y = np.asarray(y).astype(int)
    p = np.asarray(p, dtype=float)
    pred = (p >= threshold).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    n = tp + fp + fn + tn
    precision = _safe_div(tp, tp + fp)
    recall = _safe_div(tp, tp + fn)
    spec = _safe_div(tn, tn + fp)
    parts = [v for v in (recall, spec) if v is not None]
    balanced = float(np.mean(parts)) if parts else None
    f1 = None
    if precision is not None and recall is not None and (precision + recall) > 0:
        f1 = 2 * precision * recall / (precision + recall)
    elif precision is not None and recall is not None:
        f1 = 0.0
    majority = max(int(y.sum()), int((1 - y).sum()))
    edges = np.linspace(0, 1, 6)
    cal = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & ((p < hi) if hi < 1 else (p <= hi))
        if m.sum() > 0:
            cal.append({"bin": [round(float(lo), 2), round(float(hi), 2)],
                        "mean_predicted": float(p[m].mean()),
                        "observed_rate": float(y[m].mean()), "n": int(m.sum())})
    return {
        "n": int(n), "threshold": float(threshold),
        "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        "accuracy": _safe_div(tp + tn, n),
        "baseline_accuracy": _safe_div(majority, n),
        "balanced_accuracy": balanced,
        "precision": precision, "recall": recall, "f1": f1,
        "roc_auc": roc_auc(y, p),
        "brier": float(np.mean((p - y) ** 2)) if n else None,
        "calibration": cal,
    }


# ----------------------------------------------------------------------------- CV
def training_frame(df: pd.DataFrame) -> pd.DataFrame:
    return df[~df["excluded_edge_ponding"]].reset_index(drop=True)


def spatial_cv(df: pd.DataFrame, make_model, n_splits=CV_FOLDS):
    """GroupKFold on 500 m blocks. Returns (frame with oof column, importance dict).

    All rows in one block (both days) are held out together, so a segment never appears in
    train and test of the same fold.
    """
    d = training_frame(df)
    X, y, groups = d[FEATURES], d["label"].to_numpy(), d["block"].to_numpy()
    oof = np.full(len(d), np.nan)
    imps = {f: [] for f in FEATURES}
    folds = []
    for tr, te in GroupKFold(n_splits=n_splits).split(X, y, groups):
        folds.append((tr, te))
        model = make_model().fit(X.iloc[tr], y[tr])
        oof[te] = model.predict_proba(X.iloc[te])[:, 1]
        if len(set(y[te])) == 2:
            r = permutation_importance(model, X.iloc[te], y[te], scoring="roc_auc",
                                       n_repeats=5, random_state=42)
            for f, v in zip(FEATURES, r.importances_mean):
                imps[f].append(float(v))
    d = d.assign(oof=oof)
    mean_imp = {f: (float(np.mean(v)) if v else 0.0) for f, v in imps.items()}
    return d, folds, mean_imp


def normalise_importance(mean_imp: dict):
    clipped = {k: max(0.0, v) for k, v in mean_imp.items()}
    tot = sum(clipped.values())
    items = [{"feature": k, "importance": (v / tot if tot > 0 else 0.0)} for k, v in clipped.items()]
    return sorted(items, key=lambda r: -r["importance"])


def leave_one_storm_out(df: pd.DataFrame, make_model):
    d = training_frame(df)
    out = {}
    for tr_date, te_date in [("2026-10-02", "2026-10-03"), ("2026-10-03", "2026-10-02")]:
        tr, te = d[d["date"] == tr_date], d[d["date"] == te_date]
        model = make_model().fit(tr[FEATURES], tr["label"])
        p = model.predict_proba(te[FEATURES])[:, 1]
        key = f"train_{tr_date.replace('-', '_')}_test_{te_date.replace('-', '_')}"
        out[key] = class_metrics(te["label"].to_numpy(), p)
    return out


# ----------------------------------------------------------------------------- calibration
def new_calibrator() -> IsotonicRegression:
    return IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)


class PooledStepCalibrator:
    """Isotonic map pooled so that every step rests on at least `min_rows` out-of-fold rows.

    1. Fit plain isotonic regression (the pool-adjacent-violators solution).
    2. Its output is a staircase. Take each step as a block of rows, in raw-score order.
    3. While some block has fewer than `min_rows` rows, merge the smallest one into the neighbour
       with the closer value. The merged value is the row-weighted mean of the observed rate.
       A merged value lies between the two it replaces, so the staircase stays non-decreasing.

    `edges` are raw-score cut points (midway between neighbouring blocks), `values` the level of each
    block, `counts` the rows behind it. Prediction is a lookup, so it is monotonic and bounded by the
    observed rates, hence inside [0, 1].
    """

    def __init__(self, min_rows: int = 30):
        self.min_rows = int(min_rows)
        self.edges = np.empty(0)
        self.values = np.empty(0)
        self.counts = np.empty(0, dtype=int)
        self.lows = np.empty(0)   # smallest raw score in each block
        self.highs = np.empty(0)  # largest raw score in each block

    def fit(self, oof, y):
        x = np.asarray(oof, dtype=float)
        t = np.asarray(y, dtype=float)
        order = np.argsort(x, kind="stable")
        x, t = x[order], t[order]
        iso = new_calibrator().fit(x, t)
        level = iso.predict(x)
        # Blocks: runs of rows that share one isotonic level.
        cuts = np.flatnonzero(np.diff(level) != 0) + 1
        starts = np.concatenate(([0], cuts))
        ends = np.concatenate((cuts, [len(x)]))
        blocks = [{"n": int(e - s), "pos": float(t[s:e].sum()), "lo": float(x[s]), "hi": float(x[e - 1])}
                  for s, e in zip(starts, ends)]
        while len(blocks) > 1:
            small = min(range(len(blocks)), key=lambda i: (blocks[i]["n"], i))
            if blocks[small]["n"] >= self.min_rows:
                break
            rate = lambda b: b["pos"] / b["n"]  # noqa: E731
            options = [j for j in (small - 1, small + 1) if 0 <= j < len(blocks)]
            other = min(options, key=lambda j: (abs(rate(blocks[j]) - rate(blocks[small])), j))
            lo, hi = sorted((small, other))
            a, b = blocks[lo], blocks[hi]
            blocks[lo:hi + 1] = [{"n": a["n"] + b["n"], "pos": a["pos"] + b["pos"],
                                  "lo": a["lo"], "hi": b["hi"]}]
        self.counts = np.array([b["n"] for b in blocks], dtype=int)
        self.values = np.array([b["pos"] / b["n"] for b in blocks], dtype=float)
        self.lows = np.array([b["lo"] for b in blocks])
        self.highs = np.array([b["hi"] for b in blocks])
        self.edges = (self.highs[:-1] + self.lows[1:]) / 2.0
        return self

    def predict(self, raw):
        idx = np.searchsorted(self.edges, np.asarray(raw, dtype=float), side="right")
        return np.clip(self.values[idx], 0.0, 1.0)

    def steps(self) -> list[dict]:
        """The step table for the file: `to_raw` is the top of each step (null for the last)."""
        return [{"to_raw": (round(float(self.edges[i]), 4) if i < len(self.edges) else None),
                 "p": round(float(v), 4), "n": int(c)}
                for i, (v, c) in enumerate(zip(self.values, self.counts))]


def fit_calibrator(oof, y, min_rows: int = MIN_STEP_ROWS) -> PooledStepCalibrator:
    """Isotonic map from the raw model score to the observed flood rate, fitted on out-of-fold
    scores and pooled so every step has at least `min_rows` rows."""
    return PooledStepCalibrator(min_rows).fit(oof, y)


def nested_calibrated(oof, y, folds) -> np.ndarray:
    """Calibrated predictions for honest measurement.

    For each outer spatial fold, fit the calibrator on the out-of-fold scores of the OTHER folds
    only and apply it to the held-out fold. A street is never calibrated by a map that saw it.
    Caveat: the other folds' scores came from models that were trained on rows of the held-out fold,
    so this is not a fully independent nested split. A stricter version would need an inner CV.
    """
    oof = np.asarray(oof, dtype=float)
    y = np.asarray(y, dtype=float)
    out = np.full(len(oof), np.nan)
    for _, te in folds:
        rest = np.ones(len(oof), dtype=bool)
        rest[te] = False
        out[te] = fit_calibrator(oof[rest], y[rest]).predict(oof[te])
    return out


def reliability_bins(p, y, n_bins: int = 5) -> list[dict]:
    """Equal-width bins on [0, 1]. The last bin includes 1.0. Empty bins keep n=0 and null means."""
    p = np.asarray(p, dtype=float)
    y = np.asarray(y, dtype=float)
    edges = np.linspace(0, 1, n_bins + 1)
    rows = []
    for i, (lo, hi) in enumerate(zip(edges[:-1], edges[1:])):
        m = (p >= lo) & ((p < hi) if i < n_bins - 1 else (p <= hi))
        n = int(m.sum())
        rows.append({"from": round(float(lo), 2), "to": round(float(hi), 2),
                     "predicted_mean": float(p[m].mean()) if n else None,
                     "observed_rate": float(y[m].mean()) if n else None, "n": n})
    return rows


# A reliability bin with fewer streets than this is called a small sample.
THIN_BIN_ROWS = 30


def reliability_sentence(at_70: dict | None) -> str:
    if at_70 is None:
        return ("The model almost never gives a 60 to 80% chance, so there is no honest '70%' to check. "
                "Read the table for the levels it does give.")
    said = round(at_70["predicted_mean"] * 100)
    got = round(at_70["observed_rate"] * 100)
    text = (f"When the model says {said}%, the simulation flooded {got}% of the time "
            f"({at_70['n']} streets).")
    if at_70["n"] < THIN_BIN_ROWS:
        text += " That is a small sample, so treat it as rough."
    return text


def reliability_block(oof, y, folds) -> tuple[dict, np.ndarray]:
    """metrics.reliability of the contract (v2) and the pooled nested calibrated predictions."""
    y = np.asarray(y, dtype=float)
    oof = np.asarray(oof, dtype=float)
    nested = nested_calibrated(oof, y, folds)
    bins = reliability_bins(nested, y)
    mid = next((b for b in bins if b["from"] == 0.6 and b["to"] == 0.8), None)
    at_70 = None
    if mid is not None and mid["n"] > 0:
        at_70 = dict(mid)
    return {
        "bins": bins,
        "bins_raw": reliability_bins(oof, y),
        "brier_before": float(np.mean((oof - y) ** 2)),
        "brier_after": float(np.mean((nested - y) ** 2)),
        "at_70": at_70,
        "sentence": reliability_sentence(at_70),
    }, nested


def calibrated_confusion(y, nested) -> dict:
    """Confusion matrix at the standard threshold on the nested calibrated predictions."""
    m = class_metrics(y, nested)
    return {"n": m["n"], "threshold": m["threshold"], "confusion": m["confusion"],
            "accuracy": m["accuracy"], "baseline_accuracy": m["baseline_accuracy"],
            "balanced_accuracy": m["balanced_accuracy"], "precision": m["precision"],
            "recall": m["recall"], "f1": m["f1"], "roc_auc": m["roc_auc"], "brier": m["brier"]}


# ----------------------------------------------------------------------------- real world
def hit_rate(points_xy: np.ndarray, top_xy: np.ndarray, radius_m: float):
    """Share of points within radius_m of any top area. Returns (hits, n, rate)."""
    if len(points_xy) == 0:
        return 0, 0, None
    d = np.hypot(points_xy[:, None, 0] - top_xy[None, :, 0], points_xy[:, None, 1] - top_xy[None, :, 1])
    hits = int((d.min(axis=1) <= radius_m).sum())
    return hits, len(points_xy), hits / len(points_xy)


def real_world(p_scenario: np.ndarray, seg_x: np.ndarray, seg_y: np.ndarray, test_points: pd.DataFrame):
    top = greedy_top(p_scenario, seg_x, seg_y, n=TOP_N, spread_m=TOP_SPREAD_M)
    top_xy = np.column_stack([seg_x[top], seg_y[top]])
    rep = test_points[test_points["kind"] == "reported"][["x_m", "y_m"]].to_numpy()
    rnd = test_points[test_points["kind"] == "random"][["x_m", "y_m"]].to_numpy()
    rows = []
    for r in RADII_M:
        hits, n, rate = hit_rate(rep, top_xy, r)
        _, _, rrate = hit_rate(rnd, top_xy, r)
        lift = (rate / rrate) if (rate is not None and rrate) else None
        rows.append({"n_points": n, "radius_m": r, "hits": hits, "hit_rate": rate,
                     "random_rate": rrate, "lift": lift})
    return rows, top


# ----------------------------------------------------------------------------- trust
def trust_assessment(spatial_auc, loso_aucs, lift_300, n_points, trained_storms) -> dict:
    """Trust rules are constants (see config.py). A rule with a missing value fails."""
    loso_vals = [v for v in loso_aucs if v is not None]
    loso_min = min(loso_vals) if len(loso_vals) == len(loso_aucs) and loso_vals else None

    def ge(v, t):
        return v is not None and v >= t

    def gt(v, t):
        return v is not None and v > t

    def fmt(v):
        return "n/a" if v is None else f"{v:.2f}"

    rules = [
        ("high: worst leave-one-storm-out AUC >= %.2f" % HIGH_LOSO_AUC, ge(loso_min, HIGH_LOSO_AUC), loso_min,
         f"Carry-over between storms is weak: the worst leave-one-storm-out AUC is {fmt(loso_min)}, "
         f"{HIGH_LOSO_AUC:.2f} needed for high trust."),
        ("high: real-world lift at 300 m > %.1f" % HIGH_LIFT_300, gt(lift_300, HIGH_LIFT_300), lift_300,
         f"Real-world check: the top areas sit near reported places {fmt(lift_300)}x as often as random "
         f"points, more than {HIGH_LIFT_300:.1f}x needed for high trust."),
        ("high: reported places in box >= %d" % HIGH_MIN_REAL_POINTS, n_points >= HIGH_MIN_REAL_POINTS, n_points,
         f"Only {n_points} reported places fall inside the model box, {HIGH_MIN_REAL_POINTS} needed for high trust."),
        ("high: trained storms >= %d" % HIGH_MIN_STORMS, trained_storms >= HIGH_MIN_STORMS, trained_storms,
         f"Only {trained_storms} training storms, {HIGH_MIN_STORMS} needed for high trust."),
        ("medium: spatial CV AUC >= %.2f" % MED_SPATIAL_AUC, ge(spatial_auc, MED_SPATIAL_AUC), spatial_auc,
         f"Spatial cross-validation AUC is {fmt(spatial_auc)}, {MED_SPATIAL_AUC:.2f} needed for medium trust."),
        ("medium: worst leave-one-storm-out AUC >= %.2f" % MED_LOSO_AUC, ge(loso_min, MED_LOSO_AUC), loso_min,
         f"The worst leave-one-storm-out AUC is {fmt(loso_min)}, {MED_LOSO_AUC:.2f} needed for medium trust."),
        ("medium: trained storms >= %d" % MED_MIN_STORMS, trained_storms >= MED_MIN_STORMS, trained_storms,
         f"Only {trained_storms} training storms, {MED_MIN_STORMS} needed for medium trust."),
    ]
    high = all(r[1] for r in rules[:4])
    medium = all(r[1] for r in rules[4:])
    level = "high" if high else ("medium" if medium else "low")
    return {
        "level": level,
        "rules": [{"rule": r[0], "passed": bool(r[1]), "value": r[2]} for r in rules],
        "reasons": [r[3] for r in rules if not r[1]],
    }


# ----------------------------------------------------------------------------- improvements
BASE_IMPROVEMENTS = [
    "Add more solver storms (at least 5, with different rain totals and open box edges so water can leave "
    "the domain). Two storms is the main limit on everything below.",
    "Replace simulated labels with real incident labels: Bombers de Barcelona and Guardia Urbana callouts, "
    "or the 112 incident log, geocoded per street.",
    "Use the BCASA pluvial flood map (vector data) as an independent label and a second check.",
    "Add per-section sewer capacity so drainage varies by street instead of one uniform sink.",
    "Use a finer terrain model (ICGC 2 m) instead of the 3.6 m resampled public tiles.",
    "Simulate more than one drainage level, so the model can learn the drainage effect instead of "
    "using a fixed rain-minus-drainage formula.",
]


def results_based_improvements(spatial: dict, loso: dict, rw: list, n_excluded: int,
                               within_storm_auc: dict | None = None) -> list[str]:
    out = []
    if within_storm_auc:
        heavy = within_storm_auc.get("2026-10-03")
        if heavy is not None and spatial.get("roc_auc") is not None:
            out.append(f"The pooled spatial AUC ({spatial['roc_auc']:.2f}) is mostly the model telling the "
                       f"two storms apart. Inside the heavy storm alone, ranking streets by terrain gives "
                       f"AUC {heavy:.2f}. Judge the terrain skill by the second number.")
    a = loso.get("train_2026_10_02_test_2026_10_03")
    b = loso.get("train_2026_10_03_test_2026_10_02")
    if a and a.get("recall") is not None and a["recall"] < 0.5:
        out.append("Trained on the mild storm only, the model misses most of the flooded streets of the "
                   f"severe storm (recall {a['recall']:.2f}). It needs a mid-size storm in the training set.")
    if b and b.get("precision") is not None and b["precision"] < 0.5:
        out.append("Trained on the severe storm only, the model over-flags the mild storm "
                   f"(precision {b['precision']:.2f}). Storm size is not yet learned reliably.")
    if n_excluded:
        out.append(f"{n_excluded} segments next to the closed box edge were left out because the physics "
                   "model piles water against a wall there. Re-run the box with open edges so they can be used.")
    r300 = next((r for r in rw if r["radius_m"] == 300), None)
    if r300 and r300["n_points"] < HIGH_MIN_REAL_POINTS:
        out.append(f"Only {r300['n_points']} reported places fall inside the box, too few for a reliable "
                   "real-world check. Extend the simulated area to the whole city.")
    sp = spatial.get("roc_auc")
    if sp is not None and sp > 0.9:
        out.append("A high spatial AUC only shows the model copies our own physics model. It says nothing "
                   "yet about real Barcelona floods.")
    return out
