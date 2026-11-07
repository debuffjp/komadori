#!/usr/bin/env node
// komadori: renders a browser scene frame by frame, checks the frames and writes a contact sheet.
//   npx komadori <dist-dir | url> [options]
//   --frames 600     frames to step (default 120)
//   --fps 60         only used for the clip's frame rate (the page decides how far one frame steps)
//   --size 1920x1080 viewport (default 1280x720)
//   --samples 20     frames kept for the checks and the contact sheet (default 20)
//   --out render-out folder for contact-sheet.png and report.json (default ./render-out)
//   --keep-frames d  also write each sampled frame to folder d as a full-size PNG (frame-0007.png)
//   --mp4 clip.mp4   also encode every frame; needs ffmpeg with libx264 on PATH
//   --query "n=5000" appended to the page URL
// Environment: HIGH_GPU=1 asks for the discrete GPU on a machine with two (the first line printed names the one used).
//   CHROME=/path/to/chrome picks the browser; SOFTWARE_GL=1 forces a software renderer.
// The page must expose window.__frame(): step the scene exactly one frame and draw it, then return.
// Without it the tool stops and says so. The million-boid demo's ?capture=1 mode is a working example.
// Exit code: 0 when no check failed (warnings don't count), 1 when one did, 2 when the render couldn't run.
// The checks find a broken page, a blank or frozen scene and content cut off at the edge. They can't see
// stripes or unreadable text: look at contact-sheet.png for those.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const USAGE = `usage: komadori <dist-dir | url> [options]
  --frames n       frames to step (default 120)
  --size WxH       viewport (default 1280x720)
  --samples n      frames kept for the checks and the contact sheet (default 20)
  --out dir        folder for contact-sheet.png and report.json (default ./render-out)
  --keep-frames d  also write each sampled frame to folder d as a full-size PNG
  --mp4 file       also encode every frame (needs ffmpeg with libx264 on PATH)
  --fps n          the clip's frame rate (default 60)
  --query q        appended to the page URL
  --capture mode   how --mp4 is made: screenshot (default, the whole page) or canvas (the canvas only, much faster)
  --wait ms        how long to wait for window.__frame to appear (default 30000)
  --help, --version
Environment: HIGH_GPU=1, CHROME=/path/to/chrome, SOFTWARE_GL=1`;
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
if (args.includes("--version")) {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  console.log(pkg.version);
  process.exit(0);
}
const KNOWN = new Set(["frames", "size", "samples", "out", "keep-frames", "mp4", "fps", "query", "wait", "capture"]);
const unknown = args.find((a) => a.startsWith("--") && !KNOWN.has(a.slice(2)));
if (unknown) {
  console.error(`Unknown option ${unknown}.
${USAGE}`);
  process.exit(2);
}
const target = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
if (!target) {
  console.error(USAGE);
  process.exit(2);
}
const frames = Number(opt("frames", 120));
const samples = Math.min(Number(opt("samples", 20)), frames);
const [width, height] = opt("size", "1280x720").split("x").map(Number);
const fps = Number(opt("fps", 60));
const out = resolve(opt("out", "render-out"));
const mp4 = opt("mp4", "");
const keepFrames = opt("keep-frames", "");
const query = opt("query", "");
const waitMs = Number(opt("wait", 30000));
const capture = opt("capture", "screenshot");
if (![frames, samples, width, height, fps, waitMs].every((n) => Number.isInteger(n) && n > 0)) {
  console.error("--frames, --samples, --size, --fps and --wait must be whole numbers above zero");
  process.exit(2);
}
if (!["screenshot", "canvas"].includes(capture)) {
  console.error("--capture must be screenshot or canvas");
  process.exit(2);
}
if (capture === "canvas" && !mp4) {
  console.error("--capture canvas changes how --mp4 is made: add --mp4 file, or leave --capture out.");
  process.exit(2);
}
if (mp4 && spawnSync("ffmpeg", ["-version"]).error) {
  console.error("--mp4 needs ffmpeg on PATH, and it isn't there. Leave out --mp4 to get the contact sheet and checks.");
  process.exit(2);
}

// A static server with the isolation headers shared memory needs, as a real host must send too.
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
let server;
let origin = target;
if (!/^https?:\/\//.test(target)) {
  const dist = resolve(target);
  server = createServer(async (req, res) => {
    const raw = new URL(req.url, "http://x").pathname;
    const path = raw === "/" ? "/index.html" : raw;
    try {
      const body = await readFile(join(dist, path));
      res.writeHead(200, {
        "content-type": TYPES[extname(path)] ?? "application/octet-stream",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "credentialless",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(0);
  origin = `http://localhost:${server.address().port}/`;
}
const url = query ? `${origin}${origin.includes("?") ? "&" : "?"}${query}` : origin;

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }),
  args: [
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
    "--use-gl=angle",
    ...(process.env.HIGH_GPU ? ["--force_high_performance_gpu"] : []),
    ...(process.env.SOFTWARE_GL ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []),
  ],
});
const finish = async (code) => {
  await browser.close();
  server?.close();
  process.exit(code);
};

const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
// A failed request is reported with its URL below, so skip the console's anonymous copy of it.
page.on(
  "console",
  (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(`console.error: ${m.text()}`),
);
page.on("requestfailed", (r) => !r.url().endsWith("/favicon.ico") && errors.push(`request failed: ${r.url()}`));
page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/favicon.ico") && errors.push(`HTTP ${r.status()}: ${r.url()}`));
const renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "no WebGL2";
});
console.log(`GPU renderer: ${renderer}`);

await page.goto(url);
try {
  await page.waitForFunction(() => typeof window.__frame === "function", null, { timeout: waitMs });
} catch {
  console.error(`The page at ${url} never exposed window.__frame(). Add it: step the scene one frame and draw.`);
  if (errors.length) console.error(errors.join("\n"));
  await finish(2);
}

// --capture canvas: encode the canvas itself in the page (WebCodecs), so no screenshot is made per frame.
// The clip is the canvas's pixels at its backing size: anything the page puts over it in HTML is not in it.
let clip;
if (capture === "canvas") {
  clip = await page.evaluate(
    async ({ fps }) => {
      const canvases = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height);
      if (!canvases.length) return { error: "the page has no canvas to encode" };
      if (!window.VideoEncoder) return { error: "this browser has no WebCodecs VideoEncoder" };
      const w = canvases[0].width & ~1;
      const h = canvases[0].height & ~1;
      // The H.264 level has to allow the size and rate: 4.2 up to 1080p60, 5.1, then 5.2.
      const rate = Math.ceil(w / 16) * Math.ceil(h / 16) * fps;
      const codec = rate <= 522240 ? "avc1.64002a" : rate <= 983040 ? "avc1.640033" : "avc1.640034";
      const bitrate = Math.round(w * h * fps * 0.3);
      const config = { codec, width: w, height: h, bitrate, framerate: fps, avc: { format: "annexb" }, latencyMode: "quality" };
      const ok = await VideoEncoder.isConfigSupported(config);
      if (!ok.supported) return { error: `this browser can't encode H.264 at ${w}x${h} and ${fps} fps` };
      const state = { canvas: canvases[0], chunks: [], failure: null, fps };
      state.enc = new VideoEncoder({
        output: (c) => {
          const b = new Uint8Array(c.byteLength);
          c.copyTo(b);
          state.chunks.push(b);
        },
        error: (e) => {
          state.failure = e.message;
        },
      });
      state.enc.configure(config);
      window.__komadori = state;
      return { w, h };
    },
    { fps },
  );
  if (clip.error) {
    console.error(`--capture canvas: ${clip.error}. Use --capture screenshot.`);
    await finish(2);
  }
}
// Runs in the page: take the chunks the encoder has finished, as base64.
const takeChunks = () => {
  const s = window.__komadori;
  const out = [];
  for (const b of s.chunks.splice(0)) {
    let bin = "";
    for (let k = 0; k < b.length; k += 0x8000) bin += String.fromCharCode(...b.subarray(k, k + 0x8000));
    out.push(btoa(bin));
  }
  return { chunks: out, failure: s.failure };
};

let ff;
let ffClosed;
if (mp4) {
  // ffmpeg starts now and won't make the folder: an --mp4 path inside a new --out folder would fail.
  await mkdir(dirname(resolve(mp4)), { recursive: true });
  const input =
    capture === "canvas"
      ? ["-f", "h264", "-framerate", String(fps), "-i", "-", "-c:v", "copy"]
      : ["-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p"];
  ff = spawn("ffmpeg", ["-y", ...input, "-movflags", "+faststart", resolve(mp4)], { stdio: ["pipe", "ignore", "inherit"] });
  ffClosed = new Promise((r) => ff.on("close", r));
}
const keep = new Set(Array.from({ length: samples }, (_, i) => Math.round((i * (frames - 1)) / Math.max(samples - 1, 1))));
const shots = [];
const t0 = Date.now();
let stepped = 0;
for (let i = 0; i < frames; i++) {
  try {
    if (capture === "canvas") {
      const got = await page.evaluate(
        async ({ i, takeSrc }) => {
          const s = window.__komadori;
          await window.__frame();
          const f = new VideoFrame(s.canvas, { timestamp: Math.round((i * 1e6) / s.fps) });
          s.enc.encode(f, { keyFrame: i % s.fps === 0 });
          f.close();
          // Don't let the encoder queue grow without limit.
          while (s.enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
          return new Function(`return (${takeSrc})`)()();
        },
        { i, takeSrc: takeChunks.toString() },
      );
      if (got.failure) throw new Error(`the video encoder failed: ${got.failure}`);
      for (const c of got.chunks) ff.stdin.write(Buffer.from(c, "base64"));
    } else await page.evaluate(() => window.__frame());
  } catch (e) {
    // A scene that throws is a finding, not a crash of this tool: keep the frames so far and report it.
    errors.push(`window.__frame() threw at frame ${i}: ${String(e.message).split("\n")[0]}`);
    break;
  }
  stepped++;
  if (keep.has(i)) shots.push({ i, png: (await page.screenshot({ type: "png" })).toString("base64") });
  if (ff && capture === "screenshot") {
    const jpg = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
  }
}
if (capture === "canvas" && stepped) {
  try {
    const rest = await page.evaluate(
      async ({ takeSrc }) => {
        await window.__komadori.enc.flush();
        return new Function(`return (${takeSrc})`)()();
      },
      { takeSrc: takeChunks.toString() },
    );
    for (const c of rest.chunks) ff.stdin.write(Buffer.from(c, "base64"));
  } catch (e) {
    errors.push(`the video encoder failed: ${String(e.message).split("\n")[0]}`);
  }
}
const seconds = (Date.now() - t0) / 1000;
if (ff) {
  ff.stdin.end();
  if (await ffClosed) errors.push("ffmpeg failed: the clip is incomplete");
}

if (!shots.length) {
  // Nothing to look at: the scene threw before the first sampled frame.
  await mkdir(out, { recursive: true });
  const failures = [...new Set(errors)];
  await writeFile(join(out, "report.json"), `${JSON.stringify({ url, renderer, size: `${width}x${height}`, frames, sampled: [], failures, warnings: [], errors: failures }, null, 2)}
`);
  for (const f of failures) console.log(`FAIL: ${f}`);
  console.log("FAIL: no frame was captured");
  await finish(1);
}

// Analyse in a blank page, so the scene's own page isn't slowed or changed by it.
const view = await browser.newPage();
const analysis = await view.evaluate(
  async ({ shots, cols }) => {
    const W = 480;
    const grabs = [];
    for (const s of shots) {
      const bytes = Uint8Array.from(atob(s.png), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const h = Math.round((bmp.height * W) / bmp.width);
      const cv = new OffscreenCanvas(W, h);
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0, W, h);
      grabs.push({ i: s.i, bmp, w: W, h, d: cx.getImageData(0, 0, W, h).data });
    }
    const stats = grabs.map((g) => {
      const n = g.w * g.h;
      let sum = 0;
      let sq = 0;
      const counts = new Map();
      for (let p = 0; p < n; p++) {
        const k = ((g.d[p * 4] >> 4) << 8) | ((g.d[p * 4 + 1] >> 4) << 4) | (g.d[p * 4 + 2] >> 4);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        const l = 0.299 * g.d[p * 4] + 0.587 * g.d[p * 4 + 1] + 0.114 * g.d[p * 4 + 2];
        sum += l;
        sq += l * l;
      }
      const mean = sum / n;
      const std = Math.sqrt(Math.max(sq / n - mean * mean, 0));
      // The usual colour of each row and each column, so a smooth gradient isn't mistaken for content at the edge.
      const usual = (count, at) => {
        const out = [];
        for (let i = 0; i < count; i++) {
          const tally = new Map();
          for (let j = 0; j < (at === "row" ? g.w : g.h); j++) {
            const q = (at === "row" ? i * g.w + j : j * g.w + i) * 4;
            const k = ((g.d[q] >> 4) << 8) | ((g.d[q + 1] >> 4) << 4) | (g.d[q + 2] >> 4);
            tally.set(k, (tally.get(k) ?? 0) + 1);
          }
          const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
          out.push([((top >> 8) & 15) * 16 + 8, ((top >> 4) & 15) * 16 + 8, (top & 15) * 16 + 8]);
        }
        return out;
      };
      const rowBg = usual(g.h, "row");
      const colBg = usual(g.w, "col");
      const band = Math.max(2, Math.round(g.h * 0.02));
      const off = (x, y) => {
        const q = (y * g.w + x) * 4;
        const away = (bg) => Math.abs(g.d[q] - bg[0]) + Math.abs(g.d[q + 1] - bg[1]) + Math.abs(g.d[q + 2] - bg[2]) > 48;
        return away(rowBg[y]) && away(colBg[x]);
      };
      const edge = { top: 0, bottom: 0, left: 0, right: 0 };
      for (let x = 0; x < g.w; x++)
        for (let b = 0; b < band; b++) {
          if (off(x, b)) edge.top++;
          if (off(x, g.h - 1 - b)) edge.bottom++;
        }
      for (let y = 0; y < g.h; y++)
        for (let b = 0; b < band; b++) {
          if (off(b, y)) edge.left++;
          if (off(g.w - 1 - b, y)) edge.right++;
        }
      return {
        frame: g.i,
        std,
        edge: {
          top: edge.top / (g.w * band),
          bottom: edge.bottom / (g.w * band),
          left: edge.left / (g.h * band),
          right: edge.right / (g.h * band),
        },
      };
    });
    const diffs = [];
    for (let a = 1; a < grabs.length; a++) {
      let d = 0;
      const n = grabs[a].d.length;
      for (let p = 0; p < n; p += 4)
        d +=
          Math.abs(grabs[a].d[p] - grabs[a - 1].d[p]) +
          Math.abs(grabs[a].d[p + 1] - grabs[a - 1].d[p + 1]) +
          Math.abs(grabs[a].d[p + 2] - grabs[a - 1].d[p + 2]);
      diffs.push(d / (n / 4) / 3);
    }
    const tw = 384;
    const th = Math.round((grabs[0].bmp.height * tw) / grabs[0].bmp.width);
    const rows = Math.ceil(grabs.length / cols);
    const sheet = new OffscreenCanvas(cols * tw, rows * th);
    const sc = sheet.getContext("2d");
    sc.fillStyle = "#000";
    sc.fillRect(0, 0, sheet.width, sheet.height);
    grabs.forEach((g, k) => {
      const x = (k % cols) * tw;
      const y = Math.floor(k / cols) * th;
      sc.drawImage(g.bmp, x, y, tw, th);
      sc.fillStyle = "#000b";
      sc.fillRect(x, y, 56, 18);
      sc.fillStyle = "#fff";
      sc.font = "13px sans-serif";
      sc.fillText(`#${g.i}`, x + 6, y + 13);
    });
    const blob = await sheet.convertToBlob({ type: "image/png" });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
    return { stats, diffs, sheet: btoa(bin) };
  },
  { shots, cols: 5 },
);

const fails = [];
const warns = [];
if (errors.length) fails.push(`${errors.length} page error(s): ${[...new Set(errors)].slice(0, 3).join(" | ")}`);
const blank = analysis.stats.filter((s) => s.std < 1);
if (blank.length === analysis.stats.length) fails.push("every sampled frame is a single flat colour");
else if (blank.length) warns.push(`${blank.length} sampled frame(s) are a single flat colour: #${blank.map((s) => s.frame).join(", #")}`);
const avgDiff = analysis.diffs.length ? analysis.diffs.reduce((a, b) => a + b, 0) / analysis.diffs.length : 0;
if (analysis.diffs.length && avgDiff < 0.2)
  fails.push(`the scene looks frozen: sampled frames differ by ${avgDiff.toFixed(2)}/255 on average`);
for (const side of ["top", "bottom", "left", "right"]) {
  const worst = analysis.stats.reduce((m, s) => (s.edge[side] > m.v ? { v: s.edge[side], frame: s.frame } : m), { v: 0, frame: 0 });
  if (worst.v > 0.05)
    warns.push(`content covers ${(worst.v * 100).toFixed(0)}% of the ${side} edge band at frame ${worst.frame}: it may be cut off`);
}

await mkdir(out, { recursive: true });
if (keepFrames) {
  await mkdir(resolve(keepFrames), { recursive: true });
  for (const s of shots)
    await writeFile(join(resolve(keepFrames), `frame-${String(s.i).padStart(4, "0")}.png`), Buffer.from(s.png, "base64"));
}
await writeFile(join(out, "contact-sheet.png"), Buffer.from(analysis.sheet, "base64"));
const report = {
  url,
  renderer,
  size: `${width}x${height}`,
  frames: stepped,
  captureMode: mp4 ? capture : undefined,
  clipSize: clip ? `${clip.w}x${clip.h}` : undefined,
  sampled: shots.map((s) => s.i),
  seconds: Number(seconds.toFixed(1)),
  framesPerSecond: Number((stepped / seconds).toFixed(1)),
  meanFrameDifference: Number(avgDiff.toFixed(2)),
  failures: fails,
  warnings: warns,
  errors: [...new Set(errors)],
};
await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`stepped ${stepped} frames in ${seconds.toFixed(1)} s (${report.framesPerSecond}/s, includes capture); sampled ${shots.length}`);
for (const w of warns) console.log(`warn: ${w}`);
for (const f of fails) console.log(`FAIL: ${f}`);
console.log(`contact sheet: ${join(out, "contact-sheet.png")}\nreport: ${join(out, "report.json")}`);
if (!fails.length)
  console.log("No automated check failed. Look at the contact sheet for stripes, clipped text and anything else the checks can't see.");
await finish(fails.length ? 1 : 0);
