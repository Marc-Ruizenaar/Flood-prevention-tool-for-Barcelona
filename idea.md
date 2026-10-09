# Upcoming flood problems — hackathon idea

**One line:** A city tool that shows **where the next heavy rain will hurt Barcelona**—by merging published flood layers (sewers, streams, slopes)—and flags **blind spots** the sewer maps do not cover. October 2026 is the proof run, not the product.

**Track:** Tool

---

## Problem

Barcelona already knows a lot: BCASA sewer overflow on a T10 storm, 14 RESCCUE urban flood hotspots, buried rieres and retention tanks, ICGC slope and torrent risk, climate hazard zones. That knowledge lives in **separate atlases**. After each storm, crews discover the same gap again—e.g. **Torre Baró** (slope and walls on geologic maps, **not** on the 14 sewer points) while **Sant Andreu / Gràcia** stress matches published drain stress.

The city does not need another cleanup spreadsheet. It needs one view of **upcoming problems**: where water will likely fail **next time**, by mechanism (street overflow, basement, transformer room, slope runoff), with sources attached.

## Solution

A **mobile web risk tool** for municipal staff (demo on a phone in ~60 seconds).

**Map first.** MapLibre with toggle layers from public data:

- **Next rain — sewer stress** (Resilience Atlas / BCASA PICBA T10 streets and RESCCUE named hotspots).
- **Next rain — buried streams** (rieres under major avenues; tanks already built = partial mitigation).
- **Next rain — slopes & torrents** (ICGC / INUNCAT; Collserola-facing neighborhoods including Torre Baró-type risk).

Tap a zone → **fact card** (stored JSON only): what could fail, which official layer says so, **one preventive action** (inspect sump, clear slope, check basement/transformer room, extend tank capacity—always tied to mechanism + source, not invented engineering).

**Proof layer (optional toggle):** dots for **what broke in Oct 2026** (city press, 3Cat, Betevé). Used to show “predicted vs happened” and **misses** (damage with no sewer hotspot → add slope layer). Not the main screen.

Optional one-shot agent: card in → plain-language summary; **may not add facts** beyond the card.

No hero routing walk. No live weather API required for v0—we describe risk in atlas terms (“T10 sewer overflow”, “published hotspot”) not fake millimetre forecasts.

## Why this week (credibility)

~50-year rainfall (~280 L/m² Can Bruixa). Torre Baró cleanup (7 Oct 2026). Basement floods (3Cat). Transformer rooms flooded → cuts in Les Corts, Sant Andreu, Gràcia (Betevé). Lets us say: **many “upcoming” zones were already on the map; Torre Baró was the layer the city must add to “next rain.”**

## Data we ship (JSON + GeoJSON in repo)

| Layer | Source |
| --- | --- |
| Sewer overflow / T10 stress | Resilience Atlas / BCASA (Poblenou, Paral·lel–Sant Antoni–Raval, Diagonal; Sant Andreu, Badal on hazard map) |
| 14 urban flood hotspots | RESCCUE / PDISBA’19 (Macià, Urgell/Roma, Paral·lel, Clot, Riera Blanca, Tajo–Cartellà, …) |
| Buried streams + tanks | e.g. Riera d’Horta / Cartellà / Rambla de Prim (70k m³ tank) |
| Slopes & torrents | ICGC / INUNCAT |
| Oct 2026 validation (toggle) | City press, 3Cat, Betevé, rainfall reports |

**Not in v0:** live sensors, accounts, insurance, full hydraulic simulation, citizen reports. **Mention only:** ACA river T100, Pla Clima coastal flood—this storm was pluvial + slope.

## 60-second demo script

1. Open map → **“Next rain — sewers”** on → pan to Diagonal / Poblenou hotspot → tap → what fails + prevent.
2. Toggle **“Slopes & torrents”** → Torre Baró → “sewer map alone is incomplete.”
3. Toggle **“Oct 2026 proof”** → overlap in Sant Andreu/Gràcia; Torre Baró hit with no sewer point → blind spot.
4. One sentence: **support these zones before the next storm**, using data Barcelona already publishes.

## Build plan (parallel-friendly)

- **Data:** GeoJSON zones/points per layer + `zones.json` fact cards (mechanism, source URL, preventive action).
- **UI:** MapLibre layer toggles, bottom sheet on tap, proof-layer switch.
- **Agent (optional):** paraphrase card only.
- **Offline-safe:** static tiles + bundled GeoJSON for venue Wi‑Fi.

## What we will not claim

We do not predict exact dates or depths. We surface **official upcoming-risk geography** and **documented blind spots**, with every claim tied to a cited source. No AI-invented damage or costs.
