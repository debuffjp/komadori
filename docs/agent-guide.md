# Using komadori as an agent

You can't watch a scene run. komadori gives you the next best thing: a few dozen frames laid out on one sheet, and a handful of checks that catch the worst failures before you look.

## The loop

1. Build the page, then run `npx komadori dist --frames 600 --samples 20 --size 1920x1080 --out render`.
2. Read the lines it prints. A `FAIL:` line means stop and fix that first. A `warn:` line is a place to look.
3. Open `render/contact-sheet.png`. Check what the tool can't: stripes, text that's hard to read, things cut off, a look that changed between frames.
4. Open two or three frames at full size (`--keep-frames dir`) before you say it looks right. A contact sheet shrinks every frame to 384 px wide, and fine detail goes first.
5. Change one thing, then run it again.

## What it checks

| Check | Result | What it means |
| --- | --- | --- |
| The page throws, logs a console error or a request fails | FAIL | Fix the page before judging the picture. |
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

## Which GPU did it use

The first line it prints is the renderer. On a machine with two GPUs, Chrome picks the integrated one by default: set `HIGH_GPU=1` to ask for the discrete one. A software renderer gets a warning, because its speed numbers say nothing about a real GPU. The `/s` figure in the summary includes taking the screenshots, so it measures the recording, not the scene.
