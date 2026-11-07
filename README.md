# komadori

コマ撮り: taking a scene one frame at a time.

Made for [spryte](https://debuff.jp/spryte/), the 2D renderer that draws a million sprites in one call. komadori steps a spryte scene frame by frame in a real browser, checks every frame, and hands back a contact sheet, a `report.json` and an mp4. It's how a million-boid flock got recorded at 1080p60 on a laptop, and how spryte's showcase scenes get checked before anyone sees them.

```bash
npx komadori dist --frames 600 --samples 20 --size 1920x1080 --out render --mp4 render/clip.mp4
```

## Why it exists

An agent can't watch a scene run, and a person shouldn't have to scrub a recording to find a stripe. spryte scenes are heavy and they move, so komadori steps them itself: a fixed 1/60 s per frame, whatever the recording machine does, so the clip plays at the speed you meant. Then it lays out a few dozen frames on one sheet to look at.

On spryte's million-boid demo, one `draw.sprites` call carries 1,000,000 boids at 72 to 80 fps live on an integrated Radeon 780M. komadori recorded that demo as a 600-frame 1920x1080 clip, and caught that its first take overflowed the frame and covered the title.

## Built for agents

An agent writing a spryte scene needs two things: a small API to learn, and a way to see what it drew. spryte's whole [agent cheat sheet](https://github.com/debuffjp/debuff/blob/main/packages/spryte/docs/agent-cheatsheet.md) is one 7.7 KB page, about 3,200 tokens (counted), and komadori is the way to see: a contact sheet of the run, a few full-size frames, and checks that catch a blank, frozen or crashing scene before anyone looks. [docs/agent-guide.md](docs/agent-guide.md) has the loop.

## Fast clips: `--capture canvas`

By default `--mp4` screenshots the whole page for every frame, which is slow. `--capture canvas` encodes the canvas in the page with WebCodecs instead (H.264, no screenshot per frame):

```bash
npx komadori dist --query "capture=1" --frames 600 --size 1920x1080 --mp4 clip.mp4 --capture canvas
```

On spryte's million-boid demo, a 600-frame 1920x1080 clip (10 s at 60 fps) took 14.4 s on a Radeon 780M and 11.9 s on an RTX 5060 Laptop, including the 20 frames sampled for the checks. The screenshot path takes about 50 s for the same clip on the same machine. The scene itself is most of what's left: stepping the million boids on the CPU runs at 58 to 80 frames/s, so a clip takes close to real time, not less. Measured 2026-11-07, Chrome, Windows 11.

The clip is the canvas's pixels at its backing size. HTML drawn over the canvas (a title, a logo) is not in it, and a canvas backing size that differs from the viewport gives a clip of the canvas's size. Use the default when you want the page as a person sees it. If Chrome can't encode H.264 at that size, komadori stops with exit code 2 and says to use `--capture screenshot`. It never falls back silently.

## For agents: an MCP server

`komadori-mcp` is komadori as three tool calls, so an agent can render, look and compare without touching files. `render` returns the checks and a contact sheet, `look` returns one frame at full size (or a zoomed crop of a region), and `diff` compares a frame with the same frame of the render before it, so "what did my change do?" is one call.

```json
{ "mcpServers": { "komadori": { "command": "npx", "args": ["-y", "komadori-mcp"] } } }
```

Until komadori is on npm, point the command at a checkout instead: `"command": "node", "args": ["D:/komadori/bin/komadori-mcp.mjs"]`.

The three tool definitions are about 790 tokens counted as text. Claude Code lists MCP tools by name and loads their schemas on demand, so it carries about 140 of them up front (counted by comparing input tokens with and without the server, on claude-haiku-5-5). On spryte's 2x rain scene at 1080p, a 120-frame render takes about 5 s, and a crop or a diff about 1 s. Needs Chrome, and ffmpeg only if a render asks for a clip. It has no MCP dependency: the protocol subset it needs (initialize, tools/list, tools/call, ping) is about 100 lines, and the tests run it against the official SDK's client.

## With spryte

Give your page a stepped mode behind a query string, and point komadori at it:

```js
import { createRenderer } from "spryte";

const draw = createRenderer(canvas);
if (new URLSearchParams(location.search).has("capture")) {
  window.__frame = () => { step(1 / 60); render(); };
}
```

```bash
npx komadori dist --query "capture=1" --frames 600 --size 1920x1080
```

spryte's [million-boid demo](https://github.com/debuffjp/debuff/tree/main/packages/spryte/examples/million) and the rain and warp showcase scenes are working examples.

**Rendering at 1080p.** A scene drawn at a fixed 960x540 backing size goes soft at 1080p. Make the canvas and `draw.resize` twice the size and pass `2` as the last argument of `draw.begin(clear, W, H, 2)`. If the scene draws into a render target, make the target `W * 2` by `H * 2`, call `draw.scale(2, 2)` at the top of the function you pass to `draw.into`, and draw the target's sprite back at `scaleX: 0.5, scaleY: 0.5`: a target sprite is drawn at its pixel size in logical units, so without that the frame shows only the top-left quarter at double size.

## Any engine

komadori doesn't use spryte's code. It drives Chrome with Playwright, and the page only has to expose `window.__frame()`: step the scene exactly one frame and draw it, then return. A Canvas 2D page, Pixi, Phaser or your own renderer all work. [docs/agent-guide.md](docs/agent-guide.md) shows how to add it to any page.

## What it checks

A broken page, a shader that doesn't compile (with the line of your own source, the compiler's message and the line itself), a blank or frozen scene, and content cut off at the edge. It can't see stripes or unreadable text: look at `contact-sheet.png` for those.

Exit code: 0 when no check failed (warnings don't count), 1 when one did, 2 when the render couldn't run.

## Options

Run `npx komadori --help` for the list. `--keep-frames dir` saves each sampled frame full size.

Environment: `HIGH_GPU=1` asks for the discrete GPU on a machine with two. The first line printed names the GPU used, and warns on a software renderer. `CHROME=/path/to/chrome` picks the browser. `SOFTWARE_GL=1` forces a software renderer.

## Needs

Node 20 or later, Chrome or Chromium, and ffmpeg with libx264 for `--mp4`.

## Origin

Extracted from spryte's own render tooling. MIT.
