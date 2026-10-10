# ML scenarios data contract

This document defines the JSON file that the ML pipeline (`ml/`) writes and the intro screen (`src/components/IntroScan.tsx`) reads. Both sides must match it exactly.

- **File:** `data/ml/scenarios.json`. `scripts/copy-data.mjs` copies all of `data/` into `public/data/`, so the app fetches it from `data/ml/scenarios.json`.
- **Audience:** the developers working on `ml/` and on the frontend.
- Last updated: 2026-10-10. Version 2 adds calibration (see "Version 2" below).

## Shape

```typescript
type TrustLevel = "low" | "medium" | "high";

type Confusion = { tp: number; fp: number; fn: number; tn: number };

type ClassMetrics = {
  n: number;
  threshold: number;            // probability cut used for the matrix
  confusion: Confusion;
  accuracy: number;             // 0..1
  baseline_accuracy: number;    // accuracy of always predicting the majority class ("always dry")
  balanced_accuracy: number;
  precision: number;            // NaN is not allowed in JSON: use null when undefined
  recall: number;
  f1: number;
  roc_auc: number | null;
  brier: number;
  calibration: { bin: [number, number]; mean_predicted: number; observed_rate: number; n: number }[];
};

type RealWorldCheck = {
  n_points: number;             // reported places inside the model box (RESCCUE + T10 + proof)
  radius_m: number;             // 150 or 300
  hits: number;                 // points within radius_m of a top-10 predicted area
  hit_rate: number;
  random_rate: number;          // same test for 3000 random points inside the box, seed 42
  lift: number | null;          // hit_rate / random_rate
};

type ReliabilityBin = {
  from: number;                 // bin start, 0..1
  to: number;                   // bin end. Five equal-width bins; the last one includes 1.0
  predicted_mean: number | null; // average p in the bin, null when the bin is empty
  observed_rate: number | null;  // share of those streets that flooded in the simulation, null when empty
  n: number;                    // streets in the bin
};

type Reliability = {            // v2. Measured with nested spatial CV, see below
  bins: ReliabilityBin[];       // calibrated p
  bins_raw: ReliabilityBin[];   // the model's raw score, before calibration
  brier_before: number;         // raw score
  brier_after: number;          // calibrated p, nested
  at_70: ReliabilityBin | null; // the 0.6 to 0.8 bin, or null when it has no streets
  sentence: string;             // plain English, e.g. "When the model says 71%, the simulation flooded 67% of the time (21 streets)."
};

type Calibration = {            // v2
  method: "isotonic";
  fitted_on: "spatial out-of-fold predictions";
  n: number;                    // rows the calibrator was fitted on
  note: string;                 // "Percentages mean: share of comparable streets that flooded in the physics simulation for that rain. Not yet checked against real floods."
  min_step_rows?: number;       // 30: no calibrated level rests on fewer out-of-fold rows
  n_steps?: number;
  max_p?: number;               // the highest calibrated level the map can output
  steps?: { to_raw: number | null; p: number; n: number }[];   // the step table, p rising, n >= 30
  bands?: { medium: number; high: number };   // 0.3 and 0.6, same cuts as riskWord() in scenarioUi.ts
};

type ScenariosFile = {
  version: 1 | 2;               // the writer now emits 2; readers must accept 1 as well
  kind: "ml_scenario";
  caveat: string;               // "Prototype trained on 2 simulated storms. Shows susceptibility under a what-if scenario, not a prediction of real weather."
  generated_at: string;         // ISO time
  model: {
    type: string;               // e.g. "HistGradientBoostingClassifier"
    features: string[];
    feature_importance: { feature: string; importance: number }[];
    label_definition: string;   // e.g. "simulated max depth >= 0.15 m (moderate or worse)"
    trained_storms: number;     // 2 today
    trained_rain_mm: [number, number];
    secondary_labels: string;   // MAPRI status, e.g. "not obtained: <reason>"
    excluded_rows: string;      // e.g. "edge-ponded segments on 2026-10-03 (n=...)"
    calibration?: Calibration;  // v2 only
  };
  metrics: {
    spatial_cv: ClassMetrics;               // 500 m blocks, out of fold, both days
    leave_one_storm_out: {
      train_2026_10_02_test_2026_10_03: ClassMetrics;
      train_2026_10_03_test_2026_10_02: ClassMetrics;
    };
    real_world: RealWorldCheck[];           // 150 m and 300 m
    reliability?: Reliability;              // v2 only
    calibrated_confusion?: ClassMetrics;    // v2 only: matrix at `threshold` on the nested calibrated p (its `calibration` list is empty, use reliability.bins)
  };
  trust: {
    level: TrustLevel;
    rules: { rule: string; passed: boolean; value: number | string | null }[];
    reasons: string[];          // plain English, one per failed rule
  };
  improvements: string[];       // ranked, plain English
  segments: { id: string; name: string; lon: number; lat: number; elev_m: number }[];
  scenarios: {
    id: string;                 // e.g. "r50_d20"
    rain_mm: number;            // 25 | 50 | 75 | 100 | 143
    drainage_mm_h: number;      // 10 | 20 | 30
    extrapolated: boolean;      // true outside the trained rain range
    risk_score: number;         // 0..10, one decimal: 10 x the mean of p
    share_flooded: number;      // share of segments with p >= threshold (computed from the rounded p). Fragile, see below
    expected_share?: number;    // mean p over all segments, 4 decimals. The UI should prefer this to share_flooded
    p: number[];                // per segment, same order as `segments`, 3 decimals. v2: calibrated, so 0.7 means about 70% of comparable streets flooded in the simulation
    top: { rank: number; segment_index: number; name: string; lon: number; lat: number; p: number }[]; // top 10, spread >= 200 m apart
  }[];
};
```

## Rules

- **No NaN or Infinity anywhere.** Use `null` instead.
- **No forecast wording** in any string. These phrases fail `npm run qa`: "will rain", "mm expected", "forecast", "guaranteed flood", "€".
- **The `p` array always has the same length as `segments`.**
- **Readers accept version 1 and 2.** In v1, `p` is a ranking score, not a probability, and `calibration`, `reliability` and `calibrated_confusion` are absent. A v2 file that carries `reliability` must have the full shape above, or the reader rejects the whole file.

## Version 2: what changed and how it was measured

- **`p` is calibrated.** An isotonic regression (`ml/out/calibrator.joblib`) maps the model's raw score to the share of streets that flooded in the simulation at that score. It is fitted on the spatial out-of-fold predictions (the score each street got from a model that never saw its 500 m block). **Minimum step size:** no calibrated level may rest on fewer than 30 out-of-fold rows. Small steps are pooled into their neighbour (weighted mean observed rate) until every step has at least 30 rows, so the map can no longer say "100%" from a handful of streets. The shipped map has 10 steps, the highest is 0.706 (34 rows), stored in `model.calibration.steps`. The same pooled map is used in the nested measurement below.
- **What the percentage means.** "70%" means: of comparable streets (same score), about 70% flooded in the physics simulation for that rain. It is not a chance of real flooding. This is stored in `model.calibration.note`.
- **How `reliability` is measured (nested spatial CV).** For each of the 5 spatial folds, fit the calibrator on the out-of-fold scores of the other 4 folds, apply it to the held-out fold, then pool all folds. So no street is calibrated by a map that saw its own label. The shipped calibrator is fitted on all folds. Small caveat: the other folds' scores came from models trained on rows of the held-out fold, so a little second-order leakage remains.
- **Isotonic output is a staircase.** Many streets share the same `p`. Ties in the `top` lists are broken by the raw model score, so the order of the top areas is still meaningful.
- **Risk bands.** `model.calibration.bands = {"medium": 0.3, "high": 0.6}`, matching `riskWord` in `src/lib/scenarioUi.ts`. When present, `areasAtRisk` counts top areas with p at least `bands.medium`, and `whereToGo` only suggests streets with p under `bands.medium`. Without `bands` (v1, or an older v2 file) both fall back to `metrics.spatial_cv.threshold`. The threshold, the headline matrix and `calibrated_confusion` are unchanged.
- **`expected_share`.** The mean calibrated p over all segments (4 decimals): the expected share of streets that flood in the simulation. The UI should prefer it to `share_flooded`, which flips with the 0.5 cut. Optional in the reader; when present it must be a finite number in 0 to 1. For drainage 20: 0.0180 (25, 50, 75, 100 mm) and 0.4672 (143 mm).
- **`p` can sit on a plateau.** On the current data most streets in a heavy scenario get `p` of 0.499, which is just under the 0.5 threshold. `share_flooded` and `areasAtRisk` read the threshold from `metrics.spatial_cv.threshold`, so they are sensitive to that. Treat the exact count with care.
- **Small bins.** Check `n` before quoting a bin. In the nested measurement the 0.6 to 0.8 bin holds 4 streets and the 0.8 to 1.0 bin none, so the model almost never says a high number. The 0.4 to 0.6 bin (2012 streets) is well calibrated: said 49%, flooded 49%.
