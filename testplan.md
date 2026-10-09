# Test plan — Barcelona upcoming flood risk tool (v0)

Companion to [idea.md](./idea.md) and [technical.md](./technical.md). v0 is **static** (bundled GeoJSON + `zones.json`), **mobile-first**, and optimized for a **~60 second live demo** with optional venue Wi‑Fi.

---

## Goals

| Goal | How we verify |
| --- | --- |
| Map tells the “next rain” story in atlas terms | Demo script passes end-to-end on a phone |
| Every tappable claim is cited | Data QA + spot-check of fact cards |
| Blind spot (Torre Baró) is obvious vs sewer-only view | Layer toggle + proof overlap tests |
| Safe to show officials | No fake forecasts, depths, or AI-invented facts |
| Works at the venue | Offline / throttled-network smoke test |

---

## Scope

### In scope

- Bundled data integrity (`data/geojson/*`, `zones.json`, optional `sources.json`)
- MapLibre UI: layer toggles, pan/zoom, tap → bottom sheet
- Proof layer default **off**; predictive layers match demo defaults
- Optional LLM agent: paraphrase-only behavior (if shipped)
- Performance: bundle size, first paint, tap latency on phone

### Out of scope (must not fail the build if absent)

- Live weather, sensors, accounts, hydraulic simulation, citizen reports
- Automated cross-browser matrix beyond **one primary phone + one desktop** sanity check
- Load testing, security pen test, accessibility audit to WCAG AA (smoke only)

---

## Test environments

| Environment | Use |
| --- | --- |
| **Local dev** | `npm run dev` (or static server); fast iteration |
| **Production build** | Same assets as demo (`public/` or build output); **this is the demo candidate** |
| **Phone (primary)** | iOS Safari or Android Chrome — **required sign-off device** |
| **Throttled / offline** | Airplane mode after first load, or DevTools “Offline” after cache warm |

Record in sign-off: device model, OS version, browser.

---

## Roles

| Role | Responsibility |
| --- | --- |
| **Data** | GeoJSON + `zones.json` QA (joins, sources, copy rules) |
| **UI** | Map, toggles, sheet, proof badge |
| **Demo lead** | Runs 60s script; marks go/no-go |

---

## Test data fixtures

Minimum features that **must** exist for demo pass (names may vary; ids should match [technical.md](./technical.md)):

| Story | Layer(s) | Anchor id / area |
| --- | --- | --- |
| Sewer stress | `sewer-t10-stress`, `resccue-hotspots` | Diagonal, Poblenou, Sant Andreu |
| Buried water | `buried-streams`, `retention-tanks` | Riera d’Horta / Cartellà / Rambla de Prim + ≥1 tank |
| Slope blind spot | `slopes-torrents` | Torre Baró (or `slope-torre-baro`) |
| Proof overlap | `proof-oct2026` | Sant Andreu / Gràcia incidents + Torre Baró cleanup |
| Visual-only | Any | ≥1 feature **without** card (optional) |

---

## 1. Data QA (blocking)

Run before UI sign-off. Can be partly scripted (see [Automation hints](#automation-hints-optional)).

### 1.1 GeoJSON contract

For each file under `data/geojson/`:

- [ ] Valid GeoJSON (parse JSON; `type: FeatureCollection`).
- [ ] Coordinates in **WGS84**; features fall roughly inside Barcelona bbox (~41.35–41.45°N, 2.05–2.25°E).
- [ ] Every **tappable** feature has `properties.id` (string, stable).
- [ ] Every tappable feature has `properties.name`.
- [ ] No duplicate `properties.id` within a file (unless intentional shared id — document exception).
- [ ] Layer file size: sewer + hotspots + streams + slopes + proof **total &lt; ~2 MB** (demo Wi‑Fi).

### 1.2 `zones.json` contract

- [ ] Parse as JSON; lookup by id (object map or array — match app code).
- [ ] Every id referenced by a **tappable** GeoJSON feature has a card.
- [ ] Required fields present: `id`, `name`, `layerIds`, `mechanisms`, `whatCouldFail`, `preventiveAction`, `sourceLabel`, `sourceUrl`.
- [ ] `mechanisms` values ⊆ enum in technical.md (`street_overflow`, `basement`, `transformer_room`, `slope_runoff`, `torrent`, `mitigation`, `observed_impact`).
- [ ] Proof cards: `layerType: "proof"` where applicable; mechanisms include `observed_impact`.
- [ ] **No future rainfall claims** in copy (no dates for “next storm”, no mm forecasts); predictive cards use `atlasTerm` / T10 / “published hotspot” language.
- [ ] **No invented** depths, costs, or engineering CAPEX unless quoted in `sourceUrl` content.
- [ ] `relatedZoneIds` resolve to existing ids (no dangling references).

### 1.3 Source URLs

- [ ] Spot-check **100% of unique** `sourceUrl` values (HTTP 200 or valid redirect to 200); log failures.
- [ ] Proof layer: each dot has traceable `mediaUrl` or card `sourceUrl` to city press / 3Cat / Betevé / meteo cite.

### 1.4 Demo narrative integrity

- [ ] **Torre Baró**: slope card exists; proof dot exists; **no** sewer hotspot card that falsely “explains” Torre Baró on sewer-only layer (blind spot story).
- [ ] **Sant Andreu / Gràcia**: proof points overlap or `relatedZoneIds` link to sewer/hotspot cards where story requires it.
- [ ] Retention tank cards use mechanism `mitigation` and mention partial risk reduction where streams overlap.
- [ ] PDISBA **NC-ND**: repo ships traces + citations, not republished raw plan PDFs as product tiles.

### 1.5 Join smoke

- [ ] Pick 5 random tappable features across layers → tap id in app → sheet shows **same** `name` and `id`.
- [ ] Feature with **no** card (if any): map shows geometry; tap shows “No fact card” or non-interactive (per product rule).

---

## 2. Functional UI tests (blocking)

Execute on **production build** on **primary phone**.

### 2.1 First paint & defaults

- [ ] App loads without console errors blocking map.
- [ ] Map centers on Barcelona; basemap/tiles visible (static/bundled tiles if used).
- [ ] **“Oct 2026 proof”** toggle is **OFF** on first load.
- [ ] Default ON layers match demo script (at minimum **“Next rain — sewers”** / combined sewer+hotspots as designed).

### 2.2 Layer toggles

For each toggle label in the UI:

- [ ] OFF → layer geometries hidden (or clearly de-emphasized per design).
- [ ] ON → layer visible within ~1s on phone.
- [ ] Turning sewer OFF and slopes ON → Torre Baró area still discoverable (pan or search).
- [ ] Multiple layers ON: no z-order bug that hides tap targets on demo anchors.

### 2.3 Interaction — bottom sheet

- [ ] Tap hotspot/polygon/point (≥44px effective target for points) opens bottom sheet.
- [ ] Sheet shows: name, what could fail, preventive action, source label, **link** to source (opens in new tab / in-app browser).
- [ ] Proof card shows **“observed”** (or equivalent) badge when `layerType: "proof"`.
- [ ] Dismiss sheet (swipe down / close) → map still interactive.
- [ ] Rapid tap two features → sheet updates to latest selection without stale content.

### 2.4 Cross-layer storytelling

- [ ] Card with `relatedZoneIds` (if surfaced in UI): links or copy reference related zones without merging proof into predictive text.
- [ ] Agent button (if present): only enabled when sheet open; does not block map.

---

## 3. Demo script — acceptance test (blocking)

**Single timed run**, demo lead, production build, phone. Target **≤ 60 seconds** speaking pace.

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | Open map; **Next rain — sewers** ON | Hotspots/stress visible |
| 1b | Pan to Diagonal or Poblenou; tap | Fact card: mechanism + preventive action + Resilience/RESCCUE source |
| 2 | Toggle **Slopes & torrents** ON; go to Torre Baró | Slope/torrent risk visible; card states sewer map alone is incomplete |
| 3 | Toggle **Oct 2026 proof** ON | Dots appear; Sant Andreu/Gràcia overlap with known stress; Torre Baró hit **without** sewer point at same location |
| 4 | Closing line (manual) | “Support these zones before the next storm” — no weather API claims |

**Pass:** All four steps complete without workaround (no devtools, no reloading mid-script).

---

## 4. Non-functional tests

### 4.1 Performance (phone)

- [ ] Cold load (clear cache): interactive map **&lt; 5s** on mid-range phone on good Wi‑Fi.
- [ ] Warm load: **&lt; 2s** to interactive.
- [ ] Toggle layer: visible change **&lt; 1s**.
- [ ] Pan/zoom: no sustained &lt; 20 FPS during demo path (subjective “smooth enough”).

### 4.2 Offline / bad network

- [ ] After one successful load, enable airplane mode → reload app → map + data still work (bundled assets).
- [ ] If using external tiles: document fallback (bundled raster or message); demo path must not blank-map.

### 4.3 Desktop smoke (non-blocking)

- [ ] Chrome latest: same toggles and one tap → sheet works (layout may differ).

---

## 5. Optional agent tests (if feature ships)

- [ ] Input: full card JSON from sheet → output is **paraphrase only** (same facts: mechanisms, actions, sources).
- [ ] Output must **not** add: dates, rainfall mm, depths, costs, new zones, or new preventive actions.
- [ ] API key failure: graceful message; map and sheet still work without agent.
- [ ] Rate limit / timeout: no crash; user can retry or dismiss.

---

## 6. Negative & compliance tests

- [ ] Search UI/copy for forbidden patterns: “will rain on”, “mm expected”, “€ damage”, “guaranteed flood”.
- [ ] No live weather widget or API calls in network tab during demo flow (unless explicitly out of scope and disabled).
- [ ] External links use `https`; no mixed-content warnings.
- [ ] `.env` secrets not committed; agent key not in client bundle (if agent is server-side or edge-only).

---

## 7. Regression checklist (before every demo)

Short pass (~10 min):

1. Data: run join smoke (5 features) + proof default off.
2. Phone: demo script once.
3. Airplane mode reload once.
4. Console: zero uncaught errors on demo path.

---

## Defect severity

| Severity | Definition | Demo impact |
| --- | --- | --- |
| **S0** | App won’t load, map blank, or demo script blocked | No-go |
| **S1** | Wrong/missing card on demo anchor; proof story broken | No-go |
| **S2** | Minor copy, link 404 on non-demo zone, layout glitch | Go with verbal caveat |
| **S3** | Cosmetic, desktop-only | Go |

---

## Sign-off

| Check | Owner | Date | Pass |
| --- | --- | --- | --- |
| Data QA §1 | | | ☐ |
| UI functional §2 (phone) | | | ☐ |
| Demo script §3 | | | ☐ |
| Offline §4.2 | | | ☐ |
| Agent §5 (if applicable) | | | ☐ |

**Go for demo:** all blocking sections pass; no open S0/S1.

---

## Automation hints (optional)

If time permits, add a small Node script (not required for hackathon pass):

1. Load all GeoJSON files + `zones.json`.
2. Assert id joins, required fields, mechanism enum, duplicate ids, bbox sanity.
3. `fetch` all `sourceUrl` with concurrency limit; report non-200.
4. Emit exit code 1 on any blocking data QA failure for CI or pre-demo hook.

---

## Traceability

| Requirement (idea.md) | Test section |
| --- | --- |
| Map-first + layer toggles | §2.2 |
| Fact cards with sources | §1.2, §2.3 |
| Blind spots (Torre Baró) | §1.4, §3 step 2–3 |
| Proof vs predicted | §2.1, §3 step 3 |
| No live weather v0 | §6 |
| Offline-safe demo | §4.2 |
| 60s demo | §3 |
