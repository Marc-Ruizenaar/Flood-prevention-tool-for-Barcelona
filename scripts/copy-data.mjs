import { cpSync, rmSync } from "node:fs";

rmSync("public/data", { recursive: true, force: true });
cpSync("data", "public/data", { recursive: true });
cpSync(
  "backend/outputs/inputs/bcn_30m.report.json",
  "public/data/bcn_30m.report.json",
);
