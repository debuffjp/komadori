// The reference fix, used only to test the harness: the three bugs, repaired.
import { readFileSync, writeFileSync } from "node:fs";
const f = process.argv[2];
let t = readFileSync(f, "utf8");
t = t.replace(/\bsample\b/g, "dist").replace("vec3 tint = vec4(0.3, 0.6, 1.0, 1.0);", "vec3 tint = vec3(0.3, 0.6, 1.0);").replace("smoothstep(0.7, dist + wave)", "smoothstep(0.0, 0.7, dist + wave)");
writeFileSync(f, t);
