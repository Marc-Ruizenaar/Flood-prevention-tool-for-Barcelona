/**
 * Unit test for the chunk helpers in src/lib/chunks.ts.
 * Run: npm run test:chunks
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const runner = `
import assert from "node:assert/strict";
import { MAX_CHUNKS, chunksFor, insideAny, mergeRanked, runBoxes } from "./src/lib/chunks.ts";

const day = "2026-10-03";
const chunk = (id, bbox, days = [day]) => ({ id, days, bbox });
const index = {
  runs: [
    chunk("far", [10, 10, 11, 11]),
    chunk("near", [0.4, 0.4, 0.6, 0.6]),
    chunk("mid", [0.9, 0.9, 1.5, 1.5]),
    chunk("other-day", [0.4, 0.4, 0.6, 0.6], ["2026-10-02"]),
    chunk("nobox", null),
  ],
};
const view = [0, 0, 1, 1];

const ids = chunksFor(index, day, view).map((c) => c.id);
assert.deepEqual(ids, ["nobox", "near", "mid"], "intersecting chunks only, nearest first, bbox null always in");
assert.deepEqual(chunksFor(index, day, null).map((c) => c.id), ["far", "near", "mid", "nobox"], "all chunks for the day without a view");
assert.deepEqual(chunksFor(index, "2026-10-02", view).map((c) => c.id), ["other-day"], "day filter applies");

const off = { runs: [chunk("on", [0.4, 0.4, 0.6, 0.6]), { ...chunk("off", [0.4, 0.4, 0.6, 0.6]), enabled: false }] };
assert.deepEqual(chunksFor(off, day, view).map((c) => c.id), ["on"], "enabled: false chunks are skipped");
assert.equal(runBoxes(off).length, 1, "disabled chunks draw no outline");

const many = { runs: Array.from({ length: MAX_CHUNKS + 3 }, (_, i) => chunk("c" + i, [0, 0, 1, 1])) };
assert.equal(chunksFor(many, day, view).length, MAX_CHUNKS, "capped at MAX_CHUNKS");
assert.equal(chunksFor(many, day, null).length, MAX_CHUNKS, "capped without a view too");

const boxes = [[0, 0, 1, 1], [5, 5, 6, 6]];
assert.equal(insideAny(boxes, [0.5, 0.5]), true);
assert.equal(insideAny(boxes, [5, 6]), true, "edges count as inside");
assert.equal(insideAny(boxes, [2, 2]), false);
assert.equal(insideAny([], [0.5, 0.5]), false);

const f = (rank, value) => ({ type: "Feature", properties: { rank, score: value == null ? undefined : { value } } });
const merged = mergeRanked([[f(1, 0.4), f(2, 0.1)], [f(1, 0.9), f(2, null)]]);
assert.deepEqual(merged.map((x) => x.properties.score?.value), [0.9, 0.4, 0.1, undefined], "score desc, missing last");
assert.deepEqual(merged.map((x) => x.properties.rank), [1, 2, 3, 4], "ranks renumbered 1..n");

console.log("OK: chunks helpers");
`;

const result = spawnSync("npx", ["--yes", "tsx", "-e", runner], { cwd: root, encoding: "utf8", stdio: "inherit" });
process.exit(result.status ?? 1);
