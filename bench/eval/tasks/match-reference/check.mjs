// Hidden check: render scene.js and compare it with reference.png pixel by pixel. It passes when at most 3% of the
// pixels differ visibly (by more than 8 levels) and the mean difference is 8 out of 255 or less. Those limits sit
// between a scene that is off by a few pixels and a couple of colour levels (about 2% and 4.8: passes) and one that is
// off by 10 to 20 pixels and 10% in size (about 7% and 17: fails). The unmatched start scene is 99.9% and 30.5.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const files = ["index.html", "scene.js", "reference.png"];
const here = dirname(fileURLToPath(import.meta.url));
export default async function check({ dir, render, compare }) {
  // The scene has to draw the picture, not load it: drawing reference.png would match it exactly.
  if (/reference/i.test(readFileSync(join(dir, "scene.js"), "utf8"))) return { pass: false, score: 100, detail: "scene.js refers to the reference image: it has to draw the picture itself" };
  const r = await render({ target: dir, frames: 2, samples: 1, size: "960x540" });
  if (!r.shots?.length) return { pass: false, detail: `no frame rendered (${r.report?.failures?.join("; ") ?? "?"})` };
  const ref = readFileSync(join(here, "reference.png")).toString("base64");
  const c = await compare(ref, r.shots[r.shots.length - 1].png);
  const changed = c.changed * 100;
  return {
    pass: changed <= 3 && c.mean <= 8,
    // Lower is better: the share of pixels that visibly differ from the reference.
    score: Number(changed.toFixed(2)),
    detail: `${changed.toFixed(2)}% of pixels differ visibly from the reference (needs 3% or less), mean difference ${c.mean.toFixed(2)}/255 (needs 8 or less)`,
  };
}
