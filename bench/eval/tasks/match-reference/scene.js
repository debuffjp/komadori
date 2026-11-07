import { createRenderer } from "./spryte/index.js";

const W = 960;
const H = 540;
const canvas = document.getElementById("c");
const draw = createRenderer(canvas);

// A ring as short line segments around a centre.
function ring(x, y, r, width, color) {
  const n = 96;
  let px = x + r;
  let py = y;
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const nx = x + Math.cos(a) * r;
    const ny = y + Math.sin(a) * r;
    draw.line(px, py, nx, ny, width, color);
    px = nx;
    py = ny;
  }
}

function drawFrame() {
  draw.begin("#0b1020", W, H, 1);
  ring(480, 270, 150, 6, "#ffffff");
  draw.circle(480, 270, 70, "#38bdf8");
  for (let i = 0; i < 5; i++) draw.circle(180 + i * 60, 470, 9, "#cffb2d");
  draw.text("SPRYTE", 40, 60, { font: "bold 40px sans-serif", color: "#ffffff", baseline: "middle" });
  draw.end();
}

window.__frame = () => drawFrame();
drawFrame();
