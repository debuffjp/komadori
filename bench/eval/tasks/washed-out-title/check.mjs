// Hidden check: render a full cycle and ask that the title stays readable in every sampled frame (the area around
// its white letters stays dark enough for a contrast of about 3.6:1: the 90th percentile of luma, 135 or less), that the title is still white, and that the
// light is still there: it still lights up a large area below the title in at least one frame (the original peaks at about 16000 pixels).
export const files = ["index.html", "scene.js"];
const TITLE = { x: 120, y: 40, w: 720, h: 140 };
export default async function check({ dir, render, lumaStats, findColor }) {
  const r = await render({ target: dir, frames: 240, samples: 16, size: "960x540" });
  if (!r.shots?.length) return { pass: false, detail: `no frame rendered (${r.report?.failures?.join("; ") ?? "?"})` };
  let worst = 0;
  let worstFrame = 0;
  let minTitle = Infinity;
  let peakGlow = 0;
  for (const s of r.shots) {
    const bg = await lumaStats(s.png, TITLE, { exclude: [255, 255, 255], tol: 60 });
    if (bg.p90 > worst) {
      worst = bg.p90;
      worstFrame = s.i;
    }
    const white = await findColor(s.png, [255, 255, 255], 30, { y: TITLE.y, h: TITLE.h });
    minTitle = Math.min(minTitle, white.count);
    const below = await lumaStats(s.png, { x: 0, y: 200, w: 960, h: 340 }, { over: 200 });
    peakGlow = Math.max(peakGlow, below.bright);
  }
  const readable = worst <= 135;
  const titleKept = minTitle >= 6000;
  const glowKept = peakGlow >= 11000;
  return {
    pass: readable && titleKept && glowKept,
    detail: `background behind the title at its worst: p90 luma ${worst.toFixed(0)} (frame ${worstFrame}, needs 135 or less); white title pixels at least ${minTitle} (needs 6000); bright glow area below the title up to ${peakGlow} px (needs 11000)`,
  };
}
