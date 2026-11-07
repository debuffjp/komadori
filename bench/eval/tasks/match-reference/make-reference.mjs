// Renders target.js once and writes reference.png: the picture the agent is asked to match.
//   SPRYTE_CHECKOUT=<debuff checkout> node bench/eval/tasks/match-reference/make-reference.mjs
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../../../../src/render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(tmpdir(), "komadori-make-reference");
mkdirSync(dir, { recursive: true });
cpSync(join(here, "index.html"), join(dir, "index.html"));
cpSync(join(here, "target.js"), join(dir, "scene.js"));
cpSync(join(process.env.SPRYTE_CHECKOUT, "packages/spryte/dist"), join(dir, "spryte"), { recursive: true });
const r = await render({ target: dir, frames: 2, samples: 1, size: "960x540" });
writeFileSync(join(here, "reference.png"), Buffer.from(r.shots[r.shots.length - 1].png, "base64"));
console.log("wrote reference.png");
