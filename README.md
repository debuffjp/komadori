# Komadori

A 10 second 1080p clip of a million boids takes 11-14 seconds to make, on a laptop GPU. You can't watch a canvas run from a terminal, and neither can your agent. Komadori runs the page in Chrome one frame at a time and hands back what it drew: a contact sheet (one image of sampled frames), a report, and a clip if you ask for one. [bench/capture](bench/capture/README.md) has the measurements.

コマ撮り (Komadori) means stop-motion. It was built for [spryte](https://debuff.jp/spryte/) scenes and works with any page that draws on a canvas.

```bash
npx komadori dist --frames 600 --size 1920x1080 --out render --mp4 render/clip.mp4
```

`dist` is a built page or a URL. The page needs to define one function, `window.__frame()`, that advances the scene by exactly one frame and draws it. [docs/agent-guide.md](docs/agent-guide.md) shows how to add it to a page, and [docs/spryte.md](docs/spryte.md) covers spryte.

## What it checks

A run fails, with exit code 1, when:

- the page throws an error or a request fails
- a shader doesn't compile. The message gives the line of your shader source, the compiler's message, and the line itself.
- every sampled frame is one flat colour, or the frames barely change

It warns when something touches an edge of the frame and may be cut off.

It can't see stripes, text that is hard to read, or ugly colours. Open `contact-sheet.png` and look.

Exit code 2 means the render couldn't run, for example because the page never defined `window.__frame()`.

## Making a clip quickly

`--mp4` takes a screenshot of the whole page for every frame, which is slow. `--capture canvas` encodes the canvas inside the page instead, and is about 3x faster (2.6-3.6x across runs):

```bash
npx komadori dist --frames 600 --size 1920x1080 --mp4 clip.mp4 --capture canvas
```

A 10 second 1080p clip of spryte's million-boid demo took 11-14 seconds on a Radeon 780M and on an RTX 5060 laptop, in Chrome on Windows. The clip holds only the canvas, so a title or logo drawn in HTML on top of it is missing. If Chrome can't encode H.264 at your size, Komadori stops and tells you. It never falls back without saying so.

## Golden frames

A golden frame is a saved picture of how a scene should look. Later runs fail when a frame no longer matches.

```bash
npx komadori approve dist --frames 120 --samples 5 --size 1280x720 --golden golden
npx komadori dist --frames 120 --samples 5 --size 1280x720 --golden golden
```

`approve` renders the scene twice and saves the frames only if both runs match, because a comparison means nothing if the scene changes from run to run. A failing frame is reported with its number, the share of pixels that changed, and the region. Komadori also writes an image of the golden frame, the new frame, and the difference. `approve` won't replace existing golden frames unless you pass `--yes`.

[docs/golden-frames.md](docs/golden-frames.md) explains the limits and where they come from.

## For agents: an MCP server

Komadori also runs as an MCP server with three tools. `render` returns the checks and a contact sheet. `look` returns one frame at full size, or a zoomed crop. `diff` compares a frame with the same frame from the render before it.

```json
{ "mcpServers": { "komadori": { "command": "npx", "args": ["-y", "komadori", "mcp"] } } }
```

`komadori mcp` starts the server and talks to the client on stdin and stdout. The older `komadori-mcp` command does the same thing and still works.

Does this help an agent write better scenes? On four small tasks, Sonnet did as well without rendering anything. The runs and their costs are in [bench/eval](bench/eval/README.md).

## Options and environment

Run `npx komadori --help` for the options. `--keep-frames dir` saves each sampled frame at full size.

`HIGH_GPU=1` asks Chrome for the discrete GPU on a machine that has two. The first line Komadori prints names the GPU it used, and warns if it is a software renderer. `CHROME=/path/to/chrome` picks the browser, and `SOFTWARE_GL=1` forces a software renderer.

## Needs

Node 20 or later, Chrome or Chromium, and ffmpeg with libx264 for `--mp4`.

## License

MIT. Komadori started as the render tool in spryte's repository.
