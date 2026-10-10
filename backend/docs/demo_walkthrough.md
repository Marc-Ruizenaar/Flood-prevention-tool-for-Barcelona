# 5-minute demo walkthrough

Start the demo with `scripts/start_demo.sh 8000`, then open `http://localhost:8000/docs`. All data shown is **SYNTHETIC**
unless the Barcelona run section in `docs/morning_status.md` has been filled in.

1. **Problem (30 s).** On 3-7 Oct, Barcelona's rain gauges logged about 234-281 mm per station (XEMA, provisional).
   The question: which streets flooded, why, and what would have helped?
2. **Physics, not reports (60 s).** This is a 2D shallow-water (local-inertial) solver over the MDT05 terrain, with Green-Ampt infiltration
   and assumed drainage sinks. Nothing comes from flood reports or news. Show `/simulations/synthetic-demo/daily`: rain
   in, infiltration, drainage and outflow close with a mass error around 1e-13.
3. **Gates and honesty (45 s).** Show `/gates` and `/health`. The release gate is closed, every value carries a `kind`
   (simulated / assumption / estimate), and G1-G4 are CONDITIONAL for the reasons in the morning status.
4. **Street map (45 s).** `/simulations/{id}/streets?date=2026-10-03` returns a GeoJSON of street segments with max/p95
   depth, minutes above 0.10/0.30 m, flood class, and the spread across drainage scenarios.
5. **Hotspot "why" popup (60 s).** `/simulations/{id}/hotspots?date=2026-10-03&limit=5` ranks spots by score = peak depth ×
   minutes above 0.10 m, found by the model. Click one: inflow by direction, upstream streets, contributing area,
   the `explanation` budget (rain in → runoff → inflow → drain/infiltration out → stored), local IDW rainfall, provenance.
   (The flux-based "why" fields are the H1/H2 fix, pending audit.)
6. **Mitigation comparison (45 s).** `/simulations/{id}/mitigation` shows the change in flooded street length and peak depth for
   the drain, SUDS, tank and green-roof levers. All levers are illustrative assumptions: model scenarios, not guarantees.
7. **Limitations (15 s).** A 30 m grid can't resolve streets, so depths are understated. The rainfall is provisional, soil is assumed clay loam,
   drainage is assumed, and Collserola is a closed boundary. Full list in `docs/morning_status.md`.

## Barcelona results: PENDING: not yet run
Replace `synthetic-demo` with the real run id and add the screenshots here once the run and audit are done.
