// Image work for the MCP tools (crop and zoom a frame, compare two frames) done in a throwaway Chrome page,
// so komadori needs no image library. Frames in and out are base64 PNGs.
import { chromium } from "playwright-core";

const MAX_SIDE = 1800;

async function withPage(fn) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }),
  });
  try {
    return await fn(await browser.newPage());
  } finally {
    await browser.close();
  }
}

/**
 * Cut a region out of a frame and scale it up. The region is in the frame's own pixels; the result is capped
 * at 1800 px on a side so one look can't flood the conversation with a huge image.
 * @returns {Promise<{ png: string, width: number, height: number, region: {x:number,y:number,w:number,h:number}, zoom: number }>}
 */
export async function crop(png, region, zoom) {
  return withPage((page) =>
    page.evaluate(
      async ({ png, region, zoom, max }) => {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const x = Math.max(0, Math.min(bmp.width - 1, Math.round(region?.x ?? 0)));
        const y = Math.max(0, Math.min(bmp.height - 1, Math.round(region?.y ?? 0)));
        const w = Math.max(1, Math.min(bmp.width - x, Math.round(region?.w ?? bmp.width)));
        const h = Math.max(1, Math.min(bmp.height - y, Math.round(region?.h ?? bmp.height)));
        const z = Math.min(zoom ?? 1, max / w, max / h);
        const cv = new OffscreenCanvas(Math.max(1, Math.round(w * z)), Math.max(1, Math.round(h * z)));
        const cx = cv.getContext("2d");
        // Zoom in with hard pixels so a pixel stays a pixel; zoom out smoothly.
        cx.imageSmoothingEnabled = z < 1;
        cx.drawImage(bmp, x, y, w, h, 0, 0, cv.width, cv.height);
        const buf = new Uint8Array(await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer());
        let bin = "";
        for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
        return { png: btoa(bin), width: cv.width, height: cv.height, region: { x, y, w, h }, zoom: z };
      },
      { png, region, zoom, max: MAX_SIDE },
    ),
  );
}

/**
 * Compare two frames of the same size. `changed` is the share of pixels that differ by more than a small
 * threshold, `box` the smallest rectangle holding them, `mean` the average difference out of 255. The image shows
 * before, after and the difference (brighter is more changed) side by side, scaled to fit.
 * @returns {Promise<{ same: boolean, mean: number, changed: number, box: {x:number,y:number,w:number,h:number}|null, png: string }>}
 */
export async function compare(before, after) {
  return withPage((page) =>
    page.evaluate(
      async ({ before, after, max }) => {
        const load = async (png) => createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
        const [a, b] = [await load(before), await load(after)];
        if (a.width !== b.width || a.height !== b.height) return { mismatch: `${a.width}x${a.height} against ${b.width}x${b.height}` };
        const read = (bmp) => {
          const cv = new OffscreenCanvas(bmp.width, bmp.height);
          const cx = cv.getContext("2d", { willReadFrequently: true });
          cx.drawImage(bmp, 0, 0);
          return cx.getImageData(0, 0, bmp.width, bmp.height);
        };
        const da = read(a);
        const db = read(b);
        const diff = new ImageData(a.width, a.height);
        let sum = 0;
        let count = 0;
        let x0 = a.width;
        let y0 = a.height;
        let x1 = -1;
        let y1 = -1;
        for (let p = 0; p < da.data.length; p += 4) {
          const d = (Math.abs(da.data[p] - db.data[p]) + Math.abs(da.data[p + 1] - db.data[p + 1]) + Math.abs(da.data[p + 2] - db.data[p + 2])) / 3;
          sum += d;
          const v = Math.min(255, d * 6);
          diff.data[p] = diff.data[p + 1] = diff.data[p + 2] = v;
          diff.data[p + 3] = 255;
          if (d > 8) {
            count++;
            const px = (p / 4) % a.width;
            const py = Math.floor(p / 4 / a.width);
            if (px < x0) x0 = px;
            if (px > x1) x1 = px;
            if (py < y0) y0 = py;
            if (py > y1) y1 = py;
          }
        }
        const total = a.width * a.height;
        const s = Math.min(1, max / (a.width * 3 + 20), 600 / a.height);
        const w = Math.round(a.width * s);
        const h = Math.round(a.height * s);
        const sheet = new OffscreenCanvas(w * 3 + 20, h);
        const sc = sheet.getContext("2d");
        sc.fillStyle = "#222";
        sc.fillRect(0, 0, sheet.width, sheet.height);
        const dc = new OffscreenCanvas(a.width, a.height);
        dc.getContext("2d").putImageData(diff, 0, 0);
        sc.drawImage(a, 0, 0, w, h);
        sc.drawImage(b, w + 10, 0, w, h);
        sc.drawImage(dc, 2 * w + 20, 0, w, h);
        const buf = new Uint8Array(await (await sheet.convertToBlob({ type: "image/png" })).arrayBuffer());
        let bin = "";
        for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
        return {
          same: count === 0,
          mean: sum / total,
          changed: count / total,
          box: count ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null,
          png: btoa(bin),
        };
      },
      { before, after, max: MAX_SIDE },
    ),
  ).then((r) => {
    if (r.mismatch) throw new Error(`the two frames are different sizes (${r.mismatch}), so they can't be compared`);
    return r;
  });
}

/**
 * Where a colour appears in a frame: how many pixels are within `tol` (sum of channel differences) of `rgb`, and
 * the smallest rectangle holding them. For a check that something is drawn, visible and not cut off.
 * @returns {Promise<{ count: number, box: {x:number,y:number,w:number,h:number}|null, width: number, height: number }>}
 */
export async function findColor(png, rgb, tol = 60, region) {
  return withPage((page) =>
    page.evaluate(
      async ({ png, rgb, tol, region }) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
        const y0r = region?.y ?? 0;
        const y1r = region ? region.y + region.h : bmp.height;
        let x0 = bmp.width;
        let y0 = bmp.height;
        let x1 = -1;
        let y1 = -1;
        let count = 0;
        for (let y = y0r; y < y1r; y++)
          for (let x = 0; x < bmp.width; x++) {
            const p = (y * bmp.width + x) * 4;
            if (Math.abs(d[p] - rgb[0]) + Math.abs(d[p + 1] - rgb[1]) + Math.abs(d[p + 2] - rgb[2]) <= tol) {
              count++;
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        return { count, box: count ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null, width: bmp.width, height: bmp.height };
      },
      { png, rgb, tol, region },
    ),
  );
}

/**
 * How bright a region is, leaving out the pixels near one colour (a title's white, say). `p75`, `p90`, `p95` and `p99` are
 * percentiles of luma (0..255) over the rest, `bright` the number of pixels in the region with luma over `over`.
 * @returns {Promise<{ p75: number, p90: number, p95: number, p99: number, mean: number, count: number, bright: number }>}
 */
export async function lumaStats(png, region, { exclude, tol = 60, over = 200 } = {}) {
  return withPage((page) =>
    page.evaluate(
      async ({ png, region, exclude, tol, over }) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        const r = region ?? { x: 0, y: 0, w: bmp.width, h: bmp.height };
        const d = cx.getImageData(r.x, r.y, r.w, r.h).data;
        const lumas = [];
        let bright = 0;
        for (let p = 0; p < d.length; p += 4) {
          const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
          if (l > over) bright++;
          if (exclude && Math.abs(d[p] - exclude[0]) + Math.abs(d[p + 1] - exclude[1]) + Math.abs(d[p + 2] - exclude[2]) <= tol) continue;
          lumas.push(l);
        }
        lumas.sort((a, b) => a - b);
        const mean = lumas.reduce((a, b) => a + b, 0) / Math.max(lumas.length, 1);
        const at = (q) => lumas[Math.min(lumas.length - 1, Math.floor(lumas.length * q))] ?? 0;
        return { p75: at(0.75), p90: at(0.9), p95: at(0.95), p99: at(0.99), mean, count: lumas.length, bright };
      },
      { png, region, exclude, tol, over },
    ),
  );
}

/**
 * Brightness in a ring just around some shape: the pixels within `outer` px of the pixels near `color` (a white
 * title, say), leaving out the shape itself and the `inner` px next to it, where anti-aliasing blurs the edge.
 * This is the background a reader's eye compares the letters with, so it measures contrast where it matters.
 * @returns {Promise<{ p90: number, mean: number, count: number }>}
 */
export async function ringLuma(png, region, { color = [255, 255, 255], tol = 60, inner = 2, outer = 8 } = {}) {
  return withPage((page) =>
    page.evaluate(
      async ({ png, region, color, tol, inner, outer }) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        const { w, h } = region;
        const d = cx.getImageData(region.x, region.y, w, h).data;
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
          const p = i * 4;
          if (Math.abs(d[p] - color[0]) + Math.abs(d[p + 1] - color[1]) + Math.abs(d[p + 2] - color[2]) <= tol) mask[i] = 1;
        }
        // Grow the shape by r pixels (a square window, in two passes).
        const grow = (src, r) => {
          const a = new Uint8Array(w * h);
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              if (!src[y * w + x]) continue;
              for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) a[y * w + k] = 1;
            }
          const b = new Uint8Array(w * h);
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              if (!a[y * w + x]) continue;
              for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) b[k * w + x] = 1;
            }
          return b;
        };
        const near = grow(mask, inner);
        const far = grow(mask, outer);
        const lumas = [];
        for (let i = 0; i < w * h; i++) {
          if (far[i] && !near[i]) {
            const p = i * 4;
            lumas.push(0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]);
          }
        }
        lumas.sort((a, b) => a - b);
        const mean = lumas.reduce((s, v) => s + v, 0) / Math.max(lumas.length, 1);
        return { p90: lumas[Math.min(lumas.length - 1, Math.floor(lumas.length * 0.9))] ?? 0, mean, count: lumas.length };
      },
      { png, region, color, tol, inner, outer },
    ),
  );
}
