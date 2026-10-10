import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, "../fixtures");
const examples = join(here, "../../backend/examples");
mkdirSync(dest, { recursive: true });

for (const name of ["streets_day", "hotspots_day"]) {
  copyFileSync(join(examples, `${name}.geojson`), join(dest, `${name}.json`));
}
