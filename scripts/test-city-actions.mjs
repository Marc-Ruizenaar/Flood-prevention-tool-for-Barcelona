/**
 * Smoke test for deriveCityActions on bundled urgell 2026-10-03 data.
 * Run: npm run test:city-actions
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const streetsPath = join(root, "data/flood/urgell-2026-10-02_03/streets/2026-10-03.json");
const hotspotsPath = join(root, "data/flood/urgell-2026-10-02_03/hotspots/2026-10-03.json");

const runner = `
import { readFileSync } from "node:fs";
import { deriveCityActions } from ${JSON.stringify(pathToFileURL(join(root, "src/lib/cityActions.ts")).href)};
const streets = JSON.parse(readFileSync(${JSON.stringify(streetsPath)}, "utf8"));
const hotspots = JSON.parse(readFileSync(${JSON.stringify(hotspotsPath)}, "utf8"));
const actions = deriveCityActions(streets, hotspots, 10);
if (!actions.length) {
  console.error("FAIL: expected at least one city action");
  process.exit(1);
}
const blob = actions.map((a) => a.title + " " + a.locationLabel).join("\\n");
for (const token of ["La Rambla", "Diagonal", "Ronda"]) {
  if (!blob.includes(token)) {
    console.error("FAIL: expected an action mentioning " + token);
    process.exit(1);
  }
}
console.log("OK: " + actions.length + " actions");
for (const [i, action] of actions.entries()) {
  console.log((i + 1) + ". [" + action.category + "] " + action.title);
}
`;

// The runner goes in a temp file, not `-e`: on Windows npx is a .cmd shim that needs a shell,
// and a shell would mangle a multi-line -e argument.
const dir = mkdtempSync(join(tmpdir(), "city-actions-"));
const file = join(dir, "run.mts");
writeFileSync(file, runner);
const win = process.platform === "win32";
const result = spawnSync("npx", ["--yes", "tsx", win ? `"${file}"` : file], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
  shell: win,
});
rmSync(dir, { recursive: true, force: true });
if (result.error) console.error(`FAIL: could not start tsx (${result.error.message})`);

process.exit(result.status ?? 1);
