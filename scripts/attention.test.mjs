// node --test scripts/attention.test.mjs : offline. fetch is stubbed; every response below is written for the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Responses carry names, titles and URLs that must never reach the output file.
const SECRETS = ["FixtureUploader", "Fixture person in the street", "fixture-news.example", "Fixture headline"];
const STUB = (gdeltStatus) => `
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (!/^next-rain-hackathon\\/0\\.1 \\(hackathon prototype\\)$/.test(init?.headers?.["User-Agent"] ?? "")) return new Response("", { status: 403 });
  if (url.includes("/pageviews/")) return Response.json({ items: [
    { article: "x", timestamp: "2026092600", views: 10 }, { article: "x", timestamp: "2026100400", views: 90 } ] });
  if (url.includes("gdeltproject")) return ${gdeltStatus} === 200
    ? Response.json({ timeline: [{ series: "Article Count", data: [
        { date: "20261003T000000Z", value: 4, norm: 9000, toparts: [{ url: "https://fixture-news.example/a", title: "Fixture headline" }] },
        { date: "20261003T120000Z", value: 6, norm: 9000 } ] }] })
    : new Response("slow down", { status: ${gdeltStatus} });
  if (url.includes("commons.wikimedia.org")) return Response.json({ query: { pages: {
    "1": { title: "File:Fixture person in the street.jpg", imageinfo: [{ timestamp: "2026-10-06T10:00:00Z", user: "FixtureUploader" }] },
    "2": { title: "File:Other.jpg", imageinfo: [{ timestamp: "2026-10-06T11:00:00Z", user: "FixtureUploader" }] } } } });
  return new Response("", { status: 404 });
};`;

function run(gdeltStatus, previous) {
  const dir = mkdtempSync(join(tmpdir(), "attention-check-"));
  cpSync("scripts", join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "data"));
  if (previous) writeFileSync(join(dir, "data/attention.json"), JSON.stringify(previous));
  writeFileSync(join(dir, "stub.mjs"), STUB(gdeltStatus));
  const r = spawnSync(process.execPath, ["--import", "./stub.mjs", "scripts/attention.mjs"],
    { cwd: dir, encoding: "utf8", env: { ...process.env, ATTENTION_NO_WAIT: "1" } });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(join(dir, "data/attention.json"), "utf8");
  return { text, out: JSON.parse(text), stderr: r.stderr };
}

function checkSchema(out) {
  assert.deepEqual(Object.keys(out).sort(), ["generated_at", "schema", "series"]);
  assert.equal(out.schema, "attention-v1");
  assert.match(out.generated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/);
  for (const s of out.series) {
    assert.deepEqual(Object.keys(s).sort(), ["id", "label", "points", "source", "source_url", "unit"]);
    assert.match(s.source_url, /^https:\/\//);
    assert.equal(s.points.length, 14);
    for (const p of s.points) {
      assert.deepEqual(Object.keys(p).sort(), ["t", "v"]);
      assert.match(p.t, /^\d{4}-\d\d-\d\d$/);
      assert.ok(Number.isInteger(p.v) && p.v >= 0, `${s.id} ${p.t} is a count`);
    }
  }
}

test("writes the attention-v1 schema with counts only", () => {
  const { text, out } = run(200);
  checkSchema(out);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `output leaks "${secret}"`);
  const by = Object.fromEntries(out.series.map((s) => [s.id, Object.fromEntries(s.points.map((p) => [p.t, p.v]))]));
  assert.equal(by.wikipedia["2026-10-04"], 90 * 6, "sum of six articles");
  assert.equal(by.wikipedia["2026-09-27"], 0, "a day the API leaves out is zero");
  assert.equal(by.gdelt["2026-10-03"], 10, "GDELT buckets summed per day");
  assert.equal(by.commons["2026-10-06"], 2);
});

test("a failed source keeps its previous series and the run still writes", () => {
  const old = run(200).out;
  const { out, stderr } = run(429, old);
  checkSchema(out);
  assert.match(stderr, /gdelt: failed \(HTTP 429/);
  assert.deepEqual(out.series.find((s) => s.id === "gdelt"), old.series.find((s) => s.id === "gdelt"));
});
