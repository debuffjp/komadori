# Using komadori with spryte

komadori doesn't use any of spryte's code. It needs one thing from a spryte page, the function `window.__frame()`.

## Add a stepped mode

Keep the normal frame loop for people, and add the stepped mode behind a query string:

```js
import { createRenderer } from "spryte";

const draw = createRenderer(canvas);

if (new URLSearchParams(location.search).has("capture")) {
  window.__frame = () => {
    step(1 / 60);
    render();
  };
}
```

Then point komadori at it:

```bash
npx komadori dist --query "capture=1" --frames 600 --size 1920x1080
```

spryte's [million-boid demo](https://github.com/debuffjp/debuff/tree/main/packages/spryte/examples/million) and the rain and warp showcase scenes are working examples.

## Rendering at 1080p

A scene drawn at a fixed 960 by 540 backing size goes soft at 1080p. To fix it:

1. Make the canvas and the `draw.resize` call twice the size.
2. Pass `2` as the last argument of `draw.begin(clear, W, H, 2)`.

If the scene draws into a render target, there are three more steps:

1. Make the target `W * 2` by `H * 2`.
2. Call `draw.scale(2, 2)` at the top of the function you pass to `draw.into`.
3. Draw the target's sprite with `scaleX: 0.5, scaleY: 0.5`.

A target sprite is drawn at its pixel size in logical units. Without the third step, the frame shows only the top-left quarter of the scene at double size.

## The cheat sheet

spryte has a one-page cheat sheet for agents, [agent-cheatsheet.md](https://github.com/debuffjp/debuff/blob/main/packages/spryte/docs/agent-cheatsheet.md). It is about 3,350 tokens, counted with claude-haiku-5-5 by comparing input tokens with and without it.
