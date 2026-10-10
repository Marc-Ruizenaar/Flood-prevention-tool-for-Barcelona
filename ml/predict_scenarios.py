"""Score every street segment under what-if scenarios and write data/ml/scenarios.json.

Run from the repo root:  ml/.venv/Scripts/python ml/predict_scenarios.py
Needs ml/out/model.joblib, ml/out/calibrator.joblib and data/ml/metrics.json (run train.py first).

p is the CALIBRATED probability (isotonic map fitted in train.py on spatial out-of-fold
predictions): the share of comparable streets that flooded in the physics simulation.
risk_score = 10 x mean(p over all segments), rounded to 1 decimal. expected_share = mean(p),
4 decimals. Both are city-wide summaries, not a depth and not a probability of real flooding.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import joblib
import numpy as np
import pandas as pd

from build_dataset import excess_rain
from config import (CAVEAT, DATA_ML, FEATURES, FORBIDDEN, OUT, SCEN_DRAINAGE_MM_H, SCEN_RAIN_MM,
                    THRESHOLD, TOP_N, TOP_SPREAD_M, TRAINED_DRAINAGE_MM_H)
from evaluate import clean
from geo import greedy_top

MAX_BYTES = 3_000_000


def is_extrapolated(rain_mm, drainage_mm_h, trained_rain_range, trained_drainage=TRAINED_DRAINAGE_MM_H) -> bool:
    """True when the scenario is outside what the model saw: rain outside the trained
    range, or any drainage other than the single simulated value."""
    lo, hi = trained_rain_range
    return bool(rain_mm < lo or rain_mm > hi or float(drainage_mm_h) != float(trained_drainage))


def risk_score(p) -> float:
    return round(10.0 * float(np.mean(p)), 1)


def expected_share(p) -> float:
    """Mean calibrated p over all segments: the expected share of streets that flood. The UI
    should prefer this to share_flooded, which depends on the fragile 0.5 cut."""
    return round(float(np.mean(p)), 4)


def scenario_id(rain, drain) -> str:
    return f"r{int(rain)}_d{int(drain)}"


def rank_scores(calibrated, raw) -> np.ndarray:
    """Ranking key: calibrated p first, raw p to break the many ties an isotonic step map creates."""
    order = np.lexsort((np.asarray(raw), np.asarray(calibrated)))
    score = np.empty(len(order))
    score[order] = np.arange(len(order), dtype=float)
    return score


def build_scenarios(model, seg: pd.DataFrame, trained_rain_range, calibrator=None):
    x_m, y_m = seg["x_m"].to_numpy(), seg["y_m"].to_numpy()
    # Segments left out of training as edge-ponding artefacts are still scored, but never
    # shown as a top area: the alerts would point at a box-wall effect, not a street pattern.
    rankable = ~seg["edge_artefact"].to_numpy(dtype=bool)
    out = []
    for rain in SCEN_RAIN_MM:
        for drain in SCEN_DRAINAGE_MM_H:
            X = seg[FEATURES].copy()
            X["excess_rain_mm"] = float(excess_rain(rain, drain))
            raw = model.predict_proba(X)[:, 1]
            p = np.clip(calibrator.predict(raw), 0.0, 1.0) if calibrator is not None else raw
            p = np.round(p, 3)  # what the file stores, so risk_score, share and top agree with it
            top_idx = greedy_top(np.where(rankable, rank_scores(p, raw), -1.0), x_m, y_m,
                                 n=TOP_N, spread_m=TOP_SPREAD_M)
            out.append({
                "id": scenario_id(rain, drain),
                "rain_mm": rain,
                "drainage_mm_h": drain,
                "extrapolated": is_extrapolated(rain, drain, trained_rain_range),
                "risk_score": risk_score(p),
                "share_flooded": round(float((p >= THRESHOLD).mean()), 4),
                "expected_share": expected_share(p),
                "p": [round(float(v), 3) for v in p],
                "top": [{"rank": r + 1, "segment_index": int(i), "name": str(seg["name"].iloc[i]),
                         "lon": round(float(seg["lon"].iloc[i]), 6), "lat": round(float(seg["lat"].iloc[i]), 6),
                         "p": round(float(p[i]), 3)} for r, i in enumerate(top_idx)],
            })
    return out


def build_file(model, seg: pd.DataFrame, metrics: dict, calibrator=None) -> dict:
    segments = [{"id": str(r.segment_id), "name": "" if pd.isna(r.name) else str(r.name),
                 "lon": round(float(r.lon), 6), "lat": round(float(r.lat), 6),
                 "elev_m": round(float(r.elevation_m), 1)} for r in seg.itertuples(index=False)]
    seg = seg.assign(name=[s["name"] for s in segments])
    return {
        "version": 2 if calibrator is not None else 1,
        "kind": "ml_scenario",
        "caveat": CAVEAT,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": metrics["model"],
        "metrics": metrics["metrics"],
        "trust": metrics["trust"],
        "improvements": metrics["improvements"],
        "segments": segments,
        "scenarios": build_scenarios(model, seg, metrics["model"]["trained_rain_mm"], calibrator),
    }


def forbidden_hits(text: str) -> list[str]:
    low = text.lower()
    return [w for w in FORBIDDEN if w.lower() in low]


def main():
    df = pd.read_csv(OUT / "dataset.csv")
    artefacts = set(df.loc[df["excluded_edge_ponding"].astype(bool), "segment_id"])
    seg = df[df["date"] == df["date"].iloc[0]].reset_index(drop=True)
    seg = seg.assign(edge_artefact=seg["segment_id"].isin(artefacts))
    model = joblib.load(OUT / "model.joblib")
    calibrator = joblib.load(OUT / "calibrator.joblib")
    with open(DATA_ML / "metrics.json", encoding="utf-8") as f:
        metrics = json.load(f)
    payload = clean(build_file(model, seg, metrics, calibrator))
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    bad = forbidden_hits(text)
    if bad:
        raise SystemExit(f"forbidden words in output: {bad}")
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise SystemExit(f"scenarios.json too large: {len(text)} bytes")
    (DATA_ML / "scenarios.json").write_text(text, encoding="utf-8")
    print(f"wrote {DATA_ML / 'scenarios.json'}: {len(text) / 1e6:.2f} MB, "
          f"{len(payload['segments'])} segments, {len(payload['scenarios'])} scenarios")
    for s in payload["scenarios"]:
        top1 = s["top"][0]
        print(f"  {s['id']:>8} risk {s['risk_score']:>4} share {s['share_flooded']:.3f} "
              f"expected {s['expected_share']:.4f} max_p {max(s['p']):.3f} "
              f"top1 {top1['name']!r} p={top1['p']:.3f} extrapolated {s['extrapolated']}")


if __name__ == "__main__":
    main()
