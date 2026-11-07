// The reference fix, used only to test the harness: a font size that fills the width with 24px margins.
import { readFileSync, writeFileSync } from "node:fs";
const f = process.argv[2];
writeFileSync(f, readFileSync(f, "utf8").replace("bold 300px sans-serif", "bold 215px sans-serif"));
