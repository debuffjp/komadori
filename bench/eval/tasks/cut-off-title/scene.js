import { createRenderer } from "./spryte/index.js";

const W = 960;
const H = 540;
const canvas = document.getElementById("c");
const draw = createRenderer(canvas);

// Drifting dots behind the title, from a seeded generator so every run draws the same frames.
let seed = 12345;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const dots = Array.from({ length: 60 }, () => ({ x: rnd() * W, y: 200 + rnd() * (H - 200), s: 0.4 + rnd(), r: 3 + rnd() * 6 }));
let frame = 0;

function drawFrame() {
  draw.begin("#0b1020", W, H, 1);
  for (const d of dots) draw.circle((d.x + frame * d.s) % W, d.y, d.r, "#38bdf8");
  draw.text("SPRYTE", W / 2, 110, { font: "bold 300px sans-serif", color: "#ffffff", align: "center", baseline: "middle" });
  draw.end();
}

window.__frame = () => {
  frame++;
  drawFrame();
};
drawFrame();
