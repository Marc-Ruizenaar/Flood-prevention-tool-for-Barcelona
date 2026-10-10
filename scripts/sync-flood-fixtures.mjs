/**
 * Pull streets, hotspots, daily, and mitigation from the flood API into data/flood/{runId}/,
 * then copy data/ → public/data/ (same as predev/prebuild).
 * Run while the backend is up: node scripts/sync-flood-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const API = (process.env.VITE_API_URL || process.env.API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const RUN_ID = process.env.VITE_RUN_ID || process.env.RUN_ID || "urgell-2026-10-02_03";
const FALLBACK_DAYS = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];

const root = join(process.cwd(), "data", "flood", RUN_ID);
const streetsDir = join(root, "streets");
const hotspotsDir = join(root, "hotspots");
mkdirSync(streetsDir, { recursive: true });
mkdirSync(hotspotsDir, { recursive: true });

function sim(path) {
  return `${API}/simulations/${encodeURIComponent(RUN_ID)}${path}`;
}

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

function copyToPublic() {
  const copyScript = join(process.cwd(), "scripts", "copy-data.mjs");
  const result = spawnSync(process.execPath, [copyScript], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("copy-data.mjs failed — public/data was not updated.");
  }
}

function write(name, data) {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify(data)}\n`);
  console.log("wrote", path);
}

async function main() {
  console.log(`Syncing ${RUN_ID} from ${API}…`);

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

  copyToPublic();
  console.log("Done. public/data updated.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
