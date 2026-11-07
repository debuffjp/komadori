// The render library behind the CLI and the MCP server: step a page with window.__frame(), check the
// frames, and hand back the report, the sampled frames and the contact sheet.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

/** Bad input or an environment that can't render: the CLI turns it into exit code 2. */
export class UsageError extends Error {}

/**
 * @typedef {object} RenderOptions
 * @property {string} target a built folder or an http(s) URL
 * @property {number} [frames] default 120
 * @property {number} [samples] default 20
 * @property {string} [size] "WxH", default 1280x720
 * @property {number} [fps] default 60
 * @property {string} [out] folder for contact-sheet.png and report.json, default render-out
 * @property {string} [mp4]
 * @property {string} [keepFrames]
 * @property {string} [query]
 * @property {number} [wait] ms to wait for window.__frame, default 30000
 * @property {"screenshot"|"canvas"} [capture]
 */

/**
 * @param {RenderOptions} options
 * @param {{ log?: (line: string) => void, error?: (line: string) => void }} [io]
 * @returns {Promise<{ code: number, report?: object, shots?: { i: number, png: string }[], sheet?: string }>}
 *   code 0: no check failed, 1: one did, 2: it couldn't run (UsageError is thrown for bad input).
 */
export async function render(options, io = {}) {
  const log = io.log ?? (() => {});
  const error = io.error ?? (() => {});
  const target = options.target;
  if (!target) throw new UsageError("no page to render: pass a built folder or a URL");
  const frames = Number(options.frames ?? 120);
  const samples = Math.min(Number(options.samples ?? 20), frames);
  const [width, height] = String(options.size ?? "1280x720").split("x").map(Number);
  const fps = Number(options.fps ?? 60);
  const out = resolve(options.out ?? "render-out");
  const mp4 = options.mp4 ?? "";
  const keepFrames = options.keepFrames ?? "";
  const query = options.query ?? "";
  const waitMs = Number(options.wait ?? 30000);
  const capture = options.capture ?? "screenshot";
  if (![frames, samples, width, height, fps, waitMs].every((n) => Number.isInteger(n) && n > 0))
    throw new UsageError("--frames, --samples, --size, --fps and --wait must be whole numbers above zero");
  if (!["screenshot", "canvas"].includes(capture)) throw new UsageError("--capture must be screenshot or canvas");
  if (capture === "canvas" && !mp4) throw new UsageError("--capture canvas changes how --mp4 is made: add --mp4 file, or leave --capture out.");
  if (mp4 && spawnSync("ffmpeg", ["-version"]).error)
    throw new UsageError("--mp4 needs ffmpeg on PATH, and it isn't there. Leave out --mp4 to get the contact sheet and checks.");

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
  let browser;
  try {
    browser = await chromium.launch({
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
    const finish = (code, extra = {}) => ({ code, ...extra });

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
    log(`GPU renderer: ${renderer}`);

    await page.goto(url);
    try {
      await page.waitForFunction(() => typeof window.__frame === "function", null, { timeout: waitMs });
    } catch {
      error(`The page at ${url} never exposed window.__frame(). Add it: step the scene one frame and draw.`);
      if (errors.length) error(errors.join("\n"));
      return finish(2);
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
        error(`--capture canvas: ${clip.error}. Use --capture screenshot.`);
        return finish(2);
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
      const empty = { url, renderer, size: `${width}x${height}`, frames, sampled: [], failures, warnings: [], errors: failures };
      await writeFile(join(out, "report.json"), `${JSON.stringify(empty, null, 2)}
    `);
      for (const f of failures) log(`FAIL: ${f}`);
      log("FAIL: no frame was captured");
      return finish(1, { report: { ...empty, failures: [...failures, "no frame was captured"] }, shots: [] });
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
        // The frame most unlike the others: the sampled frame furthest from the average of all of them. A tool
        // that shows one frame at full size should show the one most likely to hold the problem.
        const mean = new Float32Array(grabs[0].d.length);
        for (const g of grabs) for (let p = 0; p < mean.length; p++) mean[p] += g.d[p] / grabs.length;
        let featured = grabs[0].i;
        let most = -1;
        for (const g of grabs) {
          let dist = 0;
          for (let p = 0; p < mean.length; p += 4) dist += Math.abs(g.d[p] - mean[p]) + Math.abs(g.d[p + 1] - mean[p + 1]) + Math.abs(g.d[p + 2] - mean[p + 2]);
          if (dist > most) {
            most = dist;
            featured = g.i;
          }
        }
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
        return { stats, diffs, featured, sheet: btoa(bin) };
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
      featuredFrame: analysis.featured,
      failures: fails,
      warnings: warns,
      errors: [...new Set(errors)],
    };
    await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    log(`stepped ${stepped} frames in ${seconds.toFixed(1)} s (${report.framesPerSecond}/s, includes capture); sampled ${shots.length}`);
    for (const w of warns) log(`warn: ${w}`);
    for (const f of fails) log(`FAIL: ${f}`);
    log(`contact sheet: ${join(out, "contact-sheet.png")}\nreport: ${join(out, "report.json")}`);
    if (!fails.length)
      log("No automated check failed. Look at the contact sheet for stripes, clipped text and anything else the checks can't see.");
    return finish(fails.length ? 1 : 0, { report, shots, sheet: analysis.sheet });
  } finally {
    await browser?.close().catch(() => {});
    server?.close();
  }
}
