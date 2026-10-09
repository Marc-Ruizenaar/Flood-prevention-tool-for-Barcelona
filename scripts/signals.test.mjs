// npm run signals:check. Fails if the filter, gazetteer, priority or publish logic breaks.
// The end-to-end case runs the real build and qa scripts in a temp copy with fixture rows written for this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cadence, compose, isHealth, isRelevant, keywordMechanism, makeResolver, parseRss, signalId } from "./signals-lib.mjs";

const gaz = JSON.parse(readFileSync("signals/gazetteer.json", "utf8"));
const code = (name) => Object.entries(gaz.barris).find(([, b]) => b.name === name)[0];
const resolve = makeResolver(gaz);

test("health content is dropped, flood content passes", () => {
  assert.ok(isHealth("Un home ferit lleu per la caiguda d'un arbre"));
  assert.ok(isHealth("Rescatan a una mujer atrapada en su coche"));
  assert.ok(!isHealth("Carrers inundats a Sant Andreu després de la pluja"));
  assert.ok(isRelevant("Aiguat a Barcelona: carrers inundats"));
  assert.ok(!isRelevant("La ciudadana presenta el nuevo mercado")); // "dana" inside a word is not a storm
});

test("gazetteer: barri, alias, district precision, veto, common words", () => {
  assert.deepEqual(resolve("Esllavissada al carrer de Cànoves, a Sant Genís dels Agudells").barris, [code("Sant Genís dels Agudells")]);
  assert.deepEqual(resolve("Problemes a Sant Genís Agudells").barris, [code("Sant Genís dels Agudells")], "Atlas alias");
  assert.equal(resolve("Talls de llum a Gràcia, Sant Andreu i les Corts").level, "district", "a list of districts is district precision");
  assert.equal(resolve("Inundacions a Badalona i a Sant Andreu").level, "veto");
  assert.equal(resolve("l'aigua va entrar per la porta del garatge").level, "none", "common word, not capitalised");
  assert.equal(resolve("el riu Besòs baixa ple").level, "none", "a river is not a place");
  assert.equal(resolve("Inundacions a Barcelona").level, "none");
});

test("keyword mechanism is a hint from fixed rules", () => {
  assert.equal(keywordMechanism("810 abonats sense llum per filtracions"), "transformer_room");
  assert.equal(keywordMechanism("Una esllavissada talla el carrer"), "slope_runoff");
  assert.equal(keywordMechanism("Nova biblioteca"), "unclassified");
});

test("priority is composed in code from editable weights", () => {
  const priors = [
    { c_barri: "01", name: "A", nearest_station: "X4", exposure: 0.2, damage_t10_per_ha: 1 },
    { c_barri: "02", name: "B", nearest_station: "D5", exposure: 0.9, damage_t10_per_ha: 2 },
  ];
  const knobs = { rainCapMm3h: 30, signalCap6h: 3, staleCapH: 6, calmEveryNthTick: 4 };
  const weights = { rain: 0.45, exposure: 0.25, signals: 0.2, staleness: 0.1 };
  assert.equal(compose({ priors, rain3h: { X4: 0, D5: 0 }, weights, knobs })[0].c_barri, "02", "dry: exposure decides");
  assert.equal(compose({ priors, rain3h: { X4: 30, D5: 0 }, weights, knobs })[0].c_barri, "01", "rain at the nearest station lifts a barri");
  assert.equal(compose({ priors, rain3h: { X4: 0, D5: 0 }, weights: { rain: 0, exposure: 0, signals: 1, staleness: 0 }, signals6h: { "01": 3 }, knobs })[0].c_barri, "01", "weights are editable");
  assert.equal(compose({ priors, rain3h: { X4: null, D5: 0 }, weights, knobs }).find((p) => p.c_barri === "01").parts.rain, 1, "unknown rain counts as wet");
  assert.equal(cadence({ rain3h: { X4: 0 }, warning: 0, anySignal6h: false, tick: 1, knobs }).fullRun, false, "calm skips");
  assert.equal(cadence({ rain3h: { X4: 0 }, warning: null, anySignal6h: false, tick: 1, knobs }).mode, "storm", "failed warning read fails fast");
});

test("RSS parsing keeps fields in memory, ids are stable", () => {
  const xml = `<rss><channel><item><title><![CDATA[Pluja &amp; vent]]></title><link>https://beteve.cat/x/</link><guid>https://beteve.cat/?p=1</guid><pubDate>Sat, 04 Oct 2026 09:12:00 +0000</pubDate><description><![CDATA[<p>Text</p>]]></description></item></channel></rss>`;
  const [it] = parseRss(xml);
  assert.equal(it.title, "Pluja & vent");
  assert.equal(it.description, "Text");
  assert.equal(new Date(it.pubDate).toISOString(), "2026-10-04T09:12:00.000Z");
  assert.equal(signalId("press", "https://beteve.cat/x/"), signalId("manual", "https://beteve.cat/x/"), "web pages hash the URL");
});

// End to end: fixture inbox -> build -> qa, in a temp copy of the repo files qa reads.
function sandbox(rows) {
  const dir = mkdtempSync(join(tmpdir(), "signals-check-"));
  for (const p of ["data", "signals", "scripts", "src/types.ts", "src/App.tsx"]) cpSync(p, join(dir, p), { recursive: true });
  writeFileSync(join(dir, "signals/inbox.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return dir;
}
const run = (dir, script) => spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8", env: { ...process.env, SIGNALS_NOW: "2026-10-08T12:00:00Z" } });
const row = (over) => ({
  signal_id: "0000000000000001", platform: "manual", source_kind: "press", source_url: "https://beteve.cat/fixture-written-for-the-test/",
  source_label: "Betevé", published_at: "2026-10-04T09:12Z", fetched_at: "2026-10-04T09:30Z", summary: "Fixture.",
  place: { level: "barri", barri: code("Sant Genís dels Agudells") }, cls: null,
  review: { status: "approved", by: "R0", at: "2026-10-04T09:41Z", reason: null, mechanism: "slope_runoff" }, ...over,
});

test("build + qa: approved rows publish, pending and proof duplicates do not", () => {
  const proofUrl = "https://beteve.cat/societat/pluja-barris-muntanya-esllavissades-rescat-barca/"; // the repo's Sant Genís proof card
  const dir = sandbox([
    row({}),
    row({ signal_id: "0000000000000002", source_url: "https://ajuntament.barcelona.cat/fixture-written-for-the-test/", source_kind: "official", source_label: "Ajuntament de Barcelona", published_at: "2026-10-05T08:00Z" }),
    row({ signal_id: "0000000000000003", source_url: proofUrl }),
    row({ signal_id: "0000000000000004", place: { level: "barri", barri: code("Sant Andreu") }, review: { status: "pending", by: null, at: null, reason: null, mechanism: null } }),
    row({ signal_id: "0000000000000005", published_at: "2026-09-01T08:00Z", place: { level: "barri", barri: code("el Raval") } }), // outside the window
    { signal_id: "0000000000000006", review: { status: "rejected", by: "R0", at: "2026-10-05T10:00Z", reason: "not Barcelona" } },
  ]);
  const build = run(dir, "scripts/signals-build.mjs");
  assert.equal(build.status, 0, build.stderr);
  const gj = JSON.parse(readFileSync(join(dir, "data/geojson/signals.geojson"), "utf8"));
  const cards = JSON.parse(readFileSync(join(dir, "data/signals-cards.json"), "utf8"));
  assert.equal(gj.features.length, 1);
  const card = cards[`sig-${code("Sant Genís dels Agudells")}`];
  assert.deepEqual(card.mechanisms, ["observed_impact", "slope_runoff"]);
  assert.match(card.whatCouldFail, /^On 4 and 5 October 2026, 2 reviewed reports from Ajuntament de Barcelona and Betevé described slope runoff in Sant Genís dels Agudells\./);
  assert.ok(card.relatedZoneIds.includes("proof-sant-genis-2026-10"), "proof duplicate is linked, not redrawn");
  const qa = run(dir, "scripts/qa.mjs");
  assert.equal(qa.status, 0, qa.stderr + qa.stdout);
});

test("build fails on a host off the allowlist and on stored post text", () => {
  for (const bad of [row({ source_url: "https://www.reddit.com/r/barcelona/x" }), row({ text: "copied post text" })]) {
    assert.equal(run(sandbox([bad]), "scripts/signals-build.mjs").status, 1);
  }
});

test("qa passes with an empty inbox", () => {
  const dir = sandbox([]);
  execFileSync(process.execPath, ["scripts/signals-build.mjs"], { cwd: dir });
  assert.equal(run(dir, "scripts/qa.mjs").status, 0);
});
