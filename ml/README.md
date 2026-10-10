# Flood susceptibility prototype (ml/)

A small machine-learning model that learns which Barcelona street segments flood in our own
physics simulation, then answers what-if questions: "how would the streets look under 75 mm of
rain with weaker drains?". It shows **susceptibility under a what-if scenario**. It does not
predict real weather and it does not predict real floods.

**Trust level today: low.** The numbers below say why.

## Run it

From the repo root (Windows, Git Bash or PowerShell):

```
python -m venv ml/.venv
ml/.venv/Scripts/python -m pip install -r ml/requirements.txt
ml/.venv/Scripts/python ml/run_all.py
```

`run_all.py` runs these four steps in order. You can also run them one by one:

```
ml/.venv/Scripts/python ml/build_dataset.py       # terrain features + labels -> ml/out/dataset.csv
ml/.venv/Scripts/python ml/train.py               # train, evaluate, trust -> data/ml/metrics.json
ml/.venv/Scripts/python ml/predict_scenarios.py   # 15 what-if scenarios -> data/ml/scenarios.json
ml/.venv/Scripts/python -m pytest ml/tests -q     # tests
```

The first run downloads about 20 public terrain tiles (AWS Terrarium, no key) into `ml/out/tiles/`.
Later runs reuse them. Everything in `ml/out/` and `ml/.venv/` is git-ignored. The two JSON files
in `data/ml/` are committed. Their shape is defined in `docs/ml-scenarios-contract.md`.

## What the model learns from

One row per street segment and storm (2,224 segments x 2 storms).

- **Terrain features** (from the public AWS Terrarium DEM, zoom 15, about 3.6 m pixels, resampled
  to 7.2 m and smoothed over about 36 m): elevation, slope, flow accumulation (D8, log), wetness
  index (TWI), depression depth (priority-flood fill), distance to the buried streams, distance to the sea.
- **Storm feature:** `excess_rain_mm = max(0, rain - drainage x storm_hours)`.
  `drainage` is 20 mm/h in the simulation. `storm_hours` is **3**. We took it from the solver ledger
  of 3 October (61 mm drained at 20 mm/h is about 3.05 h), rounded, and fixed it before training.
  The daily files have no hourly rain, so the real storm length is unknown.
  This gives 0 mm for 2 October (15.5 mm of rain) and 83.4 mm for 3 October (143.4 mm of rain).
- The segment id and the coordinates are **not** features.

**Label:** 1 if the simulated maximum depth is at least 0.15 m (moderate or worse), else 0.
Threshold for turning a probability into a yes/no: 0.5.

**Excluded rows:** 40 segments on 3 October with depth above 1 m and within 400 m of the box edge.
The physics model has closed edges, so water piles up against the wall. That is an artefact, not a flood.
The count is stored in `model.excluded_rows`.

## How the numbers are computed

- **Spatial cross-validation:** the area is cut into 500 m squares. `GroupKFold` (5 folds) keeps all
  rows of a square together, so a segment is never in train and test at the same time. Every row gets
  an out-of-fold probability. The spatial CV rows of the results table come from those. The leave one
  storm out and real-world rows use their own tests, described next.
- **Leave one storm out (both directions):** train on one day, test on the other.
- **Metrics:** confusion matrix, accuracy, baseline accuracy (always predict the majority class),
  balanced accuracy, precision, recall, F1, ROC AUC (null if one class only), Brier score,
  5-bin calibration.
- **Real-world check:** take the 10 most susceptible segments for the 143.4 mm / 20 mm/h scenario, at
  least 200 m apart. Count how many reported places (RESCCUE hotspots, sewer T10 stress,
  the October 2026 proof point) fall within 150 m and 300 m of them. Compare with 3,000 random
  points in the same box (seed 42). Lift is hit rate divided by random rate. The random points are
  spread evenly over the box, including parks and the sea edge, while the model's picks sit on streets.
  That can make the lift look a little better than it is.
- **Trust rules** are constants in `config.py`, written before the results, never tuned.
  High needs: worst leave-one-storm-out AUC at least 0.8, lift at 300 m above 1.5 with at least
  20 reported places, and at least 5 trained storms.
  Medium needs: spatial AUC at least 0.75, worst leave-one-storm-out AUC at least 0.65, and at least 3 storms.
  Otherwise low. Every rule is listed in `trust.rules`, and every failed rule has a plain reason.
  Note: the spatial AUC rule for medium passes today (0.83), but only because the model tells the two
  storms apart, not because it ranks streets well. The rule was fixed before the results, so it stays
  as written. Trust is still low because the other rules fail.
- **p is calibrated** (see "Calibration" below). It is rounded to 3 decimals first. Everything below is
  computed from the rounded p, so the file agrees with itself.
- **risk_score** (0 to 10, one decimal) = 10 x the average p over all segments.
- **share_flooded** = share of segments with p at least 0.5. Fragile: the big plateau sits at 0.499.
- **expected_share** = mean p over all segments, 4 decimals. The UI should prefer this to `share_flooded`.
- **top** = the 10 highest-p segments at least 200 m apart. Calibrated p has many ties, so ties are
  broken by the raw model score. The 40 edge-ponding segments excluded
  from training are still scored, but never picked for the top list.
- **extrapolated** = rain outside the trained range (15.5 to 143.4 mm) or drainage different from 20 mm/h.

## Calibration

The raw model score ranks streets but is not a probability: in the raw 80 to 100% bin only 48% of streets
flooded in the simulation. The app shows p as "72% chance", so p must be calibrated.

- **Fit:** `IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1)` on the spatial out-of-fold
  scores against the labels, then **pooled**: no step may rest on fewer than 30 out-of-fold rows
  (`MIN_STEP_ROWS`). The smallest under-sized step is merged into the neighbour with the closer observed
  rate (weighted mean) until all steps have 30 rows or more. The result has 10 steps, listed in
  `model.calibration.steps`. The same pooled map is used in the nested measurement. Saved as `ml/out/calibrator.joblib` (git-ignored, rebuilt by `train.py`).
  `predict_scenarios.py` applies it to every scenario and sets `version: 2`.
- **Meaning:** "70%" = about 70% of comparable streets flooded in the physics simulation for that rain.
  Not a chance of real flooding (that is not checked yet). Stored in `model.calibration.note`.
- **Honest measurement (nested spatial CV):** for each of the 5 spatial folds, fit on the other 4 folds'
  out-of-fold scores, apply to the held-out fold, pool. Written to `metrics.reliability`
  (`bins`, `bins_raw`, `brier_before`, `brier_after`, `at_70`, `sentence`) and
  `metrics.calibrated_confusion`. A little second-order leakage remains: the other folds' scores came
  from models that trained on the held-out fold's rows.
- **Result (current run), nested:**

| p bin | Raw: said / flooded / n | Calibrated: said / flooded / n |
| --- | --- | --- |
| 0 to 20% | 2% / 3% / 2,290 | 1% / 1% / 2,197 |
| 20 to 40% | 31% / 44% / 532 | 33% / 32% / 195 |
| 40 to 60% | 50% / 52% / 819 | 49% / 49% / 2,012 |
| 60 to 80% | 69% / 48% / 668 | 68% / 75% / 4 |
| 80 to 100% | 83% / 48% / 99 | none / none / 0 |

  Brier score 0.144 before, 0.132 after. The middle bins are now well calibrated.
- **What calibration cannot fix.** The model separates the light storm from the heavy one, and little else
  (AUC 0.51 inside the heavy storm). So calibration does not create high-confidence streets. It moves
  almost every street in a heavy scenario onto a plateau of about 50% (1,312 of 2,224 streets sit at 0.499).
  With the 30-row rule the highest level the map can output is 0.706 (34 rows), so there is no more
  "100%" from a handful of streets. The nested 60 to 80% bin holds only 4 streets and the 80 to 100% bin
  none, so the model almost never says a high number. `improvements` says so.
- **Threshold 0.5 after calibration.** It still defines the confusion matrix, but it is fragile: the big
  plateau is at 0.499, just under it. At 0.5 the calibrated matrix has recall 0.27 (raw: 0.55) and
  `share_flooded` in the heavy scenario is 1.7% (`expected_share` is 0.467). A cut of 0.49 would give 61%. The headline metrics were not
  changed. See `metrics.calibrated_confusion` for the matrix at 0.5 on calibrated p.
- **Risk bands.** `model.calibration.bands = {medium: 0.3, high: 0.6}`, the same cuts as `riskWord` in the
  app. When present, `areasAtRisk` counts top areas with p at least 0.3 and `whereToGo` only suggests
  streets under 0.3. Without bands both use the 0.5 threshold, as before.

## Results (current run)

| Check | Result |
| --- | --- |
| Spatial CV accuracy / always-dry baseline | 0.752 / 0.754 (no better than guessing) |
| Spatial CV balanced accuracy, precision, recall | 0.683, 0.497, 0.546 |
| Spatial CV AUC, Brier | 0.827, 0.144 |
| Within the heavy storm only, AUC | 0.51 (chance) |
| Within the light storm only, AUC | 0.84 (but only 24 flooded streets) |
| Train 2 Oct, test 3 Oct | AUC 0.507, recall 0.015 |
| Train 3 Oct, test 2 Oct | AUC 0.743, precision 0.020 |
| Real-world hits at 150 m | 0 of 10 (random 6.7%) |
| Real-world hits at 300 m | 3 of 10 (random 19.4%), lift 1.55 |

The 0.83 spatial AUC mostly comes from telling the two storms apart (the storm feature carries 96%
of the importance). Ranking streets inside the heavy storm by terrain is at chance. The lift of 1.55
rests on 3 hits out of 10 places and is not statistically meaningful: with a 19.4% random rate, 3 or
more hits out of 10 happens by luck about 30% of the time.

### Why terrain alone is at chance (checked, not a feature bug)

- Feature values are plausible: elevation 15 to 100 m across the box, slope 0.2 to 22%.
- The simulated depths are spatially coherent: a segment's depth correlates with its 5 nearest
  neighbours (Spearman 0.54 on 2 Oct, 0.57 on 3 Oct, versus 0.00 when shuffled). So the labels
  contain a real street pattern, not noise.
- But no single terrain feature tracks depth inside a storm (every Spearman |rho| is below 0.2 on both days).
  On the light day, low and near-sea streets do flood more (single-feature AUC 0.86 to 0.88), but
  only 24 segments are positive that day.
- The two days agree on the flooded/dry label for only 52% of segments.
- Likely cause **[likely, not tested]**: the solver runs on the 5 m official DEM aggregated to 30 m cells,
  plus roof cover, surface roughness (Manning n) and soil infiltration layers
  (`backend/src/bcnflood/solver/bcn_inputs.py`). This model only sees the shape of the public terrain.
  The next step is to give it the solver's own input layers as features.

## Limits you must know

- **Only 2 storms**, one heavy and one light. The model has two values of `excess_rain_mm` (0 and 83.4),
  so it learns a single step. Scenarios between 25 and 100 mm at 20 mm/h all behave like the light day,
  and 143.4 mm behaves like the heavy day. They are not flagged `extrapolated` (the rain is inside the
  trained range), but they give identical results. It cannot interpolate between storm sizes.
- **Drainage was never varied.** The drainage effect comes from the `excess_rain_mm` formula, which is an
  assumption, not something the model learned. All scenarios with drainage other than 20 mm/h are flagged `extrapolated`.
- **The labels come from our own physics model, not from reality.** The model is a surrogate of that
  solver, including its flaws. A good score would only mean it copies the solver.
- **The 3 October labels still contain closed-box ponding** beyond the 40 excluded rows. About half of
  all segments are labelled flooded that day.
- **About 10 reported places** fall inside the box. That is too few for a reliable real-world check.
- No rain intensity data (peak rate), only daily totals.

## Secondary labels (MAPRI flood zones)

Not obtained. The Generalitat map server (sig.gencat.cat) answers non-browser clients with
`UserAgentFilterError` (HTTP 403), and the layer names cannot be read without the capabilities
document. I did not try to disguise the client to get around that. A manual download of the MAPRI T10/T100/T500
layers would be the way in.

## What would improve it, in order

1. More solver storms (at least 5, different totals, open box edges).
2. Real incident labels: Bombers de Barcelona and Guardia Urbana callouts, or the 112 log.
3. The BCASA pluvial flood map as vector data.
4. Per-section sewer capacity.
5. A finer terrain model (ICGC 2 m).
6. Several drainage levels in the simulation.
7. The solver's own input layers as features (its DEM, roof cover, Manning n, infiltration).

The full ranked list, including items that came out of these results, is in `data/ml/metrics.json`
under `improvements`.

## Files

| File | Job |
| --- | --- |
| `config.py` | all constants, trust rules, caveat |
| `geo.py` | local metric plane, blocks, greedy top-N |
| `terrain.py` | DEM download, slope, flow accumulation, TWI, depressions |
| `build_dataset.py` | features + labels + test points |
| `train.py`, `evaluate.py` | model, metrics, trust, improvements |
| `predict_scenarios.py` | what-if scoring and `scenarios.json` |
| `tests/test_pipeline.py` | pytest checks |
