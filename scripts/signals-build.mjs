// Approved, allowlisted rows in signals/inbox.jsonl -> data/geojson/signals.geojson + data/signals-cards.json.
// Always writes both files (empty when nothing is approved). Exits 1 on a malformed row, which stops dev, build and qa.
// Both outputs are generated and gitignored. SIGNALS_NOW=<ISO> pins the window for tests and replays.
import { readFileSync, writeFileSync } from "node:fs";
import { buildPublished, sha } from "./signals-lib.mjs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
try {
  const config = read("signals/config.json");
  const gazText = readFileSync("signals/gazetteer.json", "utf8");
  const rows = readFileSync("signals/inbox.jsonl", "utf8").split("\n").filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`signals/inbox.jsonl line ${i + 1} is not JSON`); }
  });
  const now = process.env.SIGNALS_NOW ? Date.parse(process.env.SIGNALS_NOW) : Date.now();
  const { geojson, cards } = buildPublished({
    rows,
    gaz: JSON.parse(gazText),
    allowlist: read("signals/allowlist.json"),
    zones: read("data/zones.json"),
    now,
    windowDays: config.windowDays,
    meta: { schema: "signals-v1", generated_at: new Date(now).toISOString().slice(0, 16) + "Z", window_days: config.windowDays, gazetteer: sha(gazText).slice(0, 8), pipeline: "scripts/signals-build.mjs" },
  });
  writeFileSync("data/geojson/signals.geojson", JSON.stringify(geojson) + "\n");
  writeFileSync("data/signals-cards.json", JSON.stringify(cards, null, 1) + "\n");
  console.log(`signals-build: ${geojson.features.length} barri feature(s) from ${rows.length} inbox row(s)`);
} catch (error) {
  console.error(`signals-build failed: ${error.message}`);
  process.exit(1);
}
