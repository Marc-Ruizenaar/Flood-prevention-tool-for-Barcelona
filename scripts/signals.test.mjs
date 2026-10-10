// npm run signals:check. Fails if the filter, gazetteer, priority or publish logic breaks.
// The end-to-end case runs the real build and qa scripts in a temp copy with fixture rows written for this test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cadence, compose, isHealth, isRelevant, keywordMechanism, makeResolver, normUrl, parseRss, signalId } from "./signals-lib.mjs";

const gaz = JSON.parse(readFileSync("signals/gazetteer.json", "utf8"));
const code = (name) => Object.entries(gaz.barris).find(([, b]) => b.name === name)[0];
const resolve = makeResolver(gaz);

test("health content is dropped, flood content passes", () => {
  assert.ok(isHealth("Un home ferit lleu per la caiguda d'un arbre"));
  assert.ok(isHealth("Rescatan a una mujer atrapada en su coche"));
  assert.ok(!isHealth("Carrers inundats a Sant Andreu després de la pluja"));
  assert.ok(isRelevant("Aiguat a Barcelona: carrers inundats"));
  assert.ok(!isRelevant("La ciudadana presenta el nuevo mercado")); // "dana" inside a word is not a storm
  for (const t of ["El carrer ha quedat negat", "Calle anegada en Sants", "Carrers plens de fang", "La riada de la nit", "L'aigua entra a l'escola", "El agua acumulada en el andén"])
    assert.ok(isRelevant(t), t);
  for (const t of ["Cal aguantar fins dilluns", "Un resultat negatiu a les enquestes"]) assert.ok(!isRelevant(t), t);
});

test("one page, one key", () => {
  assert.equal(normUrl("https://Beteve.cat/a/b?utm_source=x#top"), "https://beteve.cat/a/b/");
  assert.equal(normUrl("https://beteve.cat/a/b/"), "https://beteve.cat/a/b/");
  assert.notEqual(normUrl("https://beteve.cat/?p=1"), normUrl("https://beteve.cat/?p=2"), "a bare WordPress id keeps its query");
});

test("gazetteer: barri, alias, district precision, veto, common words", () => {
  assert.deepEqual(resolve("Esllavissada al carrer de Cànoves, a Sant Genís dels Agudells").barris, [code("Sant Genís dels Agudells")]);
  assert.deepEqual(resolve("Problemes a Sant Genís Agudells").barris, [code("Sant Genís dels Agudells")], "Atlas alias");
  assert.equal(resolve("Talls de llum a Gràcia, Sant Andreu i les Corts").level, "district", "a list of districts is district precision");
  assert.deepEqual(resolve("Pluges a Torre Baró. Treballs a Horta-Guinardó i a Sarrià-Sant Gervasi.").barris, [code("Torre Baró")], "a named barri stays a candidate");
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

// End to end: fixture rows -> build -> qa, in a temp copy of the repo files qa reads.
// Reviewer decisions go to the committed signals/reviewed.jsonl, everything else to the gitignored pending file.
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
const decided = (r) => ["approved", "rejected"].includes(r.review?.status);
function sandbox(rows) {
  const dir = mkdtempSync(join(tmpdir(), "signals-check-"));
  for (const p of ["data", "signals", "scripts", "src/types.ts", "src/App.tsx"]) cpSync(p, join(dir, p), { recursive: true });
  rmSync(join(dir, "signals/counts.json"), { force: true }); // a reviewer's local run state must not leak into the test
  writeFileSync(join(dir, "signals/reviewed.jsonl"), jsonl(rows.filter(decided)));
  writeFileSync(join(dir, "signals/pending.local.jsonl"), jsonl(rows.filter((r) => !decided(r))));
  return dir;
}
const run = (dir, script, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, SIGNALS_NOW: "2026-10-08T12:00:00Z" } });
const lines = (dir, p) => { try { return readFileSync(join(dir, p), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)); } catch { return null; } };
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
    row({ signal_id: "0000000000000007", source_url: "https://beteve.cat/fixture-written-for-the-test?utm_source=x#a" }), // same page as row 1
  ]);
  const build = run(dir, "scripts/signals-build.mjs");
  assert.equal(build.status, 0, build.stderr);
  const gj = JSON.parse(readFileSync(join(dir, "data/geojson/signals.geojson"), "utf8"));
  const cards = JSON.parse(readFileSync(join(dir, "data/signals-cards.json"), "utf8"));
  assert.equal(gj.features.length, 1);
  assert.deepEqual(gj.features[0].properties.days, ["2026-10-04", "2026-10-05"], "local publication days of the approved rows, sorted");
  const card = cards[`sig-${code("Sant Genís dels Agudells")}`];
  assert.deepEqual(card.mechanisms, ["observed_impact", "slope_runoff"]);
  assert.match(card.whatCouldFail, /^On 4 and 5 October 2026, 2 reviewed reports from Ajuntament de Barcelona and Betevé described slope runoff in Sant Genís dels Agudells\./);
  assert.ok(card.relatedZoneIds.includes("proof-sant-genis-2026-10"), "proof duplicate is linked, not redrawn");
  const qa = run(dir, "scripts/qa.mjs");
  assert.equal(qa.status, 0, qa.stderr + qa.stdout);
});

test("build fails on a host off the allowlist, on stored post text and on a duplicate signal_id", () => {
  for (const bad of [[row({ source_url: "https://www.reddit.com/r/barcelona/x" })], [row({ text: "copied post text" })], [row({}), row({})]]) {
    assert.equal(run(sandbox(bad), "scripts/signals-build.mjs").status, 1, JSON.stringify(bad).slice(0, 80));
  }
});

test("approve refuses an expired stub; --add publishes it instead and the build stays green", () => {
  const url = "https://beteve.cat/fixture-written-for-the-test/";
  const dir = sandbox([{ signal_id: signalId("press", url), review: { status: "expired", by: null, at: "2026-10-07T10:00Z", reason: "not reviewed in time" } }]);
  const before = readFileSync(join(dir, "signals/pending.local.jsonl"), "utf8");
  const ok = run(dir, "scripts/signals.mjs", "--approve", signalId("press", url), "--mechanism", "slope_runoff", "--barri", "Sant Genís dels Agudells", "--by", "R0");
  assert.equal(ok.status, 1);
  assert.match(ok.stderr, /--add/);
  assert.equal(readFileSync(join(dir, "signals/pending.local.jsonl"), "utf8"), before, "pending file untouched");
  const added = run(dir, "scripts/signals.mjs", "--add", url, "--barri", "Sant Genís dels Agudells", "--mechanism", "slope_runoff", "--date", "2026-10-04T09:12Z", "--by", "R0");
  assert.equal(added.status, 0, added.stderr);
  assert.equal(lines(dir, "signals/reviewed.jsonl").length, 1, "the approved row is committed");
  assert.equal(lines(dir, "signals/pending.local.jsonl").length, 0, "the stub is replaced, not duplicated");
  assert.equal(run(dir, "scripts/signals-build.mjs").status, 0);
  assert.equal(run(dir, "scripts/signals.mjs", "--add", `${url}?utm_source=x`, "--barri", "Sant Genís dels Agudells", "--mechanism", "slope_runoff", "--date", "2026-10-04T09:12Z", "--by", "R0").status, 1, "same page twice");
});

test("qa passes with an empty inbox", () => {
  const dir = sandbox([]);
  execFileSync(process.execPath, ["scripts/signals-build.mjs"], { cwd: dir });
  assert.equal(run(dir, "scripts/qa.mjs").status, 0);
});

// Offline ingest: fetch is stubbed before signals.mjs loads. Fixture items are written for this test, never fetched.
// Every URL the script asks for is logged, so a test can prove what would have left the machine.
const FETCH_STUB = `import { appendFileSync } from "node:fs";
globalThis.fetch = async (url) => {
  url = String(url);
  appendFileSync(process.env.FETCH_LOG, url + "\\n");
  if (url.startsWith("https://ajuntament.barcelona.cat/premsa/wp-json/")) return Response.json([{ id: 1, date_gmt: "2026-10-08T08:00:00",
    link: "https://ajuntament.barcelona.cat/premsa/fixture-written-for-the-test/",
    title: { rendered: "Fixture: carrers inundats a Sant Andreu" }, excerpt: { rendered: "<p>Fixture text written for this test.</p>" } }], { headers: { "x-wp-totalpages": "1" } });
  if (url.startsWith("https://beteve.cat/")) return new Response("<rss><channel></channel></rss>");
  if (url.startsWith("https://api.typesafe.ai/")) return Response.json({ answers: { mechanism: { choice: "street_overflow", confidence: 0.5 } } });
  return new Response("", { status: 404 }); // rain and warning feeds: offline, the script falls back
};
`;
function ingest(dir, env = {}) {
  writeFileSync(join(dir, "fetch-stub.mjs"), FETCH_STUB);
  const log = join(dir, "fetch.log");
  writeFileSync(log, "");
  const res = spawnSync(process.execPath, ["--import", "./fetch-stub.mjs", "scripts/signals.mjs"], { cwd: dir, encoding: "utf8", env: { ...process.env, FETCH_LOG: log, ...env } });
  assert.equal(res.status, 0, res.stderr);
  return readFileSync(log, "utf8").split("\n").filter(Boolean);
}

test("storage split: unreviewed rows stay in a gitignored file, only decisions are committed", () => {
  const dir = sandbox([]);
  const inboxBefore = readFileSync(join(dir, "signals/inbox.jsonl"), "utf8");
  ingest(dir);
  const pending = lines(dir, "signals/pending.local.jsonl");
  assert.equal(pending?.length, 1, "the fixture item is a pending row in the local file");
  assert.equal(pending[0].review.status, "pending");
  assert.ok(!JSON.stringify(pending[0]).includes("Fixture text"), "no title or excerpt text is stored");
  assert.deepEqual(lines(dir, "signals/reviewed.jsonl"), [], "nothing unreviewed reaches the committed file");
  assert.equal(readFileSync(join(dir, "signals/inbox.jsonl"), "utf8"), inboxBefore, "the retired inbox is not written");
  const rej = run(dir, "scripts/signals.mjs", "--reject", pending[0].signal_id, "--reason", "Not about flooding.", "--by", "R0");
  assert.equal(rej.status, 0, rej.stderr);
  assert.deepEqual(lines(dir, "signals/pending.local.jsonl"), []);
  const [stub] = lines(dir, "signals/reviewed.jsonl");
  assert.deepEqual(Object.keys(stub).sort(), ["review", "signal_id"], "a rejection is committed without its link");
  assert.equal(stub.review.reason, "Not about flooding.");
  for (const p of ["signals/pending.local.jsonl", "signals/counts.json"])
    assert.equal(spawnSync("git", ["check-ignore", "-q", p]).status, 0, `${p} is gitignored`);
  assert.equal(spawnSync("git", ["check-ignore", "-q", "signals/reviewed.jsonl"]).status, 1, "reviewed.jsonl is committed");
});

test("place guard: a barri the title and excerpt never named needs --place-on-page", () => {
  const pending = { review: { status: "pending", by: null, at: null, reason: null, mechanism: null } };
  const citywide = row({ signal_id: "00000000000000a1", place: { level: "none", barri: null, candidates: [] }, ...pending });
  const named = row({ signal_id: "00000000000000a2", source_url: "https://beteve.cat/fixture-two/", place: { level: "barri", barri: null, candidates: [code("Sant Genís dels Agudells")] }, ...pending });
  const dir = sandbox([citywide, named]);
  const before = readFileSync(join(dir, "signals/pending.local.jsonl"), "utf8");
  const approve = (id, ...extra) => run(dir, "scripts/signals.mjs", "--approve", id, "--mechanism", "street_overflow", "--by", "R0", ...extra);
  const refused = approve(citywide.signal_id, "--barri", "Sant Andreu");
  assert.equal(refused.status, 1, "a citywide release cannot be pinned to a barri it never names");
  assert.match(refused.stderr, /Sant Andreu is not named.*--place-on-page/s);
  assert.equal(readFileSync(join(dir, "signals/pending.local.jsonl"), "utf8"), before, "nothing written");
  assert.deepEqual(lines(dir, "signals/reviewed.jsonl"), []);
  assert.equal(approve(named.signal_id, "--barri", "Sant Andreu").status, 1, "a different barri from the one named");
  assert.equal(approve(named.signal_id, "--barri", "Sant Genís Agudells").status, 0, "an alias of the named barri passes");
  const over = approve(citywide.signal_id, "--barri", "Sant Andreu", "--place-on-page");
  assert.equal(over.status, 0, over.stderr);
  const rows = Object.fromEntries(lines(dir, "signals/reviewed.jsonl").map((r) => [r.signal_id, r]));
  assert.equal(rows[citywide.signal_id].place.barri, code("Sant Andreu"));
  assert.equal(rows[citywide.signal_id].place.checked_on_page_by, "R0", "the override records who read the page");
  assert.equal(rows[named.signal_id].place.checked_on_page_by, undefined);
});

test("Jev gate: with sendTextToJev false, a key alone sends nothing", () => {
  const key = { TYPESAFE_API_KEY: "test-key-not-real" };
  const off = ingest(sandbox([]), key);
  assert.ok(off.some((u) => u.startsWith("https://ajuntament.barcelona.cat/")), "the stub saw the feed read");
  assert.deepEqual(off.filter((u) => u.includes("typesafe")), [], "no call to TypeSafe");
  assert.equal(JSON.parse(readFileSync("signals/config.json", "utf8")).sendTextToJev, false, "committed default is off");
  const dir = sandbox([]);
  const cfg = JSON.parse(readFileSync(join(dir, "signals/config.json"), "utf8"));
  writeFileSync(join(dir, "signals/config.json"), JSON.stringify({ ...cfg, sendTextToJev: true }));
  assert.ok(ingest(dir, key).some((u) => u.includes("typesafe")), "flag and key together do call it (the stub answers)");
  assert.deepEqual(ingest(sandbox([]), { TYPESAFE_API_KEY: "" }).filter((u) => u.includes("typesafe")), []);
});

test("publish window: SIGNALS_NOW decides what a build keeps; README says so", () => {
  const dir = sandbox([row({})]); // published 2026-10-04
  const build = (now) => {
    assert.equal(spawnSync(process.execPath, ["scripts/signals-build.mjs"], { cwd: dir, env: { ...process.env, SIGNALS_NOW: now } }).status, 0);
    return JSON.parse(readFileSync(join(dir, "data/geojson/signals.geojson"), "utf8")).features.length;
  };
  assert.equal(build("2026-10-08T12:00:00Z"), 1, "demo time inside the window");
  assert.equal(build("2026-10-12T12:00:00Z"), 0, "a rebuild more than 7 days later drops the row");
  assert.match(readFileSync("signals/README.md", "utf8"), /SIGNALS_NOW[^\n]*demo/);
});
