// node --test scripts/pulse.test.mjs : offline. fetch is stubbed; every post below is written for the test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OPTED = "did:plc:fixtureoptedout";
const post = (id, text, did = `did:plc:fixture${id}`) => ({ uri: `at://${did}/app.bsky.feed.post/${id}`, author: { did, handle: `person${id}.bsky.social` }, record: { text } });
// Per hour: "pluja" 6 posts (one injury, one opted out), "lluvia" 2 (one repeats a1) -> 5 counted. Flood words: 2 -> hidden.
const STUB = `import { appendFileSync } from "node:fs";
const post = ${post.toString()};
globalThis.fetch = async (url, init) => {
  url = String(url);
  appendFileSync(process.env.FETCH_LOG, url + " UA=" + (init?.headers?.["User-Agent"] ?? "") + "\\n");
  const q = new URL(url).searchParams.get("q") ?? "";
  if (url.includes("resolveHandle")) return Response.json({ did: "${OPTED}" });
  if (q.endsWith("pluja")) return Response.json({ posts: [post("a1", "Pluja forta"), post("a2", "Un ferit per la pluja"), post("a3", "Pluja", "${OPTED}"),
    post("a4", "pluja"), post("a5", "pluja"), post("a6", "pluja")] });
  if (q.endsWith("lluvia")) return Response.json({ posts: [post("a1", "Pluja forta"), post("a7", "Lluvia")] });
  if (q.includes("inundaci")) return Response.json({ posts: [post("f1", "carrer inundat"), post("f2", "inundación")] });
  return new Response("", { status: 404 });
};
`;

function sandbox(cfg = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pulse-check-"));
  for (const p of ["signals", "scripts"]) cpSync(p, join(dir, p), { recursive: true });
  mkdirSync(join(dir, "data"));
  const base = JSON.parse(readFileSync("signals/pulse.json", "utf8"));
  writeFileSync(join(dir, "signals/pulse.json"), JSON.stringify({ ...base, hours: 3, ...cfg }));
  writeFileSync(join(dir, "signals/pulse-optout.json"), JSON.stringify({ did_sha256: [createHash("sha256").update(OPTED).digest("hex")] }));
  writeFileSync(join(dir, "stub.mjs"), STUB);
  writeFileSync(join(dir, "fetch.log"), "");
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, ["--import", "./stub.mjs", "scripts/pulse.mjs", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, FETCH_LOG: join(dir, "fetch.log") } });
const fetched = (dir) => readFileSync(join(dir, "fetch.log"), "utf8").split("\n").filter(Boolean);

test("off by default: no request, no file", () => {
  const dir = sandbox();
  const res = run(dir);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /pulse is off/);
  assert.deepEqual(fetched(dir), []);
  assert.equal(JSON.parse(readFileSync("signals/pulse.json", "utf8")).enabled, false, "committed default is off");
});

test("counts only: dedupe, health and opt-out dropped, small counts hidden, nothing about a person written", () => {
  const dir = sandbox();
  const res = run(dir, "--force");
  assert.equal(res.status, 0, res.stderr);
  const text = readFileSync(join(dir, "data/pulse.json"), "utf8");
  const out = JSON.parse(text);
  assert.equal(out.hours.length, 3);
  assert.ok(out.hours.every((h) => h.rain === 5), "6 + 2 posts, minus a repeat, an injury and an opted-out account");
  assert.ok(out.hours.every((h) => h.flood === null), "2 posts an hour is under 5: hidden");
  assert.deepEqual(out.last3h, { rain: 15, flood: null }, "hidden hours never add up to a visible 0");
  assert.equal(out.level, "high");
  for (const leak of ["did:", "at://", "bsky.social", "person", "ferit", "Pluja forta"]) assert.ok(!text.includes(leak), `no ${leak} in the output`);
  assert.ok(fetched(dir).every((l) => l.includes("UA=next-rain-hackathon")), "identifiable User-Agent on every request");
});

test("a full page marks the group as a lower bound", () => {
  const dir = sandbox({ groups: { rain: ["Barcelona pluja"] } });
  writeFileSync(join(dir, "stub.mjs"), STUB.replace(`if (q.endsWith("pluja"))`, `if (q.endsWith("pluja")) return Response.json({ posts: Array.from({ length: 100 }, (_, i) => post("p" + i, "pluja")) });\n  if (false)`));
  assert.equal(run(dir, "--force").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "data/pulse.json"), "utf8")).capped, ["rain"]);
});

test("--optout stores a hash, never the handle or DID", () => {
  const dir = sandbox();
  writeFileSync(join(dir, "signals/pulse-optout.json"), JSON.stringify({ did_sha256: [] }));
  const res = run(dir, "--optout", "@someone.bsky.social");
  assert.equal(res.status, 0, res.stderr);
  const text = readFileSync(join(dir, "signals/pulse-optout.json"), "utf8");
  assert.deepEqual(JSON.parse(text).did_sha256, [createHash("sha256").update(OPTED).digest("hex")]);
  assert.ok(!text.includes("did:") && !text.includes("someone"));
});

test("--until and --hours replay a past window and say so", () => {
  const dir = sandbox();
  const res = run(dir, "--force", "--until", "2026-10-08T00:00Z", "--hours", "5");
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(readFileSync(join(dir, "data/pulse.json"), "utf8"));
  assert.equal(out.replay, true);
  assert.deepEqual(out.window, { from: "2026-10-07T19:00Z", to: "2026-10-08T00:00Z" });
  assert.deepEqual(out.hours.map((h) => h.hour), ["2026-10-07T19:00Z", "2026-10-07T20:00Z", "2026-10-07T21:00Z", "2026-10-07T22:00Z", "2026-10-07T23:00Z"]);
  const asked = fetched(dir).filter((l) => l.includes("searchPosts")).map((l) => new URL(l.split(" ")[0]).searchParams.get("since"));
  assert.equal(asked[0], "2026-10-07T19:00:00.000Z", "requests cover the replay window, not now");
  assert.equal(run(dir, "--force", "--hours", "999").status, 1, "a runaway window is refused");
});
