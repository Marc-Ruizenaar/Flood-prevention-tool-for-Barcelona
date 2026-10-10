import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineM, mulberry32, randomPointsInBbox, randomPointsInCells, nearest, shareWithin,
  featurePoint, bboxOf } from "./reports-vs-model.mjs";

test("haversine: 0.001 deg latitude is about 111 m", () => {
  const d = haversineM([2.17, 41.38], [2.17, 41.381]);
  assert.ok(Math.abs(d - 111.2) < 0.5, `got ${d}`);
});

test("nearest and shareWithin", () => {
  const hotspots = [[2.17, 41.38], [2.20, 41.40]];
  const pts = [[2.17, 41.3815], [2.20, 41.4010], [2.10, 41.30]];
  assert.equal(nearest(pts[1], hotspots).index, 1);
  assert.equal(shareWithin(pts, hotspots, 250), 2 / 3);
  assert.equal(shareWithin(pts, hotspots, 100), 0);
});

test("seeded baseline is reproducible and stays inside its area", () => {
  const bb = [2.10, 41.35, 2.22, 41.45];
  const a = randomPointsInBbox(bb, 500, mulberry32(7));
  const b = randomPointsInBbox(bb, 500, mulberry32(7));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, randomPointsInBbox(bb, 500, mulberry32(8)));
  for (const [x, y] of a) assert.ok(x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3]);
  const cells = randomPointsInCells([[2.17, 41.38, 2.1701, 41.3801]], 50, mulberry32(1));
  for (const [x, y] of cells) assert.ok(x >= 2.17 && x <= 2.1701 && y >= 41.38 && y <= 41.3801);
});

test("baseline share tracks the covered fraction of the area", () => {
  // One hotspot in the middle of a ~11 km box: a 250 m disc covers well under 1% of it.
  const bb = [2.10, 41.35, 2.24, 41.45];
  const base = randomPointsInBbox(bb, 2000, mulberry32(42));
  const share = shareWithin(base, [[2.17, 41.40]], 250);
  assert.ok(share < 0.01, `got ${share}`);
});

test("polygon features reduce to their centroid", () => {
  const sq = { geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } };
  assert.deepEqual(featurePoint(sq), [1, 1]);
  assert.deepEqual(bboxOf([[0, 1], [2, -1]]), [0, -1, 2, 1]);
});
