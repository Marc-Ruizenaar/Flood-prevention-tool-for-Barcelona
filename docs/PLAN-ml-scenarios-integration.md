# Plan: scenario planning in the app, backed by the most accurate honest model

Status: **DRAFT, waiting for sign-off.** No code changes, no GitHub branch, no merges until approved.
Date: 2026-10-10. Branch today: `feat/ml-scenarios-intro` (local only, 28 commits, not pushed).

Confidence marks: [verified] checked on this machine today, [likely] reasoned but not tested, [unverified] not checked.

---

## 1. The goal in one paragraph

Ship a "what if" scenario planner inside the app: pick a rain amount and a drainage level, see which
streets are most likely to flood and where to go instead. Behind it sits a machine-learning model that
is as accurate as we can honestly make it, with the accuracy shown in the app. The feature lands as a
new branch on the team repo on GitHub, tested end to end, and is merged only after the team tests it
and Stephany approves.

## 2. Why "more than 75% accuracy" is the wrong target

- If the model says "dry" for every street, it already scores **75.4%**, because most streets stay dry. [verified]
- Our model scores **75.2%**. So 75% means "no better than always saying dry", and 80% could still be nearly useless.
- The number that matters is: **inside one storm, does the model rank the streets that flood above the streets that stay dry?**
  That is the "within-storm AUC" (0.5 = coin flip, 1.0 = perfect). Today it is **0.51 on the heavy day, a coin flip.** [verified]

### New targets (replace "75%")

| Measure (plain English) | Today | Gate A (after quick features) | Gate B (after new storms) |
|---|---|---|---|
| Ranks streets inside the heavy storm (within-storm AUC) | 0.51 | **0.65 or more** | **0.75 or more** |
| Works on a storm it never saw (worst leave-one-storm-out AUC) | 0.51 | not testable with 2 storms | **0.70 or more** |
| Balanced accuracy (flooded and dry streets count equally) | 0.68 | 0.72 or more | 0.78 or more |
| Plain accuracy, compared with always saying dry | 75.2 vs 75.4 | beats it by 3+ points | beats it by 5+ points |
| Real reported problems near the top streets (lift vs random) | 1.55, by luck | measured on IRIS sewer tickets | 1.5 or more on 20+ places, not luck (p below 0.05) |

**Alarm rule:** a within-storm AUC above 0.85 on this data triggers a leakage check before we believe it.
Published city studies reach about 0.87 to 0.90, but with real flood records and easier random splits, so
they are not comparable to our strict test. [likely, from abstracts; full papers blocked]

The trust rules already in `ml/config.py` stay as written (they were fixed before any results).

## 3. Honest framing to keep in mind (pushback)

- **The model copies our physics simulation, not reality.** A high score means "fast, faithful copy of the
  simulation". Only real-world labels (section 5, step 3c) can say whether it matches real floods.
- **The biggest problem is the labels, not the algorithm.** On 3 Oct about 56% of the rain never leaves the
  box because the simulation has closed walls, so about half of all streets look flooded that day. [verified,
  `daily.json`] No new feature can fix bad labels. That is fixed first.
- **The rain number may be wrong.** The rain gauge inside our box (XEMA X4, Raval) recorded **190.8 mm** on
  3 Oct, nearby gauges 170.3 and 140.0 mm. The simulation used **143.4 mm**. [verified, Meteocat open data]
  The 3 Oct rain fell in **two bursts** (10:30 to 14:00 and 17:30 to 23:30), so our "3 hour storm" assumption is wrong. [verified]
  To check: how the solver weights the stations before we change anything.
- Swapping the algorithm (deep learning, XGBoost) will not help until the inputs and labels improve. [likely]

## 4. What we found (3 research agents, 2026-10-10)

### Already in the repo
- Only 2 simulated days exist per street. Other drainage levels exist only as city-wide totals. [verified]
- OpenStreetMap streets file with street type (`backend/manifests/derived/osm/`). [verified]
- The solver's own inputs (5 m official terrain, land cover, buildings, hourly rain) are **not on this machine**. [verified]
- The solver supports open box edges with no code change (`grid.py:76`). [verified]
- The solver refuses real runs until its 8 quality gates are signed off, including Marc's sign-off on the drainage values (G4). [verified, `launch.py:125-128`]

### Free public data that opens without an account [verified access]
| Source | Gives us | Use |
|---|---|---|
| Meteocat XEMA rain gauges (Catalan open data) | 30-minute rain, in-box gauge X4, back to 2006 | Correct rain totals and storm shape; pick historical storms to simulate |
| OpenStreetMap | 12,171 buildings, 572 underpasses, 450 stairways, 774 tunnels, 11,263 trees in the box | Building cover, underpasses (classic water traps) |
| ESA WorldCover 10 m | Built-up vs green land cover | Sealed surface share |
| ICGC land cover (WMS) and LiDAR terrain (25 cm, 2022) | Fine terrain, kerbs, local dips; building heights | Replaces the coarse public terrain |
| Catastro buildings (Barcelona file, 50 MB) | Every building footprint | Building cover, blocked flow |
| Open Data BCN IRIS citizen requests, 2014 to Mar 2026 | Geolocated sewer and drain complaints (about 100 to 150 a year in the box) | **Real-world proxy labels** for historical storms |
| Guardia Urbana "PLUJA TORRENCIAL", Bombers, 112 | Monthly or daily counts, no street location | Find storm days, sanity checks only |

Candidate historical storms (XEMA X4 daily rain): 2017-03-24 (95 mm), 2011-03-15 (94), 2020-04-21 (93),
2018-11-15 (92), 2018-09-06 (91), 2020-01-21 (Gloria), 2019-12-04, 2014-09-28. [verified]

### Not available
- No Copernicus flood mapping for Barcelona. No street-level fire brigade or police flood records with locations.
- No public sewer network or sewer capacity data. ACA flood zone maps (MAPRI) and BCASA flood maps are blocked or PDF only.
- No incident data for the October 2026 storm yet (IRIS publishes about 6 months late).

## 5. The plan, step by step

### Step 0. Rebuild the branch on today's main (S)
Main on GitHub moved 18 commits ahead (CAT / ES / EN language switch, 3D map, resident view, chunked flood
loading). Six of our files were also changed there. [verified]
- Create `feat/ml-scenarios` from the current `origin/main`.
- Re-apply our work on top, resolving the 6 overlapping files by hand: `App.tsx`, `MapCanvas.tsx`,
  `HotspotCard.tsx`, `weather.ts`, `styles.css`, `.gitignore`.
- Move all intro and scenario text into the team's language system (`src/lib/i18n.ts`) in CAT, ES and EN.
- Keep the old local branch untouched as a backup.

### Step 1. Fix the labels and the yardstick (S)
- Drop or down-weight the closed-box ponding on 3 Oct properly (wider edge band, or a "stored water" test), and re-measure.
- Report within-storm AUC for each day as the headline number, beside the pooled one.
- Add a simple terrain-only baseline (height above nearest drainage) that every new model must beat.

### Step 2. Quick features, no accounts needed (S to M) -> Gate A
For each street segment, add:
- building cover within 25 m and 50 m (OpenStreetMap, then Catastro)
- underpass, tunnel and stairway nearby (OpenStreetMap)
- street type (OpenStreetMap file already in the repo)
- sealed vs green share (ESA WorldCover, ICGC land cover)
- terrain at several scales: how much lower the street is than everything within 100, 250 and 500 m
Each group is kept **only if** it raises within-storm AUC under spatial cross-validation. Results logged per group.

### Step 3. Better rain and real-world labels (M)
- a. Use XEMA 30-minute rain for the true storm totals and shape. Replace the fixed "3 hours" with the measured storm shape.
- b. Swap the coarse public terrain for ICGC fine terrain (read only the small window around the box).
- c. Build a **real-world check** from IRIS sewer and drain tickets on the historical storm days, counted per street.
  Privacy: we keep only counts per street per day, drop the free text and addresses, store nothing personal. [GDPR, aggregate only]

### Step 4. More simulated storms (L) -> Gate B
This is what unlocks trust "medium" and a real rain slider (today the model only knows "light" and "heavy").
- Download the solver inputs listed in `backend/manifests/datasets.json` (terrain, land cover, buildings, rain).
- **Needs from Marc:** the quality gates file and sign-off on the drainage values (G4).
- Run a 1-hour timing test first.
- Simulate 5 to 10 historical storms from section 4, with **open box edges**, at drainage none / low / mid / high.
- Retrain on all of them. Then the leave-one-storm-out test becomes meaningful.

### Step 5. Put it in the app (S to M, runs alongside steps 1 to 4)
- **How the model runs:** the model is trained offline and exports `data/ml/scenarios.json`. The app reads that file.
  No model runs in the browser and no server is needed, so the app stays a static site and stays fast. [verified, current design]
- The scenario planner shows: city risk score, top areas with "where to go", trust level with reasons,
  the within-storm score, and an "outside what the model learned" warning.
- **Promotion gate:** a new model replaces the current file only if it beats the current one on the
  section 2 measures. A model card (version, date, data, scores) is shipped with it.
- When step 4 adds storms, the rain and drainage choices grow from 5 x 3 to a finer grid.
- All text in CAT, ES and EN. Same honesty rules: no weather-prediction wording.

### Step 6. Test and check before anything leaves this machine
- Python model tests (`pytest ml/tests`), node tests, `npm run qa`, `npm run build` (type check), signals and city-actions checks.
- New tests: label cleaning, each new feature, the promotion gate, the language strings.
- Browser click-through on localhost: keyboard only, Escape key, focus order, phone width 390 px,
  reduced motion, all 3 languages, the team's 3D map and resident view still work.
- Independent review pass (`/code-review`) before each commit.

### Step 7. GitHub (only after Stephany confirms)
- Push `feat/ml-scenarios` as a **new branch** on `Marc-Ruizenaar/hackathon-barcelona`.
- Optional: open a **draft** pull request so the team can see and test it. No merge.
- Merge into main only after the team tests it and Stephany approves.

## 6. Also delivered
- **Colab notebook** `ml/notebooks/flood_model_colab.ipynb` (not committed yet): maps, error matrix, accuracy
  charts, scenario picker, real-world check, and a sandbox to test new features. Runs with zero errors in about
  1 minute and reproduces `metrics.json` exactly (accuracy 0.7523, balanced 0.6827, AUC 0.8268, same error matrix). [verified]
- Local app for UI iteration: http://127.0.0.1:5173 (still the pre-rebuild version).
- Small fix for step 0: the dev server watches `ml/.venv` and reloads the page when Python files change.
  Add `ml/**` to the Vite watch ignore list.

## 7. Decisions needed from Stephany
1. Approve steps 0 to 3 now? (no accounts needed, no outside sign-off)
2. Step 4 needs Marc: OK to ask him for the quality gates file and the drainage sign-off (G4)?
3. OK to use IRIS citizen requests as real-world labels, counted per street only, nothing personal kept?
4. GitHub: new branch only, or new branch plus a draft pull request?
