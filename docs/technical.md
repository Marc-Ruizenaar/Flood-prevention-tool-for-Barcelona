# Technical — data & repo contract

Companion to [idea.md](./idea.md). v0 is **static only**: bundled GeoJSON + `zones.json`, no live weather or sensor APIs.

---

## Repo layout (target)

```
data/
  geojson/
    sewer-t10-stress.geojson      # polygons or simplified corridors
    resccue-hotspots.geojson    # points (14 named zones)
    buried-streams.geojson      # linestrings (rieres / canalitzacions)
    retention-tanks.geojson     # points (BCASA tanks + status)
    slopes-torrents.geojson     # polygons (INUNCAT / geologic slope risk, clipped to BCN)
    proof-oct2026.geojson       # points (reported incidents, optional toggle)
  zones.json                    # fact cards keyed by feature id
  sources.json                  # optional: canonical URLs per layer (for maintainers)
public/                         # or app static dir — same files copied for offline demo
```

**Join rule:** every map feature that is tappable must have `properties.id` matching a key in `zones.json`. Proof-layer dots may share an id with a zone or use `proof-*` ids with their own cards.

**CRS:** store GeoJSON as **WGS84 (EPSG:4326)**. Reproject from ETRS89 / UTM 31N on ingest.

---

## Per-layer checklist

Status columns: **Acquire** → **Digitize** (if no vector download) → **Simplify** → **Card** (write `zones.json`).

### 1. Sewer stress / T10 overflow (`sewer-t10-stress`)

| Field | Value |
| --- | --- |
| **Map toggle** | “Next rain — sewers” (combined with hotspots in UI is OK; keep separate files) |
| **Mechanisms** | `street_overflow`, `basement` (only if source says so) |
| **Geometry** | `Polygon` or `MultiPolygon` preferred; `LineString` corridors acceptable if traced from atlas |
| **Demo anchors** | Poblenou, Paral·lel–Sant Antoni–Raval, Diagonal (Balmes–Via Laietana), Sant Andreu, Badal |

**Acquire**

- [ ] Read narrative + map context: [Resilience Atlas — Inundabilitat (EN)](https://coneixement-eu.bcn.cat/widget/atles-resiliencia/en_index_inundabilitat.html) (PICBA’06 / BCASA model, T10 capacity).
- [ ] Cross-check wording: [PDISBA summary PDF (DIBA)](https://www.diba.cat/documents/63810/351191002/20210628_PDISBA_RESUM.pdf/41a84801-d6a5-4fa0-a802-2738cc5cdfa8?t=1625050619598) (T10 + climate framing; **prognosis** says planned works remove pedestrian T10 risk — cite **diagnosis** layer for “upcoming” story, or label clearly as atlas baseline).
- [ ] Full plan + plànols (heavy): [PDISBA on BCNROC](https://bcnroc.ajuntament.barcelona.cat/jspui/handle/11703/119275) (**CC-BY-NC-ND** — OK to cite and manually trace; do not republish raw plan PDFs as if open GIS).

**Digitize** (likely required)

- [ ] No single city WFS found for T10 polygons in idea doc — **trace simplified polygons** from Resilience Atlas / PDISBA plànols over OSM/ICGC base.
- [ ] Cap **~5–12 zones** for demo clarity (named neighborhoods / axes), not full hydraulic mesh.

**Simplify**

- [ ] Douglas–Peucker or hand-simplify; target **&lt; 500 KB** for this layer.
- [ ] One feature per named stress area; `properties.name`, `properties.id` (`sewer-poblenou`, etc.).

**Card**

- [ ] `sourceLabel`: e.g. `"Resilience Atlas / BCASA (PICBA’06 T10)"`
- [ ] `sourceUrl`: Resilience Atlas inundabilitat page (above).
- [ ] `atlasTerm`: e.g. `"T10 sewer overflow"` (no mm rainfall).
- [ ] One `preventiveAction` tied to mechanism (inspect gullies/sumps, pre-storm drain clearance — generic ops language, not invented CAPEX).

---

### 2. RESCCUE / PDISBA urban flood hotspots (`resccue-hotspots`)

| Field | Value |
| --- | --- |
| **Map toggle** | Same as sewers or sub-layer “14 hotspots” |
| **Mechanisms** | `street_overflow`, `basement`, `transformer_room` (only where RESCCUE/press links grid) |
| **Geometry** | `Point` (centroid) or small `Polygon` around named area |
| **Named examples** | Macià, Urgell/Roma, Paral·lel, Clot, Riera Blanca, Tajo–Cartellà, … (aim for **14** if doc-complete) |

**Acquire**

- [ ] Context: [RESCCUE Barcelona toolkit](https://toolkit.resccue.eu/city/barcelona/)
- [ ] Paper listing USM / districts: [MDPI RESCCUE Barcelona](https://www.mdpi.com/2071-1050/12/14/5638) — use for **names and citations**, not as downloadable GIS.
- [ ] PDISBA memòria / plànols on [BCNROC PDISBA](https://bcnroc.ajuntament.barcelona.cat/jspui/handle/11703/119275) for hotspot locations.

**Digitize**

- [ ] Place points from PDISBA maps or RESCCUE figures; geocode with [CartoBCN / Open Data](https://opendata-ajuntament.barcelona.cat/data/es/dataset/cataleg-cartobcn) + OSM sanity check.

**Simplify**

- [ ] 14 points + labels; no buffers required for v0.

**Card**

- [ ] `sourceLabel`: `"RESCCUE / PDISBA’19"`
- [ ] `sourceUrl`: RESCCUE city page or BCNROC handle + document name you used.
- [ ] `whatCouldFail`: plain language aligned with RESCCUE (pedestrian/vehicle hazard, urban flooding), no depth numbers unless quoted.

---

### 3. Buried streams (`buried-streams`)

| Field | Value |
| --- | --- |
| **Map toggle** | “Buried streams” |
| **Mechanisms** | `street_overflow`, `basement` |
| **Geometry** | `LineString` / `MultiLineString` |
| **Demo anchors** | Riera d’Horta, Cartellà corridor, Rambla de Prim (under-avenue rieres) |

**Acquire**

- [ ] **RIER_LN** (rieres + canals): ArcGIS REST → GeoJSON query  
  `https://maps.icgc.cat/vector02/rest/services/icgc_geotecnicbcn25m/MapServer/1/query?where=1%3D1&outFields=IGDS_LAYER&outSR=4326&f=geojson`  
  (filter `IGDS_LAYER` / symbology value **Rieres** client-side or in ingest script; max record count 1000 — may need bbox queries).
- [ ] Visor: [VISSIR — Mapa geotècnic Barcelona](http://www.ide.cat/es/Herramientas-y-visores/Visores/VISSIR) (cross-check).
- [ ] Optional: **REBL_PA** (rebliments de rieres) polygon layer from same MapServer for fill context.

**Simplify**

- [ ] Clip to Barcelona municipality; merge segments; drop attributes except `name` / `id`.
- [ ] Highlight **3–5** named rieres in `zones.json`; rest can be visual-only without cards.

**Card**

- [ ] `sourceLabel`: `"ICGC Mapa Geotècnic de Barcelona (RIER_LN)"`
- [ ] `sourceUrl`: MapServer layer or VISSIR.
- [ ] Mention **partial mitigation** where a tank exists (link tank feature id).

---

### 4. Retention tanks (`retention-tanks`)

| Field | Value |
| --- | --- |
| **Map toggle** | With buried streams or “Mitigation” sub-toggle |
| **Mechanisms** | `mitigation` (not a failure mode — explains reduced risk) |
| **Geometry** | `Point` |
| **Demo anchor** | Rambla de Prim ~70k m³ (verify capacity on BCASA) |

**Acquire**

- [ ] [BCASA — Dipòsits map](https://www.bcasa.cat/cat/DipositsBCN_Mapa.asp) (locations + capacities).
- [ ] Resilience Atlas section “Existing and planned stormwater detention tanks (2018)” on [inundabilitat page](https://coneixement-eu.bcn.cat/widget/atles-resiliencia/en_index_inundabilitat.html).
- [ ] RESCCUE blog context: [Barcelona drainage / tanks](https://toolkit.resccue.eu/blog/200-2/).

**Digitize**

- [ ] Geocode tank points from BCASA map; `properties.status`: `operating` \| `planned`.

**Card**

- [ ] Short fact: what conca it serves; `preventiveAction` = inspect / ensure regulation before storm (ops), not “build new tank” unless source says planned.

---

### 5. Slopes & torrents (`slopes-torrents`)

| Field | Value |
| --- | --- |
| **Map toggle** | “Slopes & torrents” |
| **Mechanisms** | `slope_runoff`, `torrent` |
| **Geometry** | `Polygon` (INUNCAT zones, dejection cones) clipped to city; optional `Point` for Torre Baró |
| **Demo anchor** | Torre Baró / Collserola-facing — **blind spot** vs sewer-only map |

**Acquire**

- [ ] WMS (view / export by screenshot trace if needed):  
  `https://pcivil.icgc.cat/ogc/geoservei?map=/opt/idec/dades/pcivil/risc_inundacions.map`  
  Catalog: [IDE Catalunya — risc inundacions WMS](https://catalegs.ide.cat/geonetwork/srv/api/records/risc-inundacions-wms?language=eng)
- [ ] Interactive: [Mapa Protecció Civil Catalunya](https://pcivil.icgc.cat/pcivil/v2/index.html) — layers under natural risks / urbanism.
- [ ] Geologic / escarpment context: **Escarpament del Pla de Barcelona** etc. in same [geotecnic MapServer](https://maps.icgc.cat/vector02/rest/services/icgc_geotecnicbcn25m/MapServer/layers) (pick polygon layers as needed).

**Digitize**

- [ ] Export or trace **priority action points** / **potentially flooding areas** / dejection cones for Barcelona bbox only.
- [ ] Explicit **Torre Baró** polygon or point even if coarse — demo depends on it.

**Simplify**

- [ ] Few polygons with clear labels; avoid whole Catalonia download in the app bundle.

**Card**

- [ ] `sourceLabel`: `"ICGC / INUNCAT (Protecció Civil)"`
- [ ] `sourceUrl`: WMS catalog or pcivil map.
- [ ] Copy idea.md narrative: slope/walls on geologic maps **not** on 14 sewer points.

---

### 6. Oct 2026 proof layer (`proof-oct2026`) — optional toggle

| Field | Value |
| --- | --- |
| **Map toggle** | “Oct 2026 proof” (off by default on first paint) |
| **Mechanisms** | `observed_impact` (not predictive) |
| **Geometry** | `Point` |
| **Demo anchors** | Torre Baró cleanup (7 Oct 2026), Sant Andreu / Gràcia transformer floods, basement reports |

**Acquire** (journalism + civil sources — cite per dot)

- [ ] City press / ajuntament communications (search by date Oct 2026).
- [ ] [3Cat](https://www.3cat.cat/) — basement / flood coverage.
- [ ] [Betevé](https://beteve.cat/) — power cuts / transformer rooms (Les Corts, Sant Andreu, Gràcia).
- [ ] Rainfall narrative: ~280 L/m² Can Bruixa, ~50-year event (meteo press / SMC reports) — **cite one article** in `sources[]`, not as forecast.

**Digitize**

- [ ] One point per **reported** incident cluster; `properties.date`, `properties.headline`, `properties.mediaUrl`.

**Card**

- [ ] `layerType`: `"proof"` — UI shows “observed” badge.
- [ ] Do **not** merge proof facts into predictive layers; use `relatedZoneIds[]` to link overlap (e.g. Sant Andreu sewer hotspot).

**Rainfall (mention-only in UI copy, not a layer)**

- ACA river T100, Pla Clima coastal — storm was **pluvial + slope**, not river/coastal main story.

---

## `zones.json` schema

Single file array or object map `{ [id]: ZoneCard }`. Recommended: **object map** for O(1) lookup on tap.

```json
{
  "sewer-diagonal": {
    "id": "sewer-diagonal",
    "name": "Diagonal (Balmes – Via Laietana)",
    "layerIds": ["sewer-t10-stress"],
    "mechanisms": ["street_overflow"],
    "atlasTerm": "T10 sewer overflow",
    "whatCouldFail": "Surface overflow from drains under design storm; basement ingress in low points adjacent to the axis.",
    "preventiveAction": "Pre-storm inspection of gullies and sumps on the axis; clear known blockage points.",
    "sourceLabel": "Resilience Atlas / BCASA (PICBA’06)",
    "sourceUrl": "https://coneixement-eu.bcn.cat/widget/atles-resiliencia/en_index_inundabilitat.html",
    "relatedZoneIds": ["hotspot-macia"],
    "notes": "Optional internal; not shown in demo UI"
  },
  "proof-torre-baro-2026-10": {
    "id": "proof-torre-baro-2026-10",
    "name": "Torre Baró — post-storm cleanup (Oct 2026)",
    "layerIds": ["proof-oct2026"],
    "layerType": "proof",
    "mechanisms": ["observed_impact", "slope_runoff"],
    "whatCouldFail": "Documented slope/mud impacts; not represented on sewer hotspot map alone.",
    "preventiveAction": "Slope inspection and clearance per civil protection guidance before next intense rainfall.",
    "sourceLabel": "City press / local media (Oct 2026)",
    "sourceUrl": "https://www.ajuntament.barcelona.cat/…",
    "relatedZoneIds": ["slope-torre-baro"]
  }
}
```

### Required fields (predictive layers)

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | Stable; matches GeoJSON `properties.id` |
| `name` | string | Human label for bottom sheet |
| `layerIds` | string[] | Which file(s) this card belongs to |
| `mechanisms` | string[] | From enum below |
| `whatCouldFail` | string | No invented depths, costs, or dates |
| `preventiveAction` | string | One action; ops-level; tied to mechanism |
| `sourceLabel` | string | Short authority name |
| `sourceUrl` | string | HTTPS link user can open |

### Optional fields

| Field | Use |
| --- | --- |
| `atlasTerm` | Shown in UI instead of weather forecast copy |
| `relatedZoneIds` | Cross-layer storytelling (overlap / blind spot) |
| `layerType` | `"proof"` for validation toggle |
| `sources` | Array `{ label, url }` when multiple citations |

### Mechanism enum (v0)

`street_overflow` · `basement` · `transformer_room` · `slope_runoff` · `torrent` · `mitigation` · `observed_impact`

---

## GeoJSON feature contract

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [2.17, 41.39] },
  "properties": {
    "id": "hotspot-clot",
    "name": "Clot",
    "layer": "resccue-hotspots",
    "priority": 1
  }
}
```

- **`id`** (required): joins to `zones.json`.
- **`name`** (required): map label / search.
- **`layer`** (optional): redundant with filename; useful if merging layers later.
- **`priority`** (optional): sort order in lists (1 = demo-first).

Features **without** a card may render but should not open a sheet (or show “No fact card — visual only”).

---

## Ingest & QA (before demo)

- [ ] Every card has **working** `sourceUrl` (HTTP 200 spot-check).
- [ ] No feature claims **future** rainfall; use `atlasTerm` / T10 / “published hotspot”.
- [ ] Proof layer default **off**; predictive layers **on** per demo script.
- [ ] Total bundled GeoJSON **&lt; ~2 MB** (venue Wi‑Fi).
- [ ] MapLibre: test on **phone** — tap targets ≥ 44px for points.
- [ ] Blind-spot story: **Torre Baró** has slope card + proof dot, **no** sewer hotspot id in `relatedZoneIds` for sewer layer (or explicit empty sewer link).
- [ ] License: PDISBA **NC-ND** — ship **your traces + citations**, not raw plan tiles as product.

---

## Out of scope (do not wire in v0)

Live sensors · user accounts · insurance · hydraulic simulation · citizen reports · live weather API.

Optional LLM agent: input = one card JSON; output = paraphrase only; **must not** add fields.

---

## Parallel work split

| Owner | Deliverable |
| --- | --- |
| Data A | `sewer-t10-stress` + `resccue-hotspots` + cards for Diagonal / Poblenou / Sant Andreu |
| Data B | `buried-streams` + `retention-tanks` ingest from ICGC + BCASA |
| Data C | `slopes-torrents` + Torre Baró card |
| Data D | `proof-oct2026` + media URLs |
| UI | MapLibre toggles, bottom sheet, `fetch('data/zones.json')` + layer files |

---

## `sources.json` (optional maintainer file)

```json
{
  "sewer-t10-stress": {
    "primary": "https://coneixement-eu.bcn.cat/widget/atles-resiliencia/en_index_inundabilitat.html",
    "secondary": "https://bcnroc.ajuntament.barcelona.cat/jspui/handle/11703/119275"
  },
  "resccue-hotspots": {
    "primary": "https://toolkit.resccue.eu/city/barcelona/"
  },
  "buried-streams": {
    "primary": "https://maps.icgc.cat/vector02/rest/services/icgc_geotecnicbcn25m/MapServer/1"
  },
  "retention-tanks": {
    "primary": "https://www.bcasa.cat/cat/DipositsBCN_Mapa.asp"
  },
  "slopes-torrents": {
    "primary": "https://pcivil.icgc.cat/pcivil/v2/index.html",
    "wms": "https://pcivil.icgc.cat/ogc/geoservei?map=/opt/idec/dades/pcivil/risc_inundacions.map"
  }
}
```
