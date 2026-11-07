// Where the time goes when a clip is made: the loop with no capture (the floor), screenshots by Playwright and by the
// Chrome DevTools protocol, and WebCodecs encoding inside the page. 1920x1080, the million-boid demo with ?capture=1.
//   node bench/capture/spike.mjs <dist folder of the demo> [N=300] [HIGH_GPU=1]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const dist = process.argv[2];
if (!dist) throw new Error("usage: node bench/capture/spike.mjs <built million-boid demo> (N=300 sets the frame count, HIGH_GPU=1 picks the discrete GPU)");
const N = Number(process.env.N ?? 300);
const T = { ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml" };
const server = createServer(async (q, r) => { let p = new URL(q.url, "http://x").pathname; if (p === "/") p = "/index.html";
  try { r.writeHead(200, { "content-type": T[extname(p)] ?? "application/octet-stream", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "credentialless" }); r.end(await readFile(join(dist, p))); } catch { r.writeHead(404).end(); } }).listen(0);
const b = await chromium.launch({ headless: true, channel: "chrome", args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--use-gl=angle", ...(process.env.HIGH_GPU ? ["--force_high_performance_gpu"] : [])] });
const fresh = async () => { const page = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${server.address().port}/?capture=1`); await page.waitForFunction(() => typeof window.__frame === "function");
  await page.evaluate(async () => { for (let i = 0; i < 20; i++) await window.__frame(); }); return page; };
const report = (name, ms, extra = "") => console.log(`${name.padEnd(34)} ${(N * 1000 / ms).toFixed(1).padStart(7)} frames/s  ${(ms / N).toFixed(2).padStart(7)} ms/frame ${extra}`);
let page = await fresh();
console.log(await page.evaluate(() => { const g = document.createElement("canvas").getContext("webgl2"); return g.getParameter(g.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL); }));
// A: floor (no capture; one evaluate per frame, then wait for the GPU with a final readback-free screenshot of 1 px)
let t = performance.now(); for (let i = 0; i < N; i++) await page.evaluate(() => window.__frame()); await page.screenshot({ type: "jpeg", quality: 50, clip: { x: 0, y: 0, width: 8, height: 8 } }); report("A floor (evaluate per frame)", performance.now() - t);
// A2: floor with the loop inside the page
t = performance.now(); await page.evaluate(async (n) => { for (let i = 0; i < n; i++) await window.__frame(); }, N); await page.screenshot({ type: "jpeg", quality: 50, clip: { x: 0, y: 0, width: 8, height: 8 } }); report("A2 floor (loop in page)", performance.now() - t);
// B: current: playwright jpeg screenshot per frame
t = performance.now(); let bytes = 0; for (let i = 0; i < N; i++) { await page.evaluate(() => window.__frame()); bytes += (await page.screenshot({ type: "jpeg", quality: 95 })).length; } report("B playwright jpeg q95", performance.now() - t, `${(bytes / N / 1024).toFixed(0)} KB/frame`);
// C: CDP captureScreenshot jpeg
const cdp = await page.context().newCDPSession(page);
for (const [label, opts] of [["C CDP jpeg q95", { format: "jpeg", quality: 95 }], ["C2 CDP jpeg q95 optimizeForSpeed", { format: "jpeg", quality: 95, optimizeForSpeed: true }], ["C3 CDP png optimizeForSpeed", { format: "png", optimizeForSpeed: true }]]) {
  t = performance.now(); bytes = 0; for (let i = 0; i < N; i++) { await page.evaluate(() => window.__frame()); bytes += (await cdp.send("Page.captureScreenshot", opts)).data.length * 0.75; } report(label, performance.now() - t, `${(bytes / N / 1024).toFixed(0)} KB/frame`);
}
// D: WebCodecs inside the page
const sup = await page.evaluate(async () => { const out = {}; if (!window.VideoEncoder) return { VideoEncoder: false };
  for (const codec of ["avc1.640028", "avc1.42001f", "vp09.00.40.08", "av01.0.08M.08"]) { try { const r = await VideoEncoder.isConfigSupported({ codec, width: 1920, height: 1080, bitrate: 20e6, framerate: 60, hardwareAcceleration: "prefer-hardware" }); out[codec] = r.supported; } catch (e) { out[codec] = "err " + e.message; } } return out; });
console.log("VideoEncoder support:", JSON.stringify(sup));
for (const [label, accel, codec] of [["D WebCodecs avc hw", "prefer-hardware", "avc1.640028"], ["D2 WebCodecs avc sw", "prefer-software", "avc1.640028"]]) {
  try {
    const r = await page.evaluate(async ({ n, accel, codec }) => {
      const canvas = document.querySelector("canvas"); const chunks = []; let err = null;
      const enc = new VideoEncoder({ output: (c) => chunks.push(c.byteLength), error: (e) => (err = e.message) });
      enc.configure({ codec, width: 1920, height: 1080, bitrate: 30e6, framerate: 60, hardwareAcceleration: accel, latencyMode: "quality" });
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { await window.__frame(); const f = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / 60) }); enc.encode(f, { keyFrame: i % 60 === 0 }); f.close(); while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1)); }
      await enc.flush(); return { ms: performance.now() - t0, count: chunks.length, bytes: chunks.reduce((a, c) => a + c, 0), err };
    }, { n: N, accel, codec });
    report(label, r.ms, `${r.count} chunks, ${(r.bytes / Math.max(r.count, 1) / 1024).toFixed(0)} KB/frame${r.err ? " ERR " + r.err : ""}`);
  } catch (e) { console.log(label, "failed:", e.message.split("\n")[0]); }
}
await b.close(); server.close();
