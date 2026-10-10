/**
 * Pull streets, hotspots, daily, and mitigation from the flood API into data/flood/{runId}/
 * for each run (chunk), slim the street files and rebuild data/flood/index.json, then copy
 * data/ → public/data/ (same as predev/prebuild).
 * Run while the backend is up: RUN_ID=<run-id> node scripts/sync-flood-fixtures.mjs
 * Several areas at once: RUN_IDS=<id-a>,<id-b> node scripts/sync-flood-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const API = (process.env.VITE_API_URL || process.env.API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const RUN_ID = process.env.VITE_RUN_ID || process.env.RUN_ID || "urgell-2026-10-02_03";
const RUN_IDS = (process.env.RUN_IDS || RUN_ID).split(",").map((s) => s.trim()).filter(Boolean);
const FALLBACK_DAYS = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];

const FETCH_MS = Number(process.env.SYNC_FETCH_MS || 120_000);

async function getJson(url, { optional = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${url}\n${text.slice(0, 400)}`);
    }
    return response.json();
  } catch (error) {
    if (optional) {
      console.warn(`Skipping optional ${url}:`, error instanceof Error ? error.message : error);
      return null;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function slimFlood() {
  const slimScript = join(process.cwd(), "scripts", "slim-flood.mjs");
  const result = spawnSync(process.execPath, [slimScript], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("slim-flood.mjs failed: data/flood/index.json was not rebuilt.");
  }
}

function copyToPublic() {
  const copyScript = join(process.cwd(), "scripts", "copy-data.mjs");
  const result = spawnSync(process.execPath, [copyScript], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("copy-data.mjs failed: public/data was not updated.");
  }
}

async function syncRun(runId) {
  const root = join(process.cwd(), "data", "flood", runId);
  mkdirSync(join(root, "streets"), { recursive: true });
  mkdirSync(join(root, "hotspots"), { recursive: true });
  const sim = (path) => `${API}/simulations/${encodeURIComponent(runId)}${path}`;
  const write = (name, data) => {
    const path = join(root, name);
    writeFileSync(path, `${JSON.stringify(data)}\n`);
    console.log("wrote", path);
  };

  console.log(`Syncing ${runId} from ${API}…`);

  let days = FALLBACK_DAYS;
  try {
    const daily = await getJson(sim("/daily"));
    const fromDaily = daily.map((row) => String(row.date_local).slice(0, 10)).filter(Boolean);
    if (fromDaily.length) days = fromDaily;
  } catch (error) {
    console.warn("Could not read /daily; using fallback day list.", error.message);
  }

  for (const day of days) {
    const streets = await getJson(sim(`/streets?date=${day}`));
    write(`streets/${day}.json`, streets);
    const hotspots = await getJson(sim(`/hotspots?date=${day}&limit=10`));
    write(`hotspots/${day}.json`, hotspots);
  }

  write("daily.json", await getJson(sim("/daily")));

  const mitigation = await getJson(sim("/mitigation"), { optional: true });
  if (mitigation) {
    write("mitigation.json", mitigation);
  } else {
    console.warn("No mitigation.json (endpoint slow or unavailable). Model panel mitigation stays empty.");
  }
}

async function main() {
  for (const runId of RUN_IDS) await syncRun(runId);
  slimFlood();
  copyToPublic();
  console.log("Done. public/data updated.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
