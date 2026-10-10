# ML scenarios data contract

This document defines the JSON file that the ML pipeline (`ml/`) writes and the intro screen (`src/components/IntroScan.tsx`) reads. Both sides must match it exactly.

- **File:** `data/ml/scenarios.json`. `scripts/copy-data.mjs` copies all of `data/` into `public/data/`, so the app fetches it from `data/ml/scenarios.json`.
- **Audience:** the developers working on `ml/` and on the frontend.
- Last updated: 2026-10-10.

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

type ScenariosFile = {
  version: 1;
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
  };
  metrics: {
    spatial_cv: ClassMetrics;               // 500 m blocks, out of fold, both days
    leave_one_storm_out: {
      train_2026_10_02_test_2026_10_03: ClassMetrics;
      train_2026_10_03_test_2026_10_02: ClassMetrics;
    };
    real_world: RealWorldCheck[];           // 150 m and 300 m
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
    risk_score: number;         // 0..10, one decimal
    share_flooded: number;      // share of segments with p >= threshold
    p: number[];                // per segment, same order as `segments`, 3 decimals
    top: { rank: number; segment_index: number; name: string; lon: number; lat: number; p: number }[]; // top 10, spread >= 200 m apart
  }[];
};
```

## Rules

- **No NaN or Infinity anywhere.** Use `null` instead.
- **No forecast wording** in any string. These phrases fail `npm run qa`: "will rain", "mm expected", "forecast", "guaranteed flood", "€".
- **The `p` array always has the same length as `segments`.**
