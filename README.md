# Next rain — Barcelona

A phone map of **published** flood geography for Barcelona: sewer stress on a T10 storm, buried streams and tanks, and Collserola-facing slopes. October 2026 is a proof layer you turn on, not the opening screen.

It does not forecast rainfall, depth, or damage. Every tappable card has a source link.

## Run

Needs Node 20 or newer (`nvm use` if you have [nvm](https://github.com/nvm-sh/nvm)).

```bash
npm install
npm run dev
```

Production build, which is the demo candidate:

```bash
npm run build
npm run preview
```

Data checks:

```bash
npm run qa
npm run qa:urls
```

Canonical data lives in `data/`. The npm scripts copy it to `public/data` so the static build serves the same paths.

## Demo, about 60 seconds

1. Open the map. **Next rain — sewers** is on. Pan to Diagonal or Poblenou and tap. The card names the mechanism, one action, and the atlas source.
2. Turn on **Slopes & torrents**. Go to Torre Baró. The sewer hotspots do not explain it.
3. Turn on **Oct 2026 proof**. Sant Andreu and Gràcia sit on places the atlas already marked. Torre Baró was hit with no sewer hotspot.
4. Close on one line: support these zones before the next storm, using data the city already publishes.

**Blind spot** hides the sewers and flies to Torre Baró with slopes and proof on. Share a card with `?zone=sewer-diagonal` (or any id).

## Offline

The production build registers a service worker. After one online load, a reload can use the cached app, GeoJSON, and basemap tiles already seen. External tiles that were never viewed are not in the cache.

## Sources

Layer links are in the in-app About panel and in `data/sources.json`. Geometries are simplified traces and neighborhood outlines for a briefing, not official flood contours or the PICBA mesh. PDISBA plan PDFs are cited, not republished.

## Stack

Vite, React, MapLibre GL, OpenFreeMap positron basemap. No backend and no weather API.
