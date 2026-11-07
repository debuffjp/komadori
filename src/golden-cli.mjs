// `komadori determinism` and `komadori approve`: a golden frame only means something if two runs of the scene give the
// same frames, so both render twice and compare. approve then saves the first run as the reference.
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { SAME, writeGolden } from "./golden.mjs";
import { compareMany } from "./image.mjs";
import { render, UsageError } from "./render.mjs";

async function twice(options, io) {
  const runs = [];
  for (const n of [1, 2]) {
    const out = await mkdtemp(join(tmpdir(), `komadori-run${n}-`));
    // The golden option is for a normal run; here both runs are plain, and quiet: the caller reports.
    const { golden: _g, goldenTolerance: _t, ...rest } = options;
    const r = await render({ ...rest, out, mp4: undefined, keepFrames: undefined, capture: undefined }, { log: () => {}, error: io.error });
    if (r.code === 2 || !r.shots) throw new UsageError("the scene could not be rendered, so it can't be checked");
    runs.push(r);
  }
  return runs;
}

/** Render twice and compare the sampled frames. Returns what differs. */
async function compareRuns(runs) {
  const [a, b] = runs;
  const results = await compareMany(a.shots.map((s, k) => ({ a: s.png, b: b.shots[k].png })), { images: "never", limits: SAME });
  const bad = [];
  results.forEach((r, k) => {
    if (r.mismatch || r.mean > SAME.mean || r.changed > SAME.changed) bad.push({ frame: a.shots[k].i, changed: r.changed ?? 1, mean: r.mean ?? 255, mismatch: r.mismatch });
  });
  return { total: results.length, bad };
}

const HOW =
  "Use a fixed step (1/60 s a frame) and seed any randomness, and nothing that depends on the real clock or on how many frames the machine managed.";

/** `komadori determinism`: render twice, say whether the sampled frames match. */
export async function determinism(options, io = {}) {
  const log = io.log ?? (() => {});
  const runs = await twice(options, io);
  const { total, bad } = await compareRuns(runs);
  if (!bad.length) {
    log(`deterministic: all ${total} sampled frames are the same in two runs`);
    return { code: 0, total, bad };
  }
  const f = bad[0];
  log(`NOT deterministic: ${bad.length} of ${total} sampled frames differ between two runs of the same scene. Frame ${f.frame}: ${(f.changed * 100).toFixed(2)}% of pixels changed. ${HOW}`);
  return { code: 1, total, bad };
}

/** `komadori approve`: save the sampled frames as golden frames, once the scene proves deterministic. */
export async function approve(options, io = {}) {
  const log = io.log ?? (() => {});
  const dir = resolve(options.golden ?? "golden");
  if (existsSync(join(dir, "golden.json")) && !options.yes)
    throw new UsageError(
      `${dir} already has golden frames. Replacing them changes what every later run is compared with, so look at the new frames first (a normal komadori run writes a contact sheet), then run this again with --yes.`,
    );
  const runs = await twice(options, io);
  const [first] = runs;
  if (first.code === 1)
    throw new UsageError(`the scene fails its own checks, so it can't be approved: ${first.report.failures.slice(0, 3).join(" | ")}`);
  const { total, bad } = await compareRuns(runs);
  if (bad.length)
    throw new UsageError(
      `the scene is not deterministic, so its frames can't be golden: ${bad.length} of ${total} sampled frames differ between two runs (frame ${bad[0].frame}: ${(bad[0].changed * 100).toFixed(2)}% of pixels). ${HOW}`,
    );
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const meta = {
    version: pkg.version,
    createdAt: new Date().toISOString(),
    renderer: first.report.renderer,
    size: first.report.size,
    frames: first.report.frames,
    sampled: first.report.sampled,
    query: options.query ?? "",
  };
  await writeGolden(dir, meta, first.shots);
  log(`approved: ${first.shots.length} golden frames in ${dir} (rendered on ${meta.renderer}, deterministic across two runs)`);
  return { code: 0, dir, meta };
}
