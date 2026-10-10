# Spec: intro screen, scenario planner, calibrated likelihood

Status: approved to build by Stephany on 2026-10-10 ("Start working on that"). Local branch `feat/ml-scenarios` only.
Nothing is pushed, merged or deployed until she confirms.

Three screens:
1. **Intro** (new): a floating 3D Barcelona, alerts on the map, a Start button that swoops into the app.
2. **The app** (the team's existing map): kept as it is. It only gains one round button and one panel.
3. **Scenario planner** (new): a glass card on top of the app for "what if this much rain fell here".

---

## 0. Rules for every screen

- **Colours.** Use only the app's own tokens from `src/styles.css`: ink `#142028`, cream `#f6f1e7`,
  cream-2 `#ebe4d6`, muted `#5c5348`, and the line and shadow tokens. Frosted glass is
  `rgba(246, 241, 231, 0.62)` with `backdrop-filter: blur(18px) saturate(140%)` and a 1px
  `rgba(255, 255, 255, 0.55)` border. Dark glass is `rgba(20, 32, 40, 0.86)`.
  Vermilion `#c2410c` is used **only** for a high-likelihood value. **No blue anywhere.**
  Text on glass must reach AA contrast (4.5:1). Check it against the lightest map pixel behind the glass.
- **Fonts.** Use the app's fonts: Outfit for the UI and Fraunces only for the big numbers.
- **Little text.** Each card has at most 1 line of explanation. Numbers and labels, not paragraphs.
  Longer explanations go in an "i" sheet that opens on tap.
- **Likelihood, not "low confidence".** Every prediction is shown as a percentage, like a weather app:
  "72%" with the label "chance of street flooding". The trust explanation is shown **once**,
  behind a small "How sure?" chip, never on every prediction (see section 4).
- **Copy rules.** No em-dashes. None of the words `forecast`, `will rain`, `mm expected`, `guaranteed flood`, and no euro sign.
  Scenarios are worded "If 75 mm fell", never "75 mm is coming".
- **Languages.** All copy goes through `t()` from `src/lib/i18n.ts` with CAT and ES entries.
  Intro strings go under the `// Intro (ca)` and `// Intro (es)` comments.
  Planner strings go under the `// Scenario planner (ca)` and `// Scenario planner (es)` comments.
- **Accessibility.**
  - Every control is a real `<button>` or `<input>` with a visible or `aria-label` name.
  - Tab order follows the visual order, focus rings are visible, and Escape closes the top layer.
  - `prefers-reduced-motion` swaps every animation and camera flight for an instant cut or a fade.
  - Touch targets are at least 44px.
- **Phone first.** It must work at 390px wide with no horizontal scroll.
- **TypeScript.** No `any`, strict mode, no new runtime dependencies.

## 1. Screen 1: intro (`src/components/IntroScreen.tsx` + `src/intro.css`)

Shown at `/` on first visit in a browser session. It is skipped with `?intro=0`, and after the user presses Start
(`sessionStorage` key `introSeen`, wrapped in try/catch). `?intro=1` always shows it, which is useful for the
demo presentation. `/citizen` never shows it. It is mounted from `src/main.tsx` in front of `<App />`.
The app mounts underneath at the same time, so the map is ready when the intro ends.

**Layout**
- **Background.** Cream `#f6f1e7` with a very faint noise texture (an inline SVG `feTurbulence` at 4% opacity, no image file).
- **Map.** A floating 3D map card sits in the centre.
  - Size: about 86vw x 62vh on desktop and 92vw x 56vh on phone.
  - Shape: 28px radius, with a soft long shadow `0 40px 80px -20px rgba(20,32,40,.35)` and a blurred ellipse shadow under it.
  - It is its own maplibre map, so the app's MapCanvas is untouched:
    - basemap: `https://tiles.openfreemap.org/styles/positron`
    - terrain: the ICGC terrain-RGB tiles the app already uses (see `MapCanvas.tsx`), with `setTerrain` exaggeration 1.6 and hillshade in warm earth tones
    - 3D buildings: `fill-extrusion` from the basemap `building` layer, warm grey `#d9d2c3`, with parks in muted green
    - camera: pitch 55, bearing -20, around Eixample and Ciutat Vella
    - controls: drag to pan, right-drag or two fingers to rotate and tilt
- **Top centre: pill group** "Explore", "Alerts", "Plan".
  - The active pill is solid ink with cream text. Inactive pills are frosted glass with ink text.
  - Explore: free 3D exploring, with nodes at the top places.
  - Alerts: the same nodes pulse one by one, highest likelihood first.
  - Plan: Start opens the app with the scenario planner already open.
- **Right edge of the map: round dark controls** (44px, ink, cream icons): zoom in, zoom out, tilt (2D/3D), rotate 45 degrees, reset.
- **Nodes.** Translucent glass circles hover over the top 6 places of the heavy scenario (`r143_d20`) in `scenarios.json`.
  - Each one is 34px, frosted cream, with a thin ink ring and a small ink dot.
  - Each is an HTML maplibre `Marker` containing a `<button>`, so keyboard and screen readers can reach it.
- **Node card (two tiers).** It springs out of the node when the node is tapped.
  - Animation: CSS `transform: scale` from the node position, cubic-bezier(.34,1.56,.64,1), 380ms.
  - **Top tier:** a frosted panel over a small non-interactive maplibre view of that place (pitch 60, zoom 16.5, same style). It has a round X close button.
  - **Bottom tier:** dark glass with cream text:
    - place name
    - big **likelihood %** (calibrated `p` x 100, rounded)
    - label "chance of street flooding if 143 mm fell"
    - a risk word: High at 60% or more, Medium at 30 to 59%, Low below 30%
    - one "Where to go" line from `whereToGo()` / `adviceText()` in `src/lib/scenarios.ts`
  - Only one card is open at a time. Escape or X closes it and returns focus to its node.
- **Bottom centre: a big "Start" button.** It is a solid ink pill with cream text, 56px tall.
- **Start sequence:**
  1. The pills, controls, nodes and card fade out and scale down slightly (250ms).
  2. The intro camera `flyTo` swoops to street level over the top place (zoom 17.5, pitch 70, 1600ms).
  3. The whole intro layer fades out (300ms) and unmounts, which reveals the app.
  4. Focus moves to the app's first heading.
- **Reduced motion:** no swoop and no spring. Start does an instant 200ms fade.
- **If WebGL or the tiles fail,** the cream canvas still shows the pills, a list of the top places as cards, and Start.

## 2. Screen 2: the app (existing)

It is not redesigned. The changes are:
- A new round **target** button at the top of `.map-buttons`, with `aria-label` "Scenario planning".
  It opens the planner. Its look matches the existing round buttons.
- **Past / Today (from the sketch):** the app already has the day switch in the top bar and the live "Today" tab in the weather panel.
  A second Past/Today control on the map would duplicate them, so it is **not added now**.
  If the team wants the sketch look, restyling the existing day switch as pills is a small follow-up.
- The existing weather (cloud) and about (i) buttons already match the sketch's cloud and "!" buttons. Recenter already exists.
- The hotspot popup gains the edge-ponding badge from `src/lib/artefacts.ts`, with "> 1 m (upper bound)" on the depth row (all strings through `t()`).

## 3. Screen 3: scenario planner (`src/components/ScenarioPanel.tsx` + `src/scenario.css`)

A glass card styled after the reference phone screen. On desktop it is a 380px card floating on the right, below the map buttons.
On phone it is a bottom sheet up to 82vh tall that scrolls inside itself. It opens from the target button and closes with X or Escape.

From top to bottom:
1. **Header row.** On the left, a small "Scenario" kicker and the chosen date in Fraunces (e.g. "Wed, 14 Oct").
   On the right, the **likelihood ring**:
   - a 72px SVG ring filled to the likelihood %, with the % number in its centre
   - the caption "chance of street flooding"
   - the ring stroke is ink, or vermilion at 60% or more
   - with no place chosen it shows the share of the city's streets above 50%, captioned "of streets at risk"
2. **Focus card** (white `#fffdf8`, 22px radius):
   - the chosen place name in bold, with one muted line: "If {mm} mm fell · drains {weak|normal|strong}"
   - a black **"Start simulation"** pill, which does two things:
     - (a) colours the map with this scenario, using `MapHandle.showScenario` (see below)
     - (b) flies to the place and shows numbered glass rings on its top 5 nearby risk spots
   - once running, the pill becomes "Stop simulation", which removes the layer
3. **Parameters row** (from "Change simulation parameters"):
   - **Rain:** chips 25 / 50 / 75 / 100 mm and a "Heavier rain" chip (143 mm). The chips are a radio group.
   - **Drains:** a three-way segmented control, Weak (10 mm/h) / Normal (20) / Strong (30). Normal is the default.
   - A scenario outside what the model learned (`extrapolated`) shows a small dashed-outline chip "Outside training range". No paragraph.
4. **Day strip** (from "Date of the week"): M T W T F S S for the current week, today highlighted.
   - Choosing a day sets the header date.
   - If `gauges` (already in App) has a measured reading for that day, the strip shows the measured mm under the day.
     Pressing "Use measured rain" picks the nearest rain chip.
   - Future days show no number. The user picks the rain. Nothing is shown as a prediction.
5. **"Select location" pill input** at the bottom, frosted, with a pin icon. It is a combobox (`role="combobox"`, listbox of up to 8 matches):
   - searches street names in `scenarios.json` segments and the zone names
   - choosing one sets the place, and the ring shows that place's likelihood (nearest segment's calibrated `p`)
   - "Use map centre" is the first option
6. **"How sure?" chip** (small, muted, under the ring). It opens a tiny sheet with three lines, filled from `metrics.reliability` (section 4):
   - "When the model says 70%, the simulation flooded {x}% of the time."
   - "Tested on {n} street segments it never saw."
   - "Trained on {k} simulated storms. More storms make these numbers firmer."

**Map layer.** `MapHandle.showScenario({ points, threshold })` and `clearScenario()` are added to `MapCanvas.tsx`:
- a GeoJSON circle layer `ml-scenario` over the segments
- circle radius 3 to 7 by zoom, colour on an ink-to-vermilion ramp by `p`, opacity 0.85
- inserted above the flood layers and below labels

`MapHandle.project(lngLat)` is also added (for the rings). `pad()` is not changed. The panel is outside the rail.

## 4. The likelihood % has to be honest (ML change)

Today the model's `p` is a ranking score, not a chance. In its top bin it says 80 to 100%, but only 48% of those streets flood.
Showing "85%" from that would be false. The fix:

- Fit an **isotonic calibration** on the spatial out-of-fold predictions in `ml/train.py`, so a street never calibrates on itself.
  Apply it to every scenario's `p` in `ml/predict_scenarios.py`.
- Add to `scenarios.json` and `metrics.json`:
  ```json
  "model": { "calibration": { "method": "isotonic", "fitted_on": "spatial out-of-fold predictions", "n": 4408 } },
  "metrics": { "reliability": {
    "bins": [ { "from": 0.0, "to": 0.2, "predicted_mean": 0.07, "observed_rate": 0.06, "n": 2100 } ],
    "brier_before": 0.144, "brier_after": 0.13,
    "at_70": { "predicted_mean": 0.71, "observed_rate": 0.69, "n": 310 }
  } }
  ```
  - `bins` holds 5 equal-width bins measured on held-out folds (a calibrator fitted inside each fold, so there is no leakage).
  - `at_70` is the bin around 60 to 80%. It may be `null` if it is empty.
- `version` becomes 2. `src/lib/scenarios.ts` validates the new fields, which are optional so old files still load.
  It also exports `likelihoodPct(p) -> number` (0 to 100 integer) and `riskWord(p) -> "high" | "medium" | "low"`.
- **What "70%" means (say this in the app's "How sure?" sheet and in HOW-IT-WORKS):** 70% of comparable streets flooded
  **in our physics simulation** for that much rain. It is not yet checked against real floods. That needs the real-world
  labels in the plan (IRIS tickets, more storms).
- **A limit to say out loud:** with only 2 trained storms, the model sees just two rain levels. So 25 to 100 mm at normal
  drains give almost the same map, and 143 mm gives the heavy one. The % values are honest within that limit.
  More storms (plan step 4) fix it.

## 5. Backend and data, answered

- **How the backend works.** There is no server. Python trains the model offline (`ml/run_all.py`) and writes two
  static files, `data/ml/scenarios.json` (about 440 KB) and `metrics.json`. The build copies them to `public/data/`,
  and Netlify serves them from its CDN. The browser does the rest: picking a scenario, nearest street, "where to go".
- **Where the data is hosted.** In the git repo, served by Netlify as static files, like all the team's JSON today.
- **Do we need a database for speed?** No. A static JSON file from a CDN is faster than any database call.
  It is cached by the service worker, so it also works offline. A database (e.g. Supabase) is only worth it if users
  start saving their own plans, or if the model retrains live from new reports.
- **Keeping it tidy:**
  - one data contract (`docs/ml-scenarios-contract.md`) checked by `validateScenarios()` in the app and by `npm run qa` in CI
  - pytest for the model
  - a promotion gate (a new model file ships only if it beats the old one) and a model card in the JSON
- **Size.** It can be cut later by rounding `p` to 2 decimals and gzip (Netlify does gzip already).
  If it grows, it can be split into one file per scenario.

## 6. Tests for this spec

- **Node:** `scripts/scenarios.test.mjs`, extended for `likelihoodPct`, `riskWord` and the v2 validator.
- **QA:** `npm run qa` checks the forbidden words in the new components.
- **pytest:** calibration is monotonic, the bins sum to `n`, and the `reliability` keys exist.
- **Build:** `npm run build` (tsc strict + vite).
- **Browser click-through at 390px and at desktop width:**
  - the intro (pills, nodes, card, Start swoop) and reduced motion
  - the planner: every control by keyboard only, then Escape
  - all 3 languages
  - `/citizen` unchanged, and the app's 3D button still works

---

## 7. Changes from Stephany's feedback (2026-10-10, second round). These override sections 0 to 6.

Goal in her words: "help me understand if my neighbourhood is at risk and what I can expect in different scenarios."
Less text, more practical.

**7.1 Rain in plain names, not millimetres.** The chips show names only. The mm value lives in the "i" detail sheet.
| Name (EN) | Model scenario |
|---|---|
| Moderate rain | 25 mm |
| Heavy rain | 50 mm |
| Very heavy rain | 75 mm |
| Intense storm | 100 mm |
| Extreme storm, like 3 Oct | 143 mm |
Drainage is named "Drains: blocked / normal / clear" (10 / 20 / 30 mm/h). Normal is the default, behind a small "More" toggle.

**7.2 Day strip = the real week ahead (live data).**
- `src/lib/outlook.ts` fetches Open-Meteo (free, no key, CORS):
  `https://api.open-meteo.com/v1/forecast?latitude=41.39&longitude=2.165&daily=precipitation_sum,precipitation_probability_max,weather_code&timezone=Europe%2FMadrid&forecast_days=7`
  - Typed result, with an abort signal and a 6 s timeout.
  - It fails soft: with no data the strip still works as a plain date picker.
  - Add a PWA `NetworkFirst` runtime cache for `api.open-meteo.com` in `vite.config.ts`, max age 3 h.
- Each day shows a small weather glyph and the **chance of rain %**, e.g. "70%", like a weather app.
- Picking a day with rain sets the rain chip to the nearest scenario. That day's **flood likelihood** then comes from the model.
  The header reads e.g. "Thu · 70% chance of rain · Heavy rain".
- Source credit, small: "Rain data: Open-Meteo (Météo-France / ECMWF models)", linked.
  A Meteocat swap needs a Netlify function to hold the API key. That is a follow-up for the team, not now.
- **Copy:** never the word "forecast" (team QA rule). Use "chance of rain", "this week", "outlook".
  Flood numbers are always "likelihood in the model" for the chosen rain.

**7.3 Area = only where we studied.**
- "Select location" lists neighbourhood names first: the nearest `data/zones.json` zone name for each segment, deduplicated. Street names come second.
- Only places inside the model's box are offered. A map-centre pick outside it says "Outside the studied area".

**7.4 The likelihood ring is the hero.** It shows a big %, and one caption line, "chance of street flooding here".
- It uses the calibrated `p` from section 4. Vermilion at 60% or more.
- A "How sure?" chip sits under it.
- No other paragraph on the card.

**7.5 Opening it.** The target button is the **first** button in the top-right `.map-buttons` stack.

**7.6 Text budget.** The planner shows at most about 25 words of copy on screen, excluding place names and numbers. The intro shows at most about 15.
