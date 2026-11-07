# Capture speed

How long Komadori takes to make a clip, and where the time goes.

## A clip of the million-boid demo

600 frames at 1920x1080 of spryte's million-boid demo (`?capture=1`), in Chrome on Windows 11, one machine and one session (2026-11-08). The times are what Komadori prints as "stepped 600 frames in X s". They include the 20 frames it samples for its checks.

| Machine | A screenshot per frame (the default) | `--capture canvas` | Faster by |
| --- | --- | --- | --- |
| Radeon 780M (integrated) | 35.0 s | 13.5 s | 2.6x |
| RTX 5060 laptop | 37.6 s | 11.2 s | 3.4x |

Four earlier comparisons gave other figures. They were not run back to back, and the simulation settings had changed between some of them.

| Machine | Frames | Screenshot | Canvas | Faster by |
| --- | --- | --- | --- | --- |
| Radeon 780M | 300 | 25.3 s | 7.1 s | 3.6x |
| Radeon 780M | 600 | 43.3 s (the first recorder) | 14.4 s | 3.0x |

Across the four comparisons the speed-up runs from 2.6x to 3.6x, so "about 3x" is what holds. A 600-frame canvas clip took 11.2 to 14.4 s across runs, which is the 10 s of 1080p video.

To repeat it:

```bash
npx komadori <built demo> --query "capture=1" --frames 600 --samples 20 --size 1920x1080 \
  --out out --mp4 out/clip.mp4 --capture screenshot
npx komadori <built demo> --query "capture=1" --frames 600 --samples 20 --size 1920x1080 \
  --out out --mp4 out/clip.mp4 --capture canvas
```

Add `HIGH_GPU=1` to use the discrete GPU on a machine with two.

## Where the time goes

`spike.mjs` times each way of getting a frame out of the page, 300 frames at 1920x1080, in frames per second (higher is faster).

| Way of capturing | Radeon 780M | RTX 5060 laptop |
| --- | --- | --- |
| No capture, the loop inside the page (the floor) | 76.7 | 79.5 |
| Playwright JPEG screenshot per frame | 18.1 | 18.7 |
| Chrome DevTools protocol, JPEG | 16.7 | 19.3 |
| Chrome DevTools protocol, JPEG, optimised for speed | 17.1 | 19.1 |
| Chrome DevTools protocol, PNG, optimised for speed | 17.4 | 18.3 |
| WebCodecs H.264 in the page, hardware encoder | 62.4 | 71.3 |
| WebCodecs H.264 in the page, software encoder | 71.3 | 79.6 |

Every screenshot route sits near 18 frames a second, so a faster screenshot call doesn't help. Encoding inside the page runs close to the floor, and the floor is the simulation: a million boids stepped on the CPU, 58 to 80 frames a second with no capture at all. That is why a 10 second clip takes about as long as 10 seconds of playing it.

The figures vary by a few seconds between runs on the same machine. Treat them as a range.
