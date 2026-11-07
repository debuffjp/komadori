# Using Komadori as an agent

You can't watch a scene run. Komadori gives you the next best thing: a few dozen frames laid out on one sheet, and a handful of checks that catch the worst failures before you look.

## The loop

1. Build the page, then run `npx komadori dist --frames 600 --samples 20 --size 1920x1080 --out render`.
2. Read the lines it prints. A `FAIL:` line means stop and fix that first. A `warn:` line is a place to look.
3. Open `render/contact-sheet.png`. Check what the tool can't: stripes, text that's hard to read, things cut off, a look that changed between frames.
4. Open two or three frames at full size (`--keep-frames dir`) before you say it looks right. A contact sheet shrinks every frame to 384 px wide, and fine detail goes first.
5. Change one thing, then run it again.

## The same loop as tool calls

With `komadori mcp` the steps above are tool calls, with the images in the result:

1. `render` with `target` (a built folder or URL) and `query` if the page has a stepped mode. Read the checks, look at the contact sheet.
2. `look` with a `frame`, and `x`, `y`, `w`, `h`, `zoom` to see detail: text, stripes, an edge.
3. Change one thing, call `render` again with the same frames and samples, then `diff`. It says how much of the frame changed, where, and shows before, after and the difference.

`look` and `diff` work on the last two renders, which the server keeps in memory. Keep `frames` modest in a render: a client may time out on a long one.

## Golden frames

To make a look something a run can fail on, `komadori approve` saves the sampled frames once the scene proves deterministic, and a run with `--golden dir` fails on any frame that no longer matches, with the changed region and an image of the difference. Don't run `approve --yes` yourself to make a failure go away: that is a decision about what the scene should look like, and it is the person's. See the README for the limits and why they are what they are.

## What it checks

| Check | Result | What it means |
| --- | --- | --- |
| The page throws, logs a console error or a request fails | FAIL | Fix the page before judging the picture. |
| A WebGL shader fails to compile or link | FAIL | The line names the stage, the line of your own shader source, the compiler's message and the line itself. Fix this first: it is usually why the frame is blank. For a syntax error it also shows the line before, since the compiler blames the line after a missing semicolon. |
| `window.__frame()` throws | FAIL | The run stops there, with the frames up to that point. |
| Every sampled frame is one flat colour | FAIL | Blank scene: nothing drew. |
| Sampled frames barely differ (under 0.2/255 on average) | FAIL | Frozen scene. |
| Some sampled frames are one flat colour | warn | A fade or a loading frame, or a draw that sometimes fails. |
| Content covers over 5% of an edge band | warn | Something may be cut off. Expected for starfields and fills. |

It can't see stripes, lattices, unreadable text or ugly colour. That is what the contact sheet is for.

## Exit codes

0 when no check failed (warnings don't count), 1 when one did, 2 when the render couldn't run (a page without `window.__frame`, a missing ffmpeg, bad options).

## Giving it a page it can step

The page must expose `window.__frame()`: advance the scene by exactly one frame, draw it, and return. That means the scene can't run on its own clock during a render. Keep the real-time loop for normal use and add the stepped mode behind a query string, then pass it with `--query`:

```js
const capture = new URLSearchParams(location.search).has("capture");
function step(dt) { /* advance the simulation by dt seconds */ }
function render() { /* draw the current state */ }

if (capture) {
  window.__frame = () => { step(1 / 60); render(); };
} else {
  let last = performance.now();
  const loop = (now) => { step((now - last) / 1000); last = now; render(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
```

```bash
npx komadori dist --query "capture=1" --frames 600
```

Two rules keep a render honest. Use a fixed step (1/60 s), so the clip plays at the speed you meant whatever the recording machine does. Seed any randomness, so two runs of the same scene give the same frames.

Return only after the draw has been submitted. If your engine draws on its own ticker, stop the ticker in this mode.

## Making a clip quickly

`--mp4` alone screenshots the whole page per frame. `--capture canvas` encodes the canvas inside the page, about 3 to 4 times faster on a heavy scene, but the clip holds only the canvas: no HTML overlays, and the size is the canvas's backing size. Use it for drafts and for scenes drawn entirely on one canvas.

## Which GPU did it use

The first line it prints is the renderer. On a machine with two GPUs, Chrome picks the integrated one by default: set `HIGH_GPU=1` to ask for the discrete one. A software renderer gets a warning, because its speed numbers say nothing about a real GPU. The `/s` figure in the summary includes taking the screenshots, so it measures the recording, not the scene.
