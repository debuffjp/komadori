# Golden frames

Golden frames let a run fail on how a scene looks, not only on a crash. This page explains what Komadori compares and why the limits are what they are.

## The commands

```bash
npx komadori determinism dist --frames 120 --samples 5 --size 1280x720
npx komadori approve dist --frames 120 --samples 5 --size 1280x720 --golden golden
npx komadori dist --frames 120 --samples 5 --size 1280x720 --golden golden
```

`determinism` renders the scene twice and says whether the sampled frames match. `approve` does the same check, and saves the frames only if they match. A scene that fails its own checks can't be approved either.

A scene stays the same from run to run if it moves by a fixed step of 1/60 second per frame, seeds its randomness, and doesn't read the real clock.

A later run with `--golden` compares each sampled frame. A frame that differs too much is reported with its number, the share of pixels that changed, and the changed region. Komadori writes `golden-diff-0042.png` to the `--out` folder for it, showing the golden frame, the new frame and the difference side by side.

If the settings differ from the ones the golden frames were made with (size, frame count, which frames, or the query), Komadori says so and doesn't compare.

`approve` refuses to replace golden frames that already exist unless you pass `--yes`. Look at the new frames first, because replacing them changes what every later run is compared with.

## The limits

A frame passes when few pixels differ and the average difference is small. A pixel counts as different when it is off by more than 8 levels out of 255.

| Case | Share of pixels allowed to differ | Mean difference allowed |
| --- | --- | --- |
| Same renderer as the golden frames | 0.01% | 0.05 out of 255 |
| Another renderer | 0.25% | 0.5 out of 255 |

These come from measurement. On spryte's rain and warp scenes at 1080p, two runs on the same renderer differed by exactly 0. A Radeon 780M, an RTX 5060 Laptop (both on Direct3D) and Vulkan SwiftShader gave frames that differed by at most a mean of 0.153 out of 255 and 0.057% of pixels. The limit for another renderer is three to four times that.

When the golden frames were made on a different renderer, Komadori uses the looser limits and prints a warning that says which two renderers it compared.

`--golden-tolerance 5` lets 5% of the pixels differ. The mean limit rises with it, to 12.75 out of 255 in that case.

## What the limits don't cover

A Linux runner rasterises text differently from Windows, so a scene with text can differ from golden frames made on another system by more than the cross-renderer limit. In spryte's CI, the warp scene (which has a title) differed by 0.27 to 0.28% on Linux, just over 0.25%, and the rain scene (no text) passed. The diff showed the outlines of the letters. spryte compares warp with `--golden-tolerance 0.5` because of that.

A wide tolerance misses small changes. Moving the warp title's shadow 6 pixels down passed at both 0.25% and 0.5%.

## Size

Golden frames are PNGs, so keep them small. Use a low sample count and 720p. Five frames of a smooth scene took 1.5 MB, and five frames of a noisy starfield took 4 MB.
