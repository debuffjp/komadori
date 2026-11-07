// The reference fix, used only to test the harness: move the light's loop down so it never passes behind the title.
import { readFileSync, writeFileSync } from "node:fs";
const f = process.argv[2];
writeFileSync(f, readFileSync(f, "utf8").replace("const gy = 290 - 190 * Math.cos(t);", "const gy = 380 - 150 * Math.cos(t);"));
