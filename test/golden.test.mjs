// Golden frames: approve saves reference frames (only for a scene that renders the same twice), and a later run
// compares against them and fails with the frame, the changed region and an image of the difference.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkGolden, OTHER, SAME } from "../src/golden.mjs";

const cli = fileURLToPath(new URL("../bin/komadori.mjs", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "komadori-golden-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const BASE = ["--frames", "30", "--samples", "6", "--size", "640x360"];

/** A private copy of a fixture, so a test can change it. */
function copy(name) {
  const dir = join(scratch, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  cpSync(fixture(name), dir, { recursive: true });
  return dir;
}
function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 180_000 });
}
const report = (out) => JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
const recolour = (dir) => writeFileSync(join(dir, "index.html"), readFileSync(join(dir, "index.html"), "utf8").replace("#cffb2d", "#f472b6"));

describe("determinism and approve", () => {
  test("determinism says a stepped scene is the same twice", () => {
    const r = run(["determinism", fixture("moving"), ...BASE]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /deterministic: all 6 sampled frames are the same/);
  });

  test("determinism catches a scene that uses Math.random", () => {
    const r = run(["determinism", fixture("random"), ...BASE]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /NOT deterministic: \d+ of 6 sampled frames differ/);
    assert.match(r.stdout, /fixed step.*seed any randomness/);
  });

  test("approve refuses a scene that isn't deterministic, and writes nothing", () => {
    const golden = join(scratch, "golden-random");
    const r = run(["approve", fixture("random"), ...BASE, "--golden", golden]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not deterministic, so its frames can't be golden/);
    assert.equal(existsSync(join(golden, "golden.json")), false);
  });

  test("approve refuses a scene that fails its own checks", () => {
    const r = run(["approve", fixture("blank"), ...BASE, "--golden", join(scratch, "golden-blank")]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fails its own checks, so it can't be approved/);
  });

  test("approve writes the sampled frames and the settings", () => {
    const golden = join(scratch, "golden-ok");
    const r = run(["approve", fixture("moving"), ...BASE, "--golden", golden]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const meta = JSON.parse(readFileSync(join(golden, "golden.json"), "utf8"));
    assert.equal(meta.size, "640x360");
    assert.equal(meta.frames, 30);
    assert.equal(meta.sampled.length, 6);
    assert.match(meta.renderer, /ANGLE|SwiftShader/);
    for (const i of meta.sampled) assert.ok(existsSync(join(golden, `frame-${String(i).padStart(4, "0")}.png`)), `frame ${i}`);
  });

  test("approve won't replace golden frames without --yes, and does with it", () => {
    const golden = join(scratch, "golden-twice");
    assert.equal(run(["approve", fixture("moving"), ...BASE, "--golden", golden]).status, 0);
    const again = run(["approve", fixture("moving"), ...BASE, "--golden", golden]);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /already has golden frames.*--yes/s);
    assert.equal(run(["approve", fixture("moving"), ...BASE, "--golden", golden, "--yes"]).status, 0);
    const bad = run([fixture("moving"), "--yes"]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--yes only goes with approve/);
  });
});

describe("comparing with golden frames", () => {
  const golden = join(scratch, "golden-compare");

  test("an unchanged scene passes", () => {
    assert.equal(run(["approve", fixture("moving"), ...BASE, "--golden", golden]).status, 0);
    const out = join(scratch, "out-same");
    const r = run([fixture("moving"), ...BASE, "--golden", golden, "--out", out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(report(out).golden.compared, 6);
    assert.equal(report(out).golden.sameRenderer, true);
  });

  test("a changed block fails each frame, names the region and writes a diff image", () => {
    const dir = copy("moving");
    recolour(dir);
    const out = join(scratch, "out-changed");
    const r = run([dir, ...BASE, "--golden", golden, "--out", out]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const f = report(out).failures;
    assert.equal(f.length, 6);
    assert.match(f[0], /frame 0 differs from the golden frame: 1\.56% of pixels changed/);
    assert.match(f[0], /changed region x=47 y=140 w=60 h=60; see golden-diff-0000\.png/);
    assert.ok(existsSync(join(out, "golden-diff-0000.png")));
  });

  test("--golden-tolerance lets a change that small through", () => {
    const dir = copy("moving");
    recolour(dir);
    const r = run([dir, ...BASE, "--golden", golden, "--golden-tolerance", "5", "--out", join(scratch, "out-tol")]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  test("different settings say so, instead of showing a pixel difference", () => {
    const out = join(scratch, "out-settings");
    const r = run([fixture("moving"), "--frames", "40", "--samples", "6", "--size", "640x360", "--golden", golden, "--out", out]);
    assert.equal(r.status, 1);
    assert.match(report(out).failures.join("\n"), /don't match this run's settings \(frames: golden has 30, this run has 40/);
  });

  test("golden frames from another renderer get looser limits, and a warning says so", () => {
    const other = join(scratch, "golden-other");
    cpSync(golden, other, { recursive: true });
    const meta = JSON.parse(readFileSync(join(other, "golden.json"), "utf8"));
    meta.renderer = "ANGLE (Some Other GPU, Direct3D11)";
    writeFileSync(join(other, "golden.json"), JSON.stringify(meta));
    const out = join(scratch, "out-other");
    const r = run([fixture("moving"), ...BASE, "--golden", other, "--out", out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /warn: the golden frames were made on ANGLE \(Some Other GPU, Direct3D11\).*looser limits/);
    assert.equal(report(out).golden.sameRenderer, false);
  });

  test("a missing golden folder fails and says how to make one", () => {
    const out = join(scratch, "out-missing");
    const r = run([fixture("moving"), ...BASE, "--golden", join(scratch, "nowhere"), "--out", out]);
    assert.equal(r.status, 1);
    assert.match(report(out).failures[0], /no golden frames in .*komadori approve first/);
  });
});

describe("the limits", () => {
  test("come from measurement: tight on the same renderer, about 4x the worst seen across others", () => {
    assert.ok(SAME.mean < OTHER.mean && SAME.changed < OTHER.changed);
    // Worst measured across a Radeon, an RTX and SwiftShader: mean 0.153, 0.057% of pixels.
    assert.ok(OTHER.mean >= 0.153 * 3 && OTHER.changed >= 0.00057 * 4);
  });

  test("checkGolden reports a missing folder without throwing", async () => {
    const r = await checkGolden({ dir: join(scratch, "none"), out: scratch, renderer: "x", size: "1x1", frames: 1, sampled: [0], shots: [] });
    assert.match(r.failures[0], /no golden frames/);
  });
});
