// Golden frames: reference frames saved with `komadori approve`, and the comparison a later run makes against them.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compareMany } from "./image.mjs";

/**
 * Limits on how far a frame may differ from its golden one, as a mean difference out of 255 and a share of pixels
 * (0 to 1) that differ by more than 8 levels. Set from measurements, not from hope: on spryte's rain and warp scenes
 * at 1080p, two runs on the same renderer differ by exactly 0, and across a Radeon, an RTX (both Direct3D) and
 * Vulkan SwiftShader the worst frame differed by a mean of 0.153 and 0.057% of pixels.
 */
/** Same renderer as the golden frames: allow a few anti-aliased pixels, nothing more. */
export const SAME = { mean: 0.05, changed: 0.0001 };
/** Another renderer: about four times the worst difference measured across three very different ones. */
export const OTHER = { mean: 0.5, changed: 0.0025 };

const name = (i) => `frame-${String(i).padStart(4, "0")}.png`;

/** Write reference frames and golden.json into `dir`. */
export async function writeGolden(dir, meta, shots) {
  await mkdir(dir, { recursive: true });
  for (const s of shots) await writeFile(join(dir, name(s.i)), Buffer.from(s.png, "base64"));
  await writeFile(join(dir, "golden.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

/** Read reference frames back: the meta, and each sampled frame as base64 PNG. */
export async function readGolden(dir) {
  const meta = JSON.parse(await readFile(join(dir, "golden.json"), "utf8"));
  const frames = new Map();
  for (const i of meta.sampled) frames.set(i, (await readFile(join(dir, name(i)))).toString("base64"));
  return { meta, frames };
}

/**
 * Compare a render's sampled frames with the golden ones in `dir`. Returns failures and warnings in the tool's
 * usual words, and writes golden-diff-NNNN.png (golden, now, difference) into `out` for each frame that is over.
 * `tolerance` (percent of pixels) replaces the share limit in both cases, and the mean limit rises with it.
 */
export async function checkGolden({ dir, out, renderer, size, frames, sampled, query, shots, tolerance }) {
  if (!existsSync(join(dir, "golden.json"))) return { failures: [`no golden frames in ${dir}: make them with komadori approve first`], warnings: [], summary: { dir, compared: 0 } };
  const { meta, frames: golden } = await readGolden(dir);
  const mine = { size, frames, sampled: sampled.join(","), query: query ?? "" };
  const theirs = { size: meta.size, frames: meta.frames, sampled: meta.sampled.join(","), query: meta.query ?? "" };
  const differs = Object.keys(mine).filter((k) => String(mine[k]) !== String(theirs[k]));
  if (differs.length)
    return {
      failures: [
        `the golden frames in ${dir} don't match this run's settings (${differs.map((k) => `${k}: golden has ${theirs[k] || "(none)"}, this run has ${mine[k] || "(none)"}`).join("; ")}). Run with the same options, or make new ones with komadori approve.`,
      ],
      warnings: [],
      summary: { dir, compared: 0 },
    };
  const sameRenderer = meta.renderer === renderer;
  const limits = { ...(sameRenderer ? SAME : OTHER) };
  // A share of changed pixels is also a mean difference (a pixel that is fully different adds up to 255), so allowing
  // more of them loosens the mean limit to match: 5% of the pixels may differ, and the mean may rise to 12.75/255.
  if (tolerance !== undefined) {
    limits.changed = tolerance / 100;
    limits.mean = Math.max(limits.mean, (tolerance / 100) * 255);
  }
  const warnings = sameRenderer
    ? []
    : [`the golden frames were made on ${meta.renderer} and this run is on ${renderer}: compared with looser limits (mean ${limits.mean}/255, ${(limits.changed * 100).toFixed(2)}% of pixels)`];
  const pairs = shots.map((s) => ({ a: golden.get(s.i), b: s.png }));
  const results = await compareMany(pairs, { images: "over", limits });
  const failures = [];
  const details = [];
  await mkdir(out, { recursive: true });
  for (let k = 0; k < shots.length; k++) {
    const r = results[k];
    const i = shots[k].i;
    if (r.mismatch) {
      failures.push(`frame ${i} is a different size from the golden frame (${r.mismatch})`);
      continue;
    }
    const over = r.mean > limits.mean || r.changed > limits.changed;
    details.push({ frame: i, changed: Number(r.changed.toFixed(6)), mean: Number(r.mean.toFixed(4)), box: r.box, ok: !over });
    if (!over) continue;
    const file = `golden-diff-${String(i).padStart(4, "0")}.png`;
    if (r.png) await writeFile(join(out, file), Buffer.from(r.png, "base64"));
    failures.push(
      `frame ${i} differs from the golden frame: ${(r.changed * 100).toFixed(2)}% of pixels changed (limit ${(limits.changed * 100).toFixed(2)}%), mean ${r.mean.toFixed(2)}/255${r.box ? `, changed region x=${r.box.x} y=${r.box.y} w=${r.box.w} h=${r.box.h}` : ""}; see ${file}`,
    );
  }
  return { failures, warnings, summary: { dir, compared: shots.length, sameRenderer, limits, frames: details } };
}
