import { createRenderer } from "./spryte/index.js";

const W = 960;
const H = 540;
const canvas = document.getElementById("c");
const draw = createRenderer(canvas);

// A soft light that drifts around the canvas, drawn as one rect with a smooth falloff.
const glow = draw.createShader(`
  vec4 effect(vec4 color, vec2 uv) {
    float d = distance(frameUv(), vec2(0.5, 0.5));
    float k = pow(1.0 - smoothstep(0.0, 0.5, d), 1.6);
    return vec4(1.0, 0.96, 0.9, 1.0) * k;
  }`);

const PERIOD = 240; // frames for the light to go once around
const R = 230;
let frame = 0;

function drawFrame() {
  draw.begin("#0b1020", W, H, 1);
  // A deep blue background, a little lighter toward the bottom.
  for (let i = 0; i < 54; i++) draw.rect(0, i * 10, W, 11, `rgb(${10 + i * 0.3},${16 + i * 0.5},${34 + i * 0.9})`);
  // The light's path: a tall loop through the middle of the canvas.
  const t = ((frame + 160) / PERIOD) * Math.PI * 2;
  const gx = W / 2 + 380 * Math.sin(t);
  const gy = 290 - 190 * Math.cos(t);
  draw.blend("add");
  draw.withShader(glow, () => draw.rect(gx - R, gy - R, R * 2, R * 2, "#fff"));
  draw.text("SPRYTE", W / 2, 110, { font: "bold 110px sans-serif", color: "#ffffff", align: "center", baseline: "middle" });
  draw.end();
}

window.__frame = () => {
  frame++;
  drawFrame();
};
drawFrame();
