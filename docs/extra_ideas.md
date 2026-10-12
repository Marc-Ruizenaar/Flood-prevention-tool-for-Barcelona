# Extra ideas — beyond v0

Parking lot for **stretch goals**, **post-hackathon** directions, and **judge Q&A** (“what’s next?”). Core scope stays in [idea.md](./idea.md). Anything here must keep the same rule: **no uncited claims**, no fake precision.

---

## If we have 2–4 extra hours (still shippable)


| Idea                         | What                                                                                  | Why it lands                                      |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Blind-spot mode**          | One toggle: hide sewers, show slopes + proof only                                     | Makes Torre Baró story one tap, not three         |
| **Overlap highlight**        | When proof + any predictive layer ON, pulse features where `relatedZoneIds` intersect | “We already knew Sant Andreu” without a lecture   |
| **Mechanism filter**         | Chips: overflow · basement · transformer · slope                                      | Ops teams think in failure mode, not layer name   |
| **Share card link**          | `?zone=sewer-diagonal` opens map + sheet                                              | Slack/WhatsApp to district crews after demo       |
| **Catalan / English toggle** | Duplicate `zones.json` keys or `locales/ca.json`                                      | City staff + international jury                   |
| **Print snapshot**           | Export visible map + one card as PNG/PDF                                              | Meeting handout without building a report product |
| **Layer legend drawer**      | Short line per toggle: “T10 atlas baseline, not live radar”                           | Preempts “where’s the weather?” questions         |


---



## Data layers worth adding (v1)

Each needs the same pipeline: acquire → simplify → card → source URL.


| Layer                                     | Source direction                               | Story                                                                  |
| ----------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| **Planned PDISBA works**                  | BCNROC plànols + memòria                       | “Upcoming” vs “after investment” — honest compare to diagnosis-only v0 |
| **Transformer / substation proximity**    | Open data / press-linked points only           | Tie `transformer_room` mechanism to geography where sources allow      |
| **Blue-green / permeability**             | City green infrastructure maps                 | Where nature-based fixes overlap hotspots                              |
| **Coastal / ACA river (mention → layer)** | Pla Clima, ACA T100                            | Secondary toggle: “not this storm, but on the same map”                |
| **Historical proof archive**              | Same ingest as Oct 2026, new GeoJSON per event | After each storm: add dots, run blind-spot diff                        |
| **District / USM boundaries**             | CartoBCN                                       | Aggregate view: “how many mechanisms in Sant Andreu?”                  |


**Composite index (careful):** weighted *count* of overlapping official layers per cell — label as **“atlas overlap score”**, not probability. Never blend proof into predictive score.

---



## Workflows for municipal staff


| Idea                             | Behavior                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Pre-storm checklist route**    | User picks N zones → ordered list of `preventiveAction` lines + map deep links (not turn-by-turn navigation) |
| **Watchlist**                    | Pin zones in `localStorage`; badge on next visit (no accounts v1)                                            |
| **Post-storm debrief template**  | Form exports: zone id, observed Y/N, layer that flagged it, link to proof card — feeds next proof GeoJSON    |
| **Handoff to BCASA / districts** | Card footer: “Responsible body” field in JSON (only if cited in official docs)                               |
| **Compare two storms**           | Split screen or swipe: Oct 2026 proof vs future event layer                                                  |


---



## Intelligence & automation (guardrailed)


| Idea                         | Guardrail                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| **Agent: “explain overlap”** | Input = 2–3 card JSONs + `relatedZoneIds`; output explains in plain language; **no new facts**  |
| **Agent: briefing note**     | Bullet memo for a district councillor from selected cards; every bullet must quote a card field |
| **RAG over sources**         | Retrieve only whitelisted URLs (`sources.json`); answers must cite chunk + URL                  |
| **Auto proof ingest**        | RSS / manual URL → human approves → append GeoJSON point + card (human in the loop)             |
| **Translation**              | CA/ES/EN for cards via LLM with **frozen glossary** (T10, RESCCUE, rieres)                      |


**Hard no:** model-generated rainfall, depths, or “risk %” without an official published statistic.

---



## Sensors & live data (v2+, high integration cost)


| Source                              | Use                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| **SMC / MeteoCat alerts**           | Banner: “Heavy rain warning active” — does **not** redraw polygons; links to official alert |
| **BCASA SCADA / overflow signals**  | If ever public: status dot on known hotspots only                                           |
| **Citizen reports (311)**           | Optional layer after dedup + privacy review                                                 |
| **Traffic / Waze closure patterns** | Weak signal only; never primary evidence                                                    |


Live data should **annotate** atlas layers, not replace them, until licensing and latency are solved.

---



## UX & reach


| Idea                   | Notes                                                               |
| ---------------------- | ------------------------------------------------------------------- |
| **Accessibility mode** | List view of all demo-priority zones (`priority: 1`) — map optional |
| **Low-bandwidth mode** | Points only, no polygon fill; smaller bundled tiles                 |
| **Embed widget**       | iframe for Resilience Atlas or district intranet                    |
| **Kiosk / big screen** | Same app, default wider bbox, proof layer for debrief meetings      |
| **WhatsApp mini-card** | OG meta per `?zone=` for pretty link previews                       |


---



## Validation & research (credibility moat)


| Idea                    | Output                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| **Blind-spot register** | Running table: incident id, mechanisms observed, predictive layers that missed it, layer to add |
| **Hit rate dashboard**  | % of proof points within X m of any predictive feature, **per mechanism**                       |
| **Methodology page**    | One public doc: how traces were made, licenses (PDISBA NC-ND), update cadence                   |
| **Peer cities**         | Clone repo layout for Lisbon / Valencia RESCCUE cities — hackathon narrative “replicable tool”  |


---



## Business / policy angles (talking points, not v0 product)

- **Insurance / reinsurance:** cited atlas + proof archive as **evidence of known exposure**, not underwriting engine.
- **Climate adaptation funding:** map export showing overlap of slope + sewer gaps for grant narratives (with sources).
- **Procurement:** “which planned PDISBA works intersect blind spots?” once works layer exists.
- **Education:** simplified citizen view (fewer zones, no transformer detail) — separate app skin, same data.

---



## Integrations


| System                  | Integration                                                                |
| ----------------------- | -------------------------------------------------------------------------- |
| **Jira / ServiceNow**   | Create inspection task from `preventiveAction` + zone id                   |
| **ArcGIS / QGIS**       | Download layer pack (GeoJSON + metadata) for analysts                      |
| **Notion / Confluence** | Auto-sync methodology + source link table from `sources.json`              |
| **Calendar**            | Subscribe to “SMC orange alert → open watchlist zones” (when alerts exist) |


---



## Hackathon demo variants (pick one if bored)

1. **“Before / after”:** sewer-only vs all layers — 20 second split.
2. **“Three mechanisms”:** three taps: overflow, basement, slope — same preventive ops tone.
3. **“Reporter mode”:** start on proof layer → rewind toggles to show what was already published.
4. **“District chief”:** search “Gràcia” → filter → read one transformer-linked card.

---



## Explicitly deprioritize (unless sponsor asks)

- Full 2D hydraulic simulation in the browser  
- Real-time routing for pump trucks  
- Crowdsourced “flood this street now” without moderation  
- Black-box ML “predict next flood cell”  
- Scraping paywalled news without citation metadata

---



## Suggested roadmap (honest)


| Phase              | Focus                                                                |
| ------------------ | -------------------------------------------------------------------- |
| **v0 (hackathon)** | Static layers, cards, proof toggle, 60s demo                         |
| **v0.5**           | Share links, blind-spot mode, CA/EN, proof ingest template           |
| **v1**             | Planned works layer, blind-spot register, overlap score (labeled)    |
| **v2**             | Alerts banner, watchlists, district workflows, optional RAG briefing |


---



## One-liners for judges

- **“We don’t predict millimetres; we unify what Barcelona already published.”**
- **“Oct 2026 is our regression test, not our training set.”**
- **“Torre Baró is a product requirement: if slope isn’t on the map, the sewer map is incomplete.”**
- **“Every extra idea still ends in a source URL.”**

