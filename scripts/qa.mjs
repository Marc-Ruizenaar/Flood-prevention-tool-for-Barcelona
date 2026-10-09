import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MECHANISMS = new Set([
  "street_overflow",
  "basement",
  "transformer_room",
  "slope_runoff",
  "torrent",
  "mitigation",
  "observed_impact",
]);

const REQUIRED = [
  "id",
  "name",
  "layerIds",
  "mechanisms",
  "whatCouldFail",
  "preventiveAction",
  "sourceLabel",
  "sourceUrl",
];

const BBOX = { minLon: 2.05, maxLon: 2.25, minLat: 41.32, maxLat: 41.48 };
const FORBIDDEN = [/will rain/i, /mm expected/i, /€/, /guaranteed flood/i, /\bforecast\b/i];

const failures = [];

function fail(message) {
  failures.push(message);
}

function walkCoords(value, visit) {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value[0], value[1]);
    return;
  }
  for (const item of value) walkCoords(item, visit);
}

const zones = JSON.parse(readFileSync("data/zones.json", "utf8"));
const files = readdirSync("data/geojson").filter((name) => name.endsWith(".geojson"));
let bytes = 0;
const seenGlobal = new Set();

for (const file of files) {
  const path = join("data/geojson", file);
  bytes += statSync(path).size;
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${file} is not valid JSON (${error.message})`);
    continue;
  }
  if (json.type !== "FeatureCollection" || !Array.isArray(json.features)) {
    fail(`${file} is not a FeatureCollection`);
    continue;
  }
  const seen = new Set();
  for (const feature of json.features) {
    walkCoords(feature.geometry?.coordinates, (lon, lat) => {
      if (lon < BBOX.minLon || lon > BBOX.maxLon || lat < BBOX.minLat || lat > BBOX.maxLat) {
        fail(`${file} coordinate outside Barcelona bbox: ${lat}, ${lon}`);
      }
    });
    const props = feature.properties ?? {};
    if (props.tappable === false) continue;
    if (typeof props.id !== "string" || !props.id) {
      fail(`${file} tappable feature missing id`);
      continue;
    }
    if (typeof props.name !== "string" || !props.name) fail(`${file} ${props.id} missing name`);
    if (seen.has(props.id)) fail(`${file} duplicate id ${props.id}`);
    seen.add(props.id);
    if (seenGlobal.has(props.id)) fail(`id ${props.id} reused across files`);
    seenGlobal.add(props.id);
    const card = zones[props.id];
    if (!card) fail(`no zones.json card for ${props.id}`);
  }
}

for (const [id, card] of Object.entries(zones)) {
  if (card.id !== id) fail(`${id} card id mismatch`);
  for (const field of REQUIRED) {
    if (card[field] === undefined || card[field] === "") fail(`${id} missing ${field}`);
  }
  if (!Array.isArray(card.mechanisms) || card.mechanisms.length === 0) fail(`${id} mechanisms empty`);
  for (const mechanism of card.mechanisms ?? []) {
    if (!MECHANISMS.has(mechanism)) fail(`${id} bad mechanism ${mechanism}`);
  }
  if (!String(card.sourceUrl).startsWith("https://")) fail(`${id} sourceUrl is not https`);
  for (const source of card.sources ?? []) {
    if (!String(source.url).startsWith("https://")) fail(`${id} extra source is not https`);
  }
  for (const related of card.relatedZoneIds ?? []) {
    if (!zones[related]) fail(`${id} dangling relatedZoneIds ${related}`);
  }
  const blob = JSON.stringify(card);
  for (const pattern of FORBIDDEN) {
    if (pattern.test(blob)) fail(`${id} contains forbidden copy ${pattern}`);
  }
  if (card.layerType === "proof") {
    if (!card.mechanisms.includes("observed_impact")) fail(`${id} proof card missing observed_impact`);
  }
}

const torre = zones["slope-torre-baro"];
const torreProof = zones["proof-torre-baro-2026-10"];
if (!torre) fail("missing Torre Baró slope card");
if (!torreProof) fail("missing Torre Baró proof card");
const sewerish = new Set(["sewer-t10-stress", "resccue-hotspots"]);
for (const related of torre?.relatedZoneIds ?? []) {
  const card = zones[related];
  if (card?.layerIds?.some((layer) => sewerish.has(layer))) {
    fail(`Torre Baró slope links to a sewer layer via ${related}`);
  }
}
for (const related of torreProof?.relatedZoneIds ?? []) {
  const card = zones[related];
  if (card?.layerIds?.some((layer) => sewerish.has(layer))) {
    fail(`Torre Baró proof links to a sewer layer via ${related}`);
  }
}
if (!zones["proof-sant-andreu-2026-10"]?.relatedZoneIds?.includes("sewer-sant-andreu")) {
  fail("Sant Andreu proof does not link to the sewer card");
}
if (!zones["proof-gracia-2026-10"]?.relatedZoneIds?.includes("hotspot-via-augusta")) {
  fail("Gràcia proof does not link to the Via Augusta hotspot");
}
if (!zones["tank-rambla-prim"]?.mechanisms?.includes("mitigation")) {
  fail("Rambla de Prim tank is not marked mitigation");
}

const defaults = readFileSync("src/types.ts", "utf8");
if (!defaults.includes("proof: false")) fail("proof layer is not off in the default visibility");
const app = readFileSync("src/App.tsx", "utf8");
if (/open-meteo|api\.weather|weather\.com/i.test(app)) fail("live weather client detected");

if (bytes > 2 * 1024 * 1024) fail(`GeoJSON total ${(bytes / 1024 / 1024).toFixed(2)} MB exceeds 2 MB`);

if (process.argv.includes("--urls")) {
  const urls = new Set();
  for (const card of Object.values(zones)) {
    urls.add(card.sourceUrl);
    for (const source of card.sources ?? []) urls.add(source.url);
  }
  const sources = JSON.parse(readFileSync("data/sources.json", "utf8"));
  for (const entry of Object.values(sources)) {
    if (entry.primary) urls.add(entry.primary);
    if (entry.secondary) urls.add(entry.secondary);
  }
  const list = [...urls];
  const results = await Promise.all(
    list.map(async (url) => {
      try {
        const response = await fetch(url, {
          redirect: "follow",
          headers: { "User-Agent": "barcelona-next-rain-qa" },
        });
        return { url, status: response.status };
      } catch (error) {
        return { url, status: 0, error: error.message };
      }
    }),
  );
  for (const result of results) {
    if (result.status < 200 || result.status >= 400) {
      fail(`source ${result.status || result.error} ${result.url}`);
    } else {
      console.log(`ok ${result.status} ${result.url}`);
    }
  }
}

if (failures.length) {
  console.error(`QA failed (${failures.length})`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`QA passed. ${seenGlobal.size} tappable features, ${(bytes / 1024).toFixed(0)} KB GeoJSON.`);
