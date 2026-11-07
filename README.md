# komadori

コマ撮り: taking a scene one frame at a time. komadori loads a built page (or a URL), steps it with `window.__frame()`, checks the frames and writes a contact sheet, a `report.json` and, if you ask, an mp4.

It works with any canvas engine. The page only has to expose `window.__frame()`: step the scene exactly one frame and draw it, then return. Built for agents that can't watch a scene run: the contact sheet is the thing to look at.

```bash
npx komadori dist --frames 600 --samples 20 --size 1920x1080 --out render --mp4 render/clip.mp4
```

Using it as an agent, and how to give a page a `window.__frame()`: [docs/agent-guide.md](docs/agent-guide.md).

## What it checks

A broken page, a blank or frozen scene, and content cut off at the edge. It can't see stripes or unreadable text: look at `contact-sheet.png` for those.

Exit code: 0 when no check failed (warnings don't count), 1 when one did, 2 when the render couldn't run.

## Options

Run `npx komadori` with no arguments for the list. `--keep-frames dir` saves each sampled frame full size.

Environment: `HIGH_GPU=1` asks for the discrete GPU on a machine with two. The first line printed names the GPU used, and warns on a software renderer. `CHROME=/path/to/chrome` picks the browser. `SOFTWARE_GL=1` forces a software renderer.

## Needs

Node 20 or later, Chrome or Chromium, and ffmpeg with libx264 for `--mp4`.

## Origin

Extracted from [spryte](https://debuff.jp/spryte/), where it recorded the million-boid demo. MIT.
