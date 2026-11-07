import { createRenderer } from "./spryte/index.js";

const W = 960;
const H = 540;
const canvas = document.getElementById("c");
const draw = createRenderer(canvas);

// A blue glow with ripples going outward from the middle, drawn as one rect with a custom shader.
const glow = draw.createShader(`
  uniform float time;
  vec4 effect(vec4 color, vec2 uv) {
    vec2 p = frameUv() - vec2(0.5, 0.5);
    float sample = length(p);
    float wave = sin(sample * 24.0 - time * 3.0) * 0.08;
    vec3 tint = vec4(0.3, 0.6, 1.0, 1.0);
    float k = 1.0 - smoothstep(0.7, sample + wave);
    return vec4(tint * k, 1.0);
  }`);

let frame = 0;

function drawFrame() {
  draw.begin("#000000", W, H, 1);
  glow.set("time", frame / 60);
  draw.withShader(glow, () => draw.rect(0, 0, W, H, "#ffffff"));
  draw.end();
}

window.__frame = () => {
  frame++;
  drawFrame();
};
drawFrame();
