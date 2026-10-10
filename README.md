# Next rain — Barcelona

A phone map of the 2–3 October 2026 storm in Barcelona. A 30 m street simulation shows where water collected in the centre and ranks where to act first. Reported impacts from the press and the city show what happened outside the simulated area, and published atlas cards explain the ground under each place.

It does not forecast the next storm. Simulated numbers are labelled as simulated, and every fact card has a source link.

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

A fresh checkout builds without the backend. Two things fill in only when you generate them locally:

- `npm run pulse` and `npm run attention` add the Bluesky and Wikipedia blocks to the Weather panel (needs network).
- The build report under "How the model ran" needs the backend to write `backend/outputs/inputs/bcn_30m.report.json`. Without it the panel says so and the rest of the app is unaffected.

## Demo, about 60 seconds

On a phone, production build.

1. Open the map. Saturday 3 October, 190.8 mm at el Raval. The coloured streets inside the dashed **Simulated area** are the model's water depth for that day.
2. Tap **See list**. "Where to act first" ranks spots from the simulation. Tap #1, La Rambla: the sheet drops and the popup says why water collects there.
3. Back in the sheet, tap **Show them** on "4 of 6 reported places fall outside the simulated area". The map zooms out to the city: Torre Baró and Sant Genís up in the hills and Sant Andreu to the northeast, all far from the box.
4. Tap the Torre Baró dot. The card is an observed impact with its source, and the ground reading shows why slope water hits there.
5. Close on one line: most of the places that got hit sit outside anything modelled. Run the model where the reports are, before the next storm.

The round rain button opens the storm week (station totals, Bluesky chatter, Wikipedia attention). Share any card with `?zone=<id>`, for example `?zone=proof-torre-baro-2026-10`.

## Offline

The production build registers a service worker. After one online load, a reload can use the cached app, GeoJSON, and basemap tiles already seen. External tiles that were never viewed are not in the cache.

## Sources

Layer links are in the in-app About panel and in `data/sources.json`. Geometries are simplified traces and neighborhood outlines for a briefing, not official flood contours or the PICBA mesh. PDISBA plan PDFs are cited, not republished.

## Stack

Vite, React, MapLibre GL, OpenFreeMap positron basemap. No backend and no weather API.
