import { cpSync, existsSync, rmSync } from "node:fs";

rmSync("public/data", { recursive: true, force: true });
cpSync("data", "public/data", { recursive: true });

// The backend writes this report locally and backend/outputs/ is gitignored, so a fresh
// checkout does not have it. Skip it: the build report panel says how to generate it.
const report = "backend/outputs/inputs/bcn_30m.report.json";
if (existsSync(report)) cpSync(report, "public/data/bcn_30m.report.json");
else console.log(`copy-data: no ${report}, skipping the build report`);
