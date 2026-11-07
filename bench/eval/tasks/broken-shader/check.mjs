// Hidden check: render the scene. It has to compile (no shader errors) and show the glow: the middle clearly
// brighter than the corner. A scene that drops the shader and draws a flat colour has no glow and fails.
export const files = ["index.html", "scene.js"];
export default async function check({ dir, render, lumaStats }) {
  const r = await render({ target: dir, frames: 6, samples: 2, size: "960x540" });
  if (r.report?.shaderErrors?.length) return { pass: false, score: 255, detail: `the shader still fails: ${r.report.shaderErrors[0].summary}` };
  if (!r.shots?.length) return { pass: false, score: 255, detail: `no frame rendered (${r.report?.failures?.join("; ") ?? "?"})` };
  const png = r.shots[r.shots.length - 1].png;
  const centre = await lumaStats(png, { x: 440, y: 240, w: 80, h: 60 });
  const corner = await lumaStats(png, { x: 0, y: 0, w: 80, h: 60 });
  const gap = centre.mean - corner.mean;
  return {
    pass: gap >= 40,
    // Higher is better here, so the score is the shortfall from a 40-level gap (0 means it passes).
    score: Number(Math.max(0, 40 - gap).toFixed(1)),
    detail: `the middle is ${gap.toFixed(0)} luma levels brighter than the corner (needs 40 or more)`,
  };
}
