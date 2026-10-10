// Tests for src/lib/scenarios.ts (pure logic, no browser).
//
// Run from the project root:
//   node --test scripts/scenarios.test.mjs
// Node 22.6+ strips TypeScript types natively. On an older Node (engines says >=20), use:
//   npx tsx --test scripts/scenarios.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  adviceText,
  areasAtRisk,
  areasAtRiskLabel,
  areasAtRiskSpoken,
  decimal,
  extrapolationReasons,
  findScenario,
  haversineM,
  pct,
  scenarioOptions,
  stormButtonLabel,
  trainedDrainage,
  trustLabel,
  validateScenarios,
  whereToGo,
  worstStormAuc,
  zoneActionNear,
} from "../src/lib/scenarios.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureText = readFileSync(join(here, "fixtures", "scenarios.fixture.json"), "utf8");
const load = () => JSON.parse(fixtureText);

// Same list as scripts/qa.mjs FORBIDDEN.
const FORBIDDEN = [/will rain/i, /mm expected/i, new RegExp(String.fromCharCode(0x20ac)), /guaranteed flood/i, /\bforecast\b/i];

test("fixture passes validation", () => {
  const file = validateScenarios(load());
  assert.ok(file);
  assert.equal(file.segments.length, 8);
  assert.equal(file.scenarios.length, 2);
});

test("validateScenarios rejects a wrong p length", () => {
  const raw = load();
  raw.scenarios[0].p = raw.scenarios[0].p.slice(0, 5);
  assert.equal(validateScenarios(raw), null);
});

test("validateScenarios rejects NaN or non-finite p", () => {
  const raw = load();
  raw.scenarios[0].p[2] = Number.NaN;
  assert.equal(validateScenarios(raw), null);
  const raw2 = load();
  raw2.scenarios[1].p[0] = "0.5";
  assert.equal(validateScenarios(raw2), null);
});

test("validateScenarios rejects junk and wrong kind or version", () => {
  assert.equal(validateScenarios(null), null);
  assert.equal(validateScenarios("nope"), null);
  assert.equal(validateScenarios({}), null);
  const raw = load();
  raw.version = 2;
  assert.equal(validateScenarios(raw), null);
  const raw2 = load();
  raw2.kind = "other";
  assert.equal(validateScenarios(raw2), null);
});

test("validateScenarios rejects a top entry pointing outside the segments", () => {
  const raw = load();
  raw.scenarios[0].top[0].segment_index = 99;
  assert.equal(validateScenarios(raw), null);
});

test("findScenario matches exactly and returns undefined otherwise", () => {
  const file = validateScenarios(load());
  assert.equal(findScenario(file, 50, 20)?.id, "r50_d20");
  assert.equal(findScenario(file, 143, 10)?.id, "r143_d10");
  assert.equal(findScenario(file, 50, 10), undefined);
  assert.equal(findScenario(file, 75, 20), undefined);
});

test("scenarioOptions lists distinct sorted values", () => {
  const file = validateScenarios(load());
  assert.deepEqual(scenarioOptions(file, "rain_mm"), [50, 143]);
  assert.deepEqual(scenarioOptions(file, "drainage_mm_h"), [10, 20]);
});

test("pct formats shares and handles missing values", () => {
  assert.equal(pct(0.37), "37%");
  assert.equal(pct(0), "0%");
  assert.equal(pct(0.0027), "under 1%");
  assert.equal(pct(0.0099), "under 1%");
  assert.equal(pct(0.01), "1%");
  assert.equal(pct(1), "100%");
  assert.equal(pct(0.375), "38%");
  assert.equal(pct(null), "n/a");
  assert.equal(pct(Number.NaN), "n/a");
  assert.equal(decimal(0.891), "0.89");
  assert.equal(decimal(null), "n/a");
});

test("trustLabel", () => {
  assert.equal(trustLabel("low"), "Low trust");
  assert.equal(trustLabel("medium"), "Medium trust");
  assert.equal(trustLabel("high"), "High trust");
});

test("haversineM is zero for the same point and sane for a known pair", () => {
  assert.equal(haversineM({ lon: 2.155, lat: 41.388 }, { lon: 2.155, lat: 41.388 }), 0);
  const d = haversineM({ lon: 2.155, lat: 41.388 }, { lon: 2.156, lat: 41.3885 });
  assert.ok(d > 90 && d < 120, `expected about 100 m, got ${d}`);
});

test("whereToGo picks a lower-p AND higher segment, never the same one", () => {
  const file = validateScenarios(load());
  const scenario = findScenario(file, 50, 20);
  const result = whereToGo(file, scenario, 0);
  assert.ok(result);
  assert.notEqual(result.index, 0);
  assert.ok(result.p < scenario.p[0]);
  assert.ok(file.segments[result.index].elev_m > file.segments[0].elev_m);
  // s5 is nearer but riskier (p 0.91), s7 is nearer but lower. Both must be skipped.
  assert.equal(result.index, 1);
  assert.ok(result.distanceM < 150);
  assert.equal(result.gainElevM, 4);
});

test("whereToGo respects maxM", () => {
  const file = validateScenarios(load());
  const scenario = findScenario(file, 50, 20);
  assert.equal(whereToGo(file, scenario, 0, 50), null);
  const wide = whereToGo(file, scenario, 0, 5000);
  assert.ok(wide);
  assert.ok(wide.distanceM <= 5000);
  // Av. Diagonal is far outside the default 600 m radius.
  const near = whereToGo(file, scenario, 0);
  assert.ok(near && near.index !== 4);
});

test("whereToGo never picks a destination at or above the flood threshold", () => {
  const file = validateScenarios(load());
  const base = findScenario(file, 143, 10);
  assert.equal(file.metrics.spatial_cv.threshold, 0.5);
  // s6 (p 0.35) is nearest and fine. Push it to 0.55: s1 (0.60) and s2 (0.50) are still lower than the
  // start (0.97) and higher, but not under 0.5, so the pick must fall through to s3 (0.20).
  const scenario = { ...base, p: base.p.map((v, i) => (i === 6 ? 0.55 : v)) };
  const result = whereToGo(file, scenario, 0);
  assert.ok(result);
  assert.equal(result.index, 3);
  assert.ok(result.p < 0.5);
  // Every candidate at or above the threshold: nowhere to send anyone.
  const allHigh = { ...base, p: base.p.map((v, i) => (i === 0 ? v : Math.max(v, 0.5))) };
  assert.equal(whereToGo(file, allHigh, 0, 5000), null);
  // Whatever the scenario, a returned destination is always under the threshold.
  for (const s of file.scenarios) {
    for (let i = 0; i < file.segments.length; i++) {
      const r = whereToGo(file, s, i, 5000);
      if (r) assert.ok(r.p < 0.5 && r.p < s.p[i]);
    }
  }
});

test("whereToGo uses the file's own threshold", () => {
  const file = validateScenarios(load());
  const scenario = findScenario(file, 50, 20);
  // With a 0.2 cut only s3 (0.08), s4 (0.02) and s6 (0.12) qualify for start s0; s6 is nearest.
  const strict = { ...file, metrics: { ...file.metrics, spatial_cv: { ...file.metrics.spatial_cv, threshold: 0.2 } } };
  const result = whereToGo(strict, scenario, 0, 5000);
  assert.ok(result);
  assert.equal(result.index, 6);
});

test("whereToGo returns null when nothing is safer and higher", () => {
  const file = validateScenarios(load());
  const scenario = findScenario(file, 50, 20);
  // s4 is the highest and safest segment, so there is nowhere better.
  assert.equal(whereToGo(file, scenario, 4), null);
});

test("whereToGo returns null on empty data and bad index", () => {
  const file = validateScenarios(load());
  const scenario = findScenario(file, 50, 20);
  const empty = { ...file, segments: [] };
  assert.equal(whereToGo(empty, { ...scenario, p: [] }, 0), null);
  assert.equal(whereToGo(file, scenario, -1), null);
  assert.equal(whereToGo(file, scenario, 99), null);
});

test("adviceText words both outcomes without giving orders", () => {
  const file = validateScenarios(load());
  const scenario = findScenario(file, 50, 20);
  const text = adviceText(whereToGo(file, scenario, 0));
  assert.match(text, /^A higher, lower-risk street nearby: C\. Villarroel, about \d+ m away \(straight line\)$/);
  assert.doesNotMatch(text, /head |go to /i);
  assert.match(adviceText(null), /No clearly safer, higher street within 600 m/);
});

test("areasAtRisk counts top areas at or above the threshold", () => {
  const file = validateScenarios(load());
  assert.equal(areasAtRisk(file, findScenario(file, 50, 20)), 3);
  assert.equal(areasAtRisk(file, findScenario(file, 143, 10)), 5);
});

test("areasAtRiskLabel adds a plus only when the whole top list is at risk", () => {
  const file = validateScenarios(load());
  const scenario = findScenario(file, 143, 10);
  assert.equal(areasAtRiskLabel(file, scenario), "5");
  assert.equal(areasAtRiskSpoken(file, scenario), "5 alert areas");
  const capped = { ...scenario, top: scenario.top.slice(0, 5) };
  assert.equal(areasAtRiskLabel(file, capped), "5+");
  assert.equal(areasAtRiskSpoken(file, capped), "5 or more alert areas");
  const none = { ...scenario, top: [] };
  assert.equal(areasAtRiskLabel(file, none), "0");
  assert.equal(areasAtRiskSpoken(file, { ...scenario, top: scenario.top.slice(0, 1) }), "1 or more alert areas");
});

test("extrapolationReasons says why, from the file's own trained values", () => {
  const file = validateScenarios(load());
  assert.equal(trainedDrainage(file), 20);
  assert.deepEqual(extrapolationReasons(file, findScenario(file, 50, 20)), []);
  const lowDrain = extrapolationReasons(file, { ...findScenario(file, 50, 10), extrapolated: true });
  assert.equal(lowDrain.length, 1);
  assert.match(lowDrain[0], /^Drainage the model never simulated \(it only saw 20 mm\/h\)$/);
  const [lo, hi] = file.model.trained_rain_mm;
  const wet = extrapolationReasons(file, { ...findScenario(file, 50, 20), rain_mm: hi + 20, extrapolated: true });
  assert.equal(wet.length, 1);
  assert.match(wet[0], /^Rain outside what the model learned from/);
  assert.ok(wet[0].includes(String(lo)) && wet[0].includes(String(hi)));
  const both = extrapolationReasons(file, { ...findScenario(file, 50, 10), rain_mm: hi + 20, extrapolated: true });
  assert.equal(both.length, 2);
});

test("worstStormAuc picks the lowest finite AUC", () => {
  const file = validateScenarios(load());
  const runs = file.metrics.leave_one_storm_out;
  const values = Object.values(runs).map((r) => r.roc_auc).filter((v) => typeof v === "number");
  assert.ok(values.length < Object.keys(runs).length, "fixture has a run with no AUC, which must be ignored");
  assert.equal(worstStormAuc(file), Math.min(...values));
  const missing = { ...file, metrics: { ...file.metrics, leave_one_storm_out: undefined } };
  assert.equal(worstStormAuc(missing), null);
});

test("stormButtonLabel is built from the ISO date", () => {
  assert.equal(stormButtonLabel("2026-10-02"), "Show 2 Oct storm");
  assert.equal(stormButtonLabel("2026-10-03"), "Show 3 Oct storm");
  assert.equal(stormButtonLabel("nonsense"), "Show the storm");
});

test("zoneActionNear returns the nearest card's action or null", () => {
  const zones = {
    z1: { preventiveAction: "Clear the drain grates." },
    z2: { preventiveAction: "Move cars out of the car park." },
  };
  const points = [
    { id: "z1", lon: 2.155, lat: 41.388 },
    { id: "z2", lon: 2.17, lat: 41.395 },
    { id: "missing", lon: 2.1551, lat: 41.3881 },
  ];
  assert.equal(zoneActionNear(zones, points, 2.1551, 41.3881, 300), "Clear the drain grates.");
  assert.equal(zoneActionNear(zones, points, 2.1699, 41.3949, 300), "Move cars out of the car park.");
  assert.equal(zoneActionNear(zones, points, 2.3, 41.5, 300), null);
  assert.equal(zoneActionNear(undefined, points, 2.155, 41.388, 300), null);
  assert.equal(zoneActionNear(zones, [], 2.155, 41.388, 300), null);
});

test("fixture copy contains no forbidden words", () => {
  for (const re of FORBIDDEN) {
    assert.ok(!re.test(fixtureText), `fixture matches forbidden pattern ${re}`);
  }
  assert.ok(!fixtureText.includes(String.fromCharCode(0x2014)), "fixture contains an em-dash");
});
