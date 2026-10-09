import { cpSync, rmSync } from "node:fs";

rmSync("public/data", { recursive: true, force: true });
cpSync("data", "public/data", { recursive: true });
