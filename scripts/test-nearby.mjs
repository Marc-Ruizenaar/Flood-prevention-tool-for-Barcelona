/**
 * Smoke test for the resident lookup in src/lib/nearby.ts on bundled 2026-10-03 data.
 * Run: npm run test:nearby
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const streetsPath = join(root, "data/flood/urgell-2026-10-02_03/streets/2026-10-03.json");
const proofPath = join(root, "data/geojson/proof-oct2026.geojson");

const runner = `
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { insideExtent, metresBetween, nearestPoint, worstStreetNear } from "./src/lib/nearby.ts";
import { streetsExtent } from "./src/lib/sim.ts";
const streets = JSON.parse(readFileSync(${JSON.stringify(streetsPath)}, "utf8"));
const proof = JSON.parse(readFileSync(${JSON.stringify(proofPath)}, "utf8"));
const extent = streetsExtent(streets);

assert.ok(Math.abs(metresBetween([2.17, 41.38], [2.17, 41.381]) - 110.5) < 1, "0.001 deg of latitude is about 110 m");

const rambla = [2.170505790689445, 41.38455805844614]; // model hotspot #1
assert.ok(insideExtent(extent, rambla), "La Rambla is inside the simulated area");
const wet = worstStreetNear(streets, rambla, 100);
assert.ok(wet && wet.street.flood_class !== "dry", "La Rambla has water within 100 m");

const torre = proof.features.find((f) => f.properties.id === "proof-torre-baro-2026-10").geometry.coordinates;
assert.ok(!insideExtent(extent, torre), "Torre Baro is outside the simulated area");
assert.equal(worstStreetNear(streets, torre, 100), null, "no simulated street near Torre Baro");
assert.equal(nearestPoint(proof.features, torre, 2000)?.feature.properties.id, "proof-torre-baro-2026-10");

console.log("OK: " + wet.street.name + " " + wet.street.flood_class + " at " + Math.round(wet.metres) + " m");
`;

const result = spawnSync("npx", ["--yes", "tsx", "-e", runner], { cwd: root, encoding: "utf8", stdio: "inherit" });
process.exit(result.status ?? 1);
