// Hidden check: render the scene, find the title's white pixels, and ask that they are all there, clear of the
// edges by 24px, and as wide as the space allows (at least 85% of it). The dots are blue, so white is the title.
export const files = ["index.html", "scene.js"];
export default async function check({ dir, render, findColor }) {
  const r = await render({ target: dir, frames: 3, samples: 2, size: "960x540" });
  if (!r.shots?.length) return { pass: false, detail: `no frame rendered (${r.report?.failures?.join("; ") ?? "?"})` };
  const f = await findColor(r.shots[r.shots.length - 1].png, [255, 255, 255], 60, { y: 0, h: 220 });
  if (!f.box) return { pass: false, detail: "no title pixels found" };
  const left = f.box.x;
  const right = f.width - (f.box.x + f.box.w);
  const room = f.width - 48;
  const used = f.box.w / room;
  const pass = left >= 24 && right >= 24 && used >= 0.85;
  return { pass, detail: `title spans x ${left}..${f.width - right}: ${left}px left, ${right}px right, ${(used * 100).toFixed(0)}% of the room` };
}
