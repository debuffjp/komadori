#!/usr/bin/env node
// komadori: renders a browser scene frame by frame, checks the frames and writes a contact sheet.
//   npx komadori <dist-dir | url> [options]      (npx komadori --help lists the options)
// Exit code: 0 when no check failed (warnings don't count), 1 when one did, 2 when the render couldn't run.
// The checks find a broken page, a blank or frozen scene and content cut off at the edge. They can't see
// stripes or unreadable text: look at contact-sheet.png for those. The work is in ../src/render.mjs.
import { readFile } from "node:fs/promises";
import { render, UsageError } from "../src/render.mjs";

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
  console.error(`Unknown option ${unknown}.\n${USAGE}`);
  process.exit(2);
}
const target = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : undefined;
};
if (!target) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const result = await render(
    {
      target,
      frames: opt("frames"),
      samples: opt("samples"),
      size: opt("size"),
      fps: opt("fps"),
      out: opt("out"),
      mp4: opt("mp4"),
      keepFrames: opt("keep-frames"),
      query: opt("query"),
      wait: opt("wait"),
      capture: opt("capture"),
    },
    { log: (line) => console.log(line), error: (line) => console.error(line) },
  );
  process.exit(result.code);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(e.message);
  process.exit(2);
}
