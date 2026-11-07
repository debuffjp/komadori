// End to end: each test runs the real CLI against a small fixture page in headless Chrome.
// Needs Chrome (or CHROME=/path/to/chrome) and, for the clip test, ffmpeg with libx264.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/komadori.mjs", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "komadori-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function run(name, extra = []) {
  const out = join(scratch, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  const r = spawnSync(process.execPath, [cli, fixture(name), "--frames", "30", "--samples", "6", "--size", "640x360", "--out", out, ...extra], {
    encoding: "utf8",
    timeout: 120_000,
  });
  const reportPath = join(out, "report.json");
  return { ...r, out, report: existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : undefined };
}

describe("checks", () => {
  test("a moving scene passes and writes a contact sheet and a report", () => {
    const r = run("moving");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.report.failures, []);
    assert.equal(r.report.frames, 30);
    assert.equal(r.report.sampled.length, 6);
    assert.ok(statSync(join(r.out, "contact-sheet.png")).size > 1000);
    assert.match(r.stdout, /GPU renderer: /);
  });

  test("a scene that draws one flat colour fails", () => {
    const r = run("blank");
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.report.failures.join("\n"), /single flat colour/);
  });

  test("a scene that never changes fails as frozen", () => {
    const r = run("frozen");
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.report.failures.join("\n"), /frozen/);
  });

  test("an error thrown by the page fails and is reported", () => {
    const r = run("error");
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.report.failures.join("\n"), /boom from the scene/);
  });

  test("a scene that throws on its first frame fails cleanly and still writes a report", () => {
    const r = run("throws-first");
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.report.failures.join("\n"), /no luck on frame zero/);
    assert.match(r.stdout, /no frame was captured/);
  });

  test("content touching the edge warns without failing", () => {
    const r = run("clipped");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.report.warnings.join("\n"), /left edge band/);
  });
});

describe("running it", () => {
  test("a page without window.__frame stops with exit code 2 and says what to add", () => {
    const r = run("noframe", ["--wait", "1500"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /never exposed window\.__frame/);
  });

  test("--keep-frames writes full-size PNGs of the sampled frames", () => {
    const dir = join(scratch, "kept");
    const r = run("moving", ["--keep-frames", dir]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const i of r.report.sampled) assert.ok(existsSync(join(dir, `frame-${String(i).padStart(4, "0")}.png`)), `frame ${i}`);
  });

  test("--mp4 inside a folder that doesn't exist yet still writes the clip", { skip: spawnSync("ffmpeg", ["-version"]).error ? "no ffmpeg" : false }, () => {
    const file = join(scratch, "new-folder", "deeper", "clip.mp4");
    const r = run("moving", ["--mp4", file]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(statSync(file).size > 1000);
  });

  test("bad numbers and unknown options exit with code 2", () => {
    for (const bad of [["--frames", "0"], ["--frame", "5"], ["--size", "wide"]]) {
      const r = spawnSync(process.execPath, [cli, fixture("moving"), ...bad], { encoding: "utf8" });
      assert.equal(r.status, 2, bad.join(" "));
    }
  });

  test("--help and --version exit 0", () => {
    assert.equal(spawnSync(process.execPath, [cli, "--help"]).status, 0);
    assert.match(spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).stdout, /^\d+\.\d+\.\d+/);
  });
});
describe("--capture canvas", () => {
  const hasFfmpeg = !spawnSync("ffmpeg", ["-version"]).error && !spawnSync("ffprobe", ["-version"]).error;
  const probe = (file) =>
    spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=width,height,nb_read_frames,codec_name", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout.trim();

  test("encodes the canvas in the page into an mp4 with every frame", { skip: hasFfmpeg ? false : "no ffmpeg or ffprobe" }, () => {
    const file = join(scratch, "canvas-clip", "clip.mp4");
    const r = run("moving", ["--mp4", file, "--capture", "canvas"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.report.captureMode, "canvas");
    assert.equal(r.report.clipSize, "640x360");
    assert.equal(probe(file), "h264,640,360,30");
  });

  test("a page with no canvas stops with exit code 2 and points at screenshot mode", () => {
    const r = run("nocanvas", ["--mp4", join(scratch, "nc.mp4"), "--capture", "canvas"]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /no canvas/);
    assert.match(r.stderr, /--capture screenshot/);
  });

  test("it needs --mp4, and only knows two modes", () => {
    const a = spawnSync(process.execPath, [cli, fixture("moving"), "--capture", "canvas"], { encoding: "utf8" });
    assert.equal(a.status, 2);
    assert.match(a.stderr, /--mp4/);
    const b = spawnSync(process.execPath, [cli, fixture("moving"), "--capture", "gpu", "--mp4", "x.mp4"], { encoding: "utf8" });
    assert.equal(b.status, 2);
  });
});

