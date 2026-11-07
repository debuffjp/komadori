#!/usr/bin/env node
// komadori: renders a browser scene frame by frame, checks the frames and writes a contact sheet.
//   npx komadori <dist-dir | url> [options]      (npx komadori --help lists the options)
//   npx komadori approve <dist-dir | url> ...    save the sampled frames as golden frames
//   npx komadori determinism <dist-dir | url> .. render twice and say whether the frames match
// Exit code: 0 when no check failed (warnings don't count), 1 when one did, 2 when the render couldn't run.
// The checks find a broken page, a shader that doesn't compile, a blank or frozen scene and content cut off at the
// edge, and, with --golden, a frame that no longer matches its golden frame. They can't see stripes or unreadable
// text: look at contact-sheet.png for those. The work is in ../src.
import { readFile } from "node:fs/promises";
import { approve, determinism } from "../src/golden-cli.mjs";
import { render, UsageError } from "../src/render.mjs";

// `komadori mcp` is the MCP server. It runs before anything else, because the server owns stdout: a usage line or a
// log line printed here would break the client's parsing.
if (process.argv[2] === "mcp") {
  const { serve } = await import("../src/mcp-stdio.mjs");
  await serve();
  process.exit(0);
}

let args = process.argv.slice(2);
const USAGE = `usage: komadori <dist-dir | url> [options]
       komadori approve <dist-dir | url> [options]       save the sampled frames as golden frames
       komadori determinism <dist-dir | url> [options]   render twice, say whether the frames match
       komadori mcp                                      run as an MCP server on stdio (render, look, diff)
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
  --golden dir     compare the sampled frames with golden frames in dir (approve: where to save them, default ./golden)
  --golden-tolerance p   percent of pixels that may differ from a golden frame (replaces the default limit)
  --yes            approve: replace golden frames that already exist, after you have looked at the new ones
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
const command = ["approve", "determinism"].includes(args[0]) ? args.shift() : "render";
// --yes is a flag with no value: take it out before looking for the value of the others.
const yes = args.includes("--yes");
args = args.filter((a) => a !== "--yes");
const KNOWN = new Set(["frames", "size", "samples", "out", "keep-frames", "mp4", "fps", "query", "wait", "capture", "golden", "golden-tolerance"]);
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
if (yes && command !== "approve") {
  console.error("--yes only goes with approve.");
  process.exit(2);
}

const options = {
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
  golden: opt("golden"),
  goldenTolerance: opt("golden-tolerance"),
  yes,
};
const io = { log: (line) => console.log(line), error: (line) => console.error(line) };

try {
  const result = command === "approve" ? await approve(options, io) : command === "determinism" ? await determinism(options, io) : await render(options, io);
  process.exit(result.code);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(e.message);
  process.exit(2);
}
