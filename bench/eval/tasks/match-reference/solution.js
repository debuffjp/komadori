// The reference fix, used only to test the harness: the target scene itself.
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
copyFileSync(join(dirname(fileURLToPath(import.meta.url)), "target.js"), process.argv[2]);
