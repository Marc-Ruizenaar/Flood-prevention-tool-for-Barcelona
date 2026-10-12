# MVP — Barcelona upcoming flood risk tool (v0)

Companion to [idea.md](./idea.md), [technical.md](./technical.md), and [testplan.md](./testplan.md). This file is the **scope fence** for hackathon week: what we ship, what we cut, and when we call it done.

**One line:** A **mobile web map** that merges **published** flood layers for Barcelona, shows **fact cards** on tap (cited, no fake weather), and tells the **Torre Baró blind-spot** story with an optional **Oct 2026 proof** toggle.

---

## Success criteria (non-negotiable)

| Criterion | Pass condition |
| --- | --- |
| **Demo** | [60-second script](./idea.md#60-second-demo-script) runs on a **phone** without embarrassment |
| **Truthfulness** | Every sheet field traceable to `sourceUrl`; no mm forecasts, depths, or AI-invented damage |
| **Blind spot** | Sewer-only view does **not** explain Torre Baró; slopes + proof make the gap obvious |
| **Venue-safe** | Static bundle loads after one online visit; total GeoJSON **&lt; ~2 MB** |
| **Sign-off** | [testplan.md](./testplan.md) **blocking** sections green on production build |

If we miss a criterion, we **cut features** before we weaken data quality or citations.

---

## MVP tiers

### M0 — Must ship (the product)

**Data**

- [ ] `data/geojson/` per [technical.md](./technical.md): sewer T10 stress, RESCCUE hotspots, buried streams, retention tanks (≥1 demo tank), slopes/torrents (incl. Torre Baró), proof Oct 2026
- [ ] `data/zones.json` — object map; `properties.id` joins on all **tappable** features
- [ ] Minimum demo anchors (ids may vary; stories must not):

| Story | Must exist |
| --- | --- |
| Sewer stress | Diagonal, Poblenou, Sant Andreu (polygon and/or hotspot) |
| Buried water | ≥1 named riera + Rambla de Prim / Cartellà corridor context |
| Mitigation | ≥1 retention tank card (`mitigation`) |
| Blind spot | Torre Baró slope card; **no** false sewer hotspot for Torre Baró |
| Proof | Torre Baró cleanup + Sant Andreu / Gràcia incident cluster(s) |

**UI**

- [ ] MapLibre full-screen map (Barcelona default view)
- [ ] Layer toggles: **Next rain — sewers** (T10 + hotspots OK combined in UI), **Buried streams** (+ tanks visible or sub-toggle), **Slopes & torrents**, **Oct 2026 proof** (**off** on first paint)
- [ ] Tap feature → **bottom sheet**: name, mechanisms, what could fail, one preventive action, source label + link
- [ ] Proof cards show **observed** badge (`layerType: "proof"`)
- [ ] Static assets in `public/` (or build output) — same paths the app loads in demo

**Copy / UX**

- [ ] Risk language uses atlas terms (`atlasTerm`, T10, “published hotspot”) — **not** live radar
- [ ] Tap targets usable on phone (points ≥ ~44px effective)

**Out of M0 (do not block release)**

- LLM agent, accounts, search, routing, live weather, sensors, simulation

---

### M1 — Should ship (polish that helps the pitch)

- [ ] Layer legend one-liner per toggle (“Atlas baseline, not live forecast”)
- [ ] `relatedZoneIds` surfaced in sheet (“Also see: …”) for Sant Andreu / Gràcia overlap story
- [ ] Loading / empty states if a layer file fails
- [ ] Desktop sanity layout (demo is still phone-first)
- [ ] Optional `data/sources.json` for maintainers ([technical.md](./technical.md))

---

### M2 — Nice if time ([extra_ideas.md](./extra_ideas.md))

- Blind-spot mode (hide sewers, slopes + proof only)
- Deep link `?zone=<id>` opens sheet
- Mechanism filter chips
- Catalan locale for cards
- Paraphrase-only LLM on one card JSON

**Rule:** M2 never changes GeoJSON or adds uncited facts.

---

## Definition of done

**M0 is done when:**

1. Production build served locally matches files judges will see (no dev-only paths).
2. [testplan.md §1 Data QA](./testplan.md#1-data-qa-blocking) and [§2 Functional UI](./testplan.md#2-functional-ui-tests-blocking) checklists pass on **one signed-off phone**.
3. Demo lead runs the 60s script **twice** without script fixes.
4. README or in-app “About” lists data sources at layer level (can point to `sources.json`).

**We explicitly do not require:** WCAG audit, multi-browser matrix, backend, CI beyond “build succeeds”.

---

## Build order (critical path)

```text
zones.json schema + 3 anchor cards (Diagonal, Torre Baró slope, proof Torre Baró)
    → minimal GeoJSON for those ids
    → MapLibre shell + one layer + bottom sheet join
    → remaining layers + toggles + proof default off
    → data QA + demo rehearsal
    → M1 polish
```

**Parallel after schema is frozen:**

| Track | Deliverable |
| --- | --- |
| **Data A** | `sewer-t10-stress` + `resccue-hotspots` + cards (Diagonal, Poblenou, Sant Andreu) |
| **Data B** | `buried-streams` + `retention-tanks` (ICGC ingest + BCASA tank) |
| **Data C** | `slopes-torrents` + Torre Baró |
| **Data D** | `proof-oct2026` + media URLs |
| **UI** | Toggles, sheet, layer styling, demo defaults |

**Merge gate:** no PR merges new tappable `id` without matching `zones.json` entry and `sourceUrl` spot-check.

---

## Scope cuts (when behind)

Cut in this order — **never** cut citations or Torre Baró story:

1. M2 features entirely
2. M1 legend / related-zone UI (keep data in JSON for verbal demo)
3. Number of sewer polygons (keep **3** named zones + **3** hotspots, not full 14)
4. Buried streams: **3** highlighted rieres with cards; rest visual-only
5. Retention tanks: **1** card (Rambla de Prim)
6. Optional agent

**Do not cut:** slopes layer, Torre Baró slope + proof dots, Sant Andreu overlap narrative, proof toggle default off.

---

## Tech stack (MVP assumption)

| Piece | Choice |
| --- | --- |
| App | Static SPA (Vite + React or vanilla — team preference) |
| Map | MapLibre GL JS |
| Tiles | Static / free basemap (OSM or MapTiler key in `.env` if needed) |
| Data | Fetch bundled JSON/GeoJSON; no API for v0 |
| Deploy | Static host (Netlify / Vercel / GitHub Pages) for demo URL |

Details and file layout: [technical.md](./technical.md).

---

## What we will not claim (MVP)

- Exact storm dates, rainfall mm, or flood depths unless quoted on `sourceUrl`
- That the app **predicts** the next event — it **surfaces official geography** of upcoming risk
- Insurance, citizen reports, or live sensor readings
- Hydraulic simulation or “probability” scores

Mention-only in copy: ACA river T100, Pla Clima coastal — this product story is **pluvial + slope** for Oct 2026.

---

## Demo handoff

- **Primary artifact:** phone URL to production build
- **Backup:** same build on laptop + phone hotspot; airplane mode after first load
- **Script:** [idea.md § 60-second demo](./idea.md#60-second-demo-script)
- **Go/no-go:** [testplan.md § Sign-off](./testplan.md)

---

## References

| Doc | Use |
| --- | --- |
| [idea.md](./idea.md) | Problem, solution narrative, demo script |
| [technical.md](./technical.md) | GeoJSON, `zones.json`, ingest URLs, QA |
| [testplan.md](./testplan.md) | Blocking tests, fixtures, automation hints |
| [extra_ideas.md](./extra_ideas.md) | Post-MVP only |
