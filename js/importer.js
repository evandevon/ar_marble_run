// Turns scanned PDFs and photos into flattened levels.
// Pages printed from template.html are cropped and turned the right way up
// automatically using the corner squares and the header text above the frame.

import { computeHomography, warpImage } from './homography.js';
import { findCornerMarks } from './markers.js';

export const WORLD_W = 1000;
export const WORLD_H = 707;
const MAX_SIDE = 2200;   // render size for pages and photos

let pdfjsPromise = null;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      const s = document.createElement('script');
      s.src = 'lib/pdfjs/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('Could not load the PDF reader.'));
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}

function fitCanvas(srcW, srcH, draw, maxSide = MAX_SIDE) {
  const k = Math.min(1, maxSide / Math.max(srcW, srcH));
  const c = document.createElement('canvas');
  c.width = Math.round(srcW * k);
  c.height = Math.round(srcH * k);
  draw(c.getContext('2d'), c.width, c.height);
  return c;
}

export function rotateCanvas(src, deg) {
  deg = ((deg % 360) + 360) % 360;
  if (!deg) return src;
  const c = document.createElement('canvas');
  const side = deg === 90 || deg === 270;
  c.width = side ? src.height : src.width;
  c.height = side ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

// How much dark ink sits in a band just outside one edge of the frame.
// `reach` is the frame's long side; the band runs from 4% to 13% of it outside the edge.
function inkOutsideEdge(img, a, b, centre, reach) {
  const { width: W, height: H, data } = img;
  const ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey);
  let nx = -ey / len, ny = ex / len;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  if ((centre.x - mx) * nx + (centre.y - my) * ny > 0) { nx = -nx; ny = -ny; } // point outward
  let dark = 0, total = 0;
  for (let t = 0.1; t <= 0.9; t += 0.01) {
    for (let d = 0.04; d <= 0.13; d += 0.01) {
      const x = Math.round(a.x + ex * t + nx * d * reach);
      const y = Math.round(a.y + ey * t + ny * d * reach);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = (y * W + x) * 4;
      total++;
      if (data[j] * 0.3 + data[j + 1] * 0.59 + data[j + 2] * 0.11 < 110) dark++;
    }
  }
  return total ? dark / total : 0;
}

// Flatten one page/photo into a world-size canvas.
// Returns { canvas, marks: boolean }.
export function flattenPage(src) {
  const ctx = src.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, src.width, src.height);
  let corners = findCornerMarks(img);
  let marks = !!corners;
  if (corners) {
    // The header (name, key) is printed above the frame: that edge is the top.
    const centre = { x: corners.reduce((s, p) => s + p.x, 0) / 4, y: corners.reduce((s, p) => s + p.y, 0) / 4 };
    const len = (i) => Math.hypot(corners[(i + 1) % 4].x - corners[i].x, corners[(i + 1) % 4].y - corners[i].y);
    const reach = Math.max(len(0), len(1));
    // Only the two long edges can be the top of a landscape sheet; pick the one with the header.
    const longEdges = len(0) + len(2) >= len(1) + len(3) ? [0, 2] : [1, 3];
    const ink = longEdges.map((i) => inkOutsideEdge(img, corners[i], corners[(i + 1) % 4], centre, reach));
    const top = ink[0] >= ink[1] ? longEdges[0] : longEdges[1];
    corners = [0, 1, 2, 3].map((k) => corners[(top + k) % 4]);
  } else {
    // No marks: use the whole page, trimming a little off the edges (scanner shadows).
    const page = src.height > src.width ? rotateCanvas(src, 90) : src;
    return { ...flattenPlain(page), marks: false };
  }
  const paper = [{ x: 0, y: 0 }, { x: WORLD_W, y: 0 }, { x: WORLD_W, y: WORLD_H }, { x: 0, y: WORLD_H }];
  const H = computeHomography(paper, corners);
  const out = new ImageData(WORLD_W, WORLD_H);
  warpImage(img, H, WORLD_W, WORLD_H, out);
  const c = document.createElement('canvas');
  c.width = WORLD_W; c.height = WORLD_H;
  c.getContext('2d').putImageData(out, 0, 0);
  return { canvas: c, marks };
}

export function flattenPlain(src) {
  const inset = 0.02;
  const c = document.createElement('canvas');
  c.width = WORLD_W; c.height = WORLD_H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  const sx = src.width * inset, sy = src.height * inset;
  const sw = src.width * (1 - 2 * inset), sh = src.height * (1 - 2 * inset);
  // Keep the drawing's proportions: fit inside the game's shape.
  const k = Math.min(WORLD_W / sw, WORLD_H / sh);
  const dw = sw * k, dh = sh * k;
  ctx.drawImage(src, sx, sy, sw, sh, (WORLD_W - dw) / 2, (WORLD_H - dh) / 2, dw, dh);
  return { canvas: c };
}

// Read files (PDFs and images) one page at a time. For each page,
// `onPage(canvas, label)` is awaited, so big page images can be dropped as you go.
// onProgress(label) reports what's being read.
export async function readFiles(files, onPage, onProgress = () => {}) {
  let count = 0;
  for (const file of [...files]) {
    const base = file.name.replace(/\.[^.]+$/, '');
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const pdfjs = await loadPdfJs();
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        onProgress(`Reading ${file.name}: page ${i} of ${pdf.numPages}`);
        const page = await pdf.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: MAX_SIDE / Math.max(vp1.width, vp1.height) });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        page.cleanup();
        await onPage(c, pdf.numPages > 1 ? `${base} p${i}` : base);
        count++;
      }
      await pdf.destroy();
    } else if (file.type.startsWith('image/')) {
      onProgress(`Reading ${file.name}`);
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const c = fitCanvas(bitmap.width, bitmap.height, (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h));
      bitmap.close?.();
      await onPage(c, base);
      count++;
    }
  }
  return count;
}

// Shrink a canvas (kept for re-rotating pages that had no corner marks).
export function shrink(src, maxSide = 1400) {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  if (k === 1) return src;
  return fitCanvas(src.width, src.height, (ctx, w, h) => ctx.drawImage(src, 0, 0, w, h), maxSide);
}
