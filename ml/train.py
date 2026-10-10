"""Train the flood-susceptibility model, evaluate it honestly, write data/ml/metrics.json.

Run from the repo root:  ml/.venv/Scripts/python ml/train.py
Needs ml/out/dataset.csv and ml/out/test_points.csv (run build_dataset.py first).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

from build_dataset import excess_rain
from config import (CALIBRATION_BANDS, CAVEAT, DATA_ML, FEATURES, HGB_PARAMS, LABEL_DEFINITION,
                    MIN_STEP_ROWS, OUT, TRAINED_DRAINAGE_MM_H)
from evaluate import (BASE_IMPROVEMENTS, calibrated_confusion, class_metrics, clean, fit_calibrator,
                      leave_one_storm_out, normalise_importance, real_world, reliability_block,
                      results_based_improvements, roc_auc, spatial_cv, training_frame,
                      trust_assessment)

# Secondary label source (MAPRI flood zones). Set by the documented attempt, see README.
SECONDARY_LABELS = ("not obtained: the Generalitat WMS/WFS (sig.gencat.cat) rejects non-browser "
                    "clients with a UserAgentFilterError (HTTP 403), and the layer names are not "
                    "published without GetCapabilities. Not worked around.")

CALIBRATION_NOTE = ("Percentages mean: share of comparable streets that flooded in the physics simulation "
                    "for that rain. Not yet checked against real floods.")

# Scenario used for the real-world check: the heavy day (3 Oct), rain 143 mm at 20 mm/h.
CHECK_RAIN_MM = 143.4


def make_model():
    return HistGradientBoostingClassifier(**HGB_PARAMS)


def segments_table(df: pd.DataFrame) -> pd.DataFrame:
    """One row per segment (static features), taken from the first storm."""
    first = df["date"].iloc[0]
    return df[df["date"] == first].reset_index(drop=True)


def feature_matrix(seg: pd.DataFrame, rain_mm: float, drainage_mm_h: float) -> pd.DataFrame:
    x = seg[FEATURES].copy()
    x["excess_rain_mm"] = float(excess_rain(rain_mm, drainage_mm_h))
    return x


def run() -> dict:
    df = pd.read_csv(OUT / "dataset.csv")
    df["excluded_edge_ponding"] = df["excluded_edge_ponding"].astype(bool)
    tp = pd.read_csv(OUT / "test_points.csv")
    train = training_frame(df)
    n_excluded = int(df["excluded_edge_ponding"].sum())
    trained_storms = int(df["date"].nunique())
    rain_by_date = df.groupby("date")["rain_mm"].first()
    rain_range = [float(rain_by_date.min()), float(rain_by_date.max())]

    oof_df, folds, mean_imp = spatial_cv(df, make_model)
    spatial = class_metrics(oof_df["label"], oof_df["oof"])

    # Calibration. The shipped calibrator is fitted on ALL out-of-fold scores. Its quality is
    # measured separately with a nested split (fitted on the other folds, applied to the held-out one).
    calibrator = fit_calibrator(oof_df["oof"], oof_df["label"])
    joblib.dump(calibrator, OUT / "calibrator.joblib")
    reliability, nested = reliability_block(oof_df["oof"], oof_df["label"], folds)
    cal_confusion = calibrated_confusion(oof_df["label"], nested)
    loso = leave_one_storm_out(df, make_model)

    final = make_model().fit(train[FEATURES], train["label"])
    joblib.dump(final, OUT / "model.joblib")

    seg = segments_table(df)
    p_check = final.predict_proba(feature_matrix(seg, CHECK_RAIN_MM, TRAINED_DRAINAGE_MM_H))[:, 1]
    rw, _ = real_world(p_check, seg["x_m"].to_numpy(), seg["y_m"].to_numpy(), tp)

    r300 = next(r for r in rw if r["radius_m"] == 300)
    trust = trust_assessment(
        spatial_auc=spatial["roc_auc"],
        loso_aucs=[m["roc_auc"] for m in loso.values()],
        lift_300=r300["lift"], n_points=r300["n_points"], trained_storms=trained_storms)

    within = {d: roc_auc(g["label"], g["oof"]) for d, g in oof_df.groupby("date")}
    improvements = BASE_IMPROVEMENTS + results_based_improvements(spatial, loso, rw, n_excluded, within)

    # The pooling rule guarantees this. Fail loudly if it ever stops holding.
    if len(calibrator.counts) > 1 and int(calibrator.counts.min()) < MIN_STEP_ROWS:
        raise SystemExit(f"calibrator has a step with {int(calibrator.counts.min())} rows, "
                         f"minimum is {MIN_STEP_ROWS}")
    max_p = float(calibrator.values.max())
    improvements.append(
        f"The model can only separate a few risk levels (top calibrated level {max_p * 100:.0f}%), because "
        "two storms give little evidence at the extremes. More storms would give it finer levels.")

    result = {
        "model": {
            "type": "HistGradientBoostingClassifier (scikit-learn)",
            "features": FEATURES,
            "feature_importance": normalise_importance(mean_imp),
            "label_definition": LABEL_DEFINITION,
            "trained_storms": trained_storms,
            "trained_rain_mm": rain_range,
            "secondary_labels": SECONDARY_LABELS,
            "excluded_rows": f"edge-ponded segments on 2026-10-03 (n={n_excluded})",
            "calibration": {
                "method": "isotonic",
                "fitted_on": "spatial out-of-fold predictions",
                "n": int(len(oof_df)),
                "note": CALIBRATION_NOTE,
                "min_step_rows": MIN_STEP_ROWS,
                "n_steps": int(len(calibrator.values)),
                "max_p": round(max_p, 4),
                "steps": calibrator.steps(),
                "bands": dict(CALIBRATION_BANDS),
            },
        },
        "metrics": {
            "spatial_cv": spatial,
            "leave_one_storm_out": loso,
            "real_world": rw,
            "reliability": reliability,
            "calibrated_confusion": cal_confusion,
        },
        "trust": trust,
        "improvements": improvements,
    }
    DATA_ML.mkdir(parents=True, exist_ok=True)
    with open(DATA_ML / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(clean(result), f, indent=2, ensure_ascii=False)
    return result


if __name__ == "__main__":
    r = run()
    m = r["metrics"]
    sp = m["spatial_cv"]
    print("caveat:", CAVEAT)
    print(f"spatial CV: n={sp['n']} acc={sp['accuracy']:.3f} base={sp['baseline_accuracy']:.3f} "
          f"bal={sp['balanced_accuracy']:.3f} prec={sp['precision']} rec={sp['recall']} "
          f"auc={sp['roc_auc']} brier={sp['brier']:.4f}")
    print("  confusion", sp["confusion"])
    rel = m["reliability"]
    print(f"calibration: brier {rel['brier_before']:.4f} -> {rel['brier_after']:.4f} (nested)")
    for b in rel["bins"]:
        print("  calibrated bin", b)
    for b in rel["bins_raw"]:
        print("  raw bin", b)
    print("  at_70:", rel["at_70"], "|", rel["sentence"])
    print("  calibrated confusion", m["calibrated_confusion"])
    for k, v in m["leave_one_storm_out"].items():
        print(f"LOSO {k}: n={v['n']} auc={v['roc_auc']} acc={v['accuracy']:.3f} base={v['baseline_accuracy']:.3f} "
              f"prec={v['precision']} rec={v['recall']} confusion={v['confusion']}")
    for r_ in m["real_world"]:
        print("real world", r_)
    print("trust:", r["trust"]["level"])
    for x in r["trust"]["reasons"]:
        print("  -", x)
    print("importance:", r["model"]["feature_importance"])
    print("excluded rows:", r["model"]["excluded_rows"])
    print("generated metrics at", DATA_ML / "metrics.json")
    for x in r["improvements"]:
        print(" *", x)
