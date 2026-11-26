// Finds dark (black marker) shapes on the flattened paper image and turns each
// into an outline polygon in world coordinates.
//
// Pipeline: downsample -> adaptive threshold -> close small gaps ->
//           connected components -> trace outer outline -> simplify.

export const DEFAULT_VISION = {
  sensitivity: 0.7,   // pixel counts as "ink" if darker than this x local paper brightness
  gapFill: 1,         // radius (detection px) of gap closing; joins wobbly / broken lines
  minArea: 30,        // ignore specks smaller than this (detection px)
  maxChroma: 90,      // ignore strongly coloured pixels (reserved for future colour objects)
  margin: 4,          // ignore a thin border around the paper edge
  scale: 2,           // detection runs at 1/scale of the world resolution
};

// ---------- helpers ----------

function dilate(src, w, h, r) {
  if (r <= 0) return src;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let k = x0; k <= x1; k++) if (src[row + k]) { v = 1; break; }
      tmp[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = y0; k <= y1; k++) if (tmp[k * w + x]) { v = 1; break; }
      out[y * w + x] = v;
    }
  }
  return out;
}

function invert(m) {
  const o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1;
  return o;
}

// Closing = dilate then erode. Erode is "dilate the background".
function close(mask, w, h, r) {
  if (r <= 0) return mask;
  return invert(dilate(invert(dilate(mask, w, h, r)), w, h, r));
}

// Ramer–Douglas–Peucker line simplification.
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b];
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy);
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      // Perpendicular distance to the line, or plain distance if A and B coincide.
      const d = len < 1e-9
        ? Math.hypot(pts[i].x - A.x, pts[i].y - A.y)
        : Math.abs(dy * (pts[i].x - A.x) - dx * (pts[i].y - A.y)) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Clockwise neighbour order (screen coords, y down): W, NW, N, NE, E, SE, S, SW
const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
function dirOf(dx, dy) {
  for (let i = 0; i < 8; i++) if (DX[i] === dx && DY[i] === dy) return i;
  return 0;
}

// Moore-neighbour tracing of the outer boundary of component `id`.
function traceOutline(labels, w, h, id, sx, sy, maxSteps) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === id;
  const pts = [{ x: sx, y: sy }];
  let cx = sx, cy = sy;
  let back = 0; // start pixel is top-left-most, so its west neighbour is background
  for (let step = 0; step < maxSteps; step++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cx + DX[d], ny = cy + DY[d];
      if (inside(nx, ny)) {
        const pd = (d + 7) % 8;               // last background neighbour checked
        const bx = cx + DX[pd], by = cy + DY[pd];
        const px = cx, py = cy;
        cx = nx; cy = ny;
        back = dirOf(bx - cx, by - cy);
        // Stop once we're about to repeat the first move.
        if (pts.length > 2 && px === sx && py === sy && cx === pts[1].x && cy === pts[1].y) {
          pts.pop();
          return pts;
        }
        pts.push({ x: cx, y: cy });
        moved = true;
        break;
      }
    }
    if (!moved) break; // isolated pixel
  }
  return pts;
}

// ---------- main entry ----------

// img: ImageData of the flattened paper at world resolution.
// Returns { shapes: [{ points:[{x,y}], area, bbox }], mask, w, h }
export function detectShapes(img, opts = {}) {
  const o = { ...DEFAULT_VISION, ...opts };
  const s = o.scale;
  const w = Math.floor(img.width / s);
  const h = Math.floor(img.height / s);
  const src = img.data;

  // 1. Downsample to grey + chroma
  const grey = new Float32Array(w * h);
  const chroma = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = ((y * s) * img.width + x * s) * 4;
      const r = src[j], g = src[j + 1], b = src[j + 2];
      grey[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      chroma[y * w + x] = Math.max(r, g, b) - Math.min(r, g, b);
    }
  }

  // 2. Local paper brightness via an integral image (handles uneven lighting)
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += grey[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + rowSum;
    }
  }
  const R = Math.max(8, Math.round(w / 20));
  const mask = new Uint8Array(w * h);
  const m = o.margin;
  for (let y = m; y < h - m; y++) {
    const y0 = Math.max(0, y - R), y1 = Math.min(h, y + R + 1);
    for (let x = m; x < w - m; x++) {
      const x0 = Math.max(0, x - R), x1 = Math.min(w, x + R + 1);
      const sum = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      // Lift the local mean toward white so big filled areas don't vanish.
      const ref = Math.max(mean, 0.5 * mean + 0.5 * 235);
      const v = grey[y * w + x];
      if (v < ref * o.sensitivity && chroma[y * w + x] < o.maxChroma) mask[y * w + x] = 1;
    }
  }

  // 3. Close small gaps
  const closed = close(mask, w, h, Math.round(o.gapFill));

  // 4. Connected components (8-connected)
  const labels = new Int32Array(w * h);
  const shapes = [];
  const queue = new Int32Array(w * h);
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (!closed[start] || labels[start]) continue;
    const id = next++;
    let head = 0, tail = 0, area = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const p = queue[head++];
      const px = p % w, py = (p / w) | 0;
      area++;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      for (let d = 0; d < 8; d++) {
        const nx = px + DX[d], ny = py + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (closed[q] && !labels[q]) { labels[q] = id; queue[tail++] = q; }
      }
    }
    if (area < o.minArea) continue;
    // 5. Trace outline from the first (top-left-most) pixel of the component
    const sx = start % w, sy = (start / w) | 0;
    const raw = traceOutline(labels, w, h, id, sx, sy, area * 4 + 100);
    if (raw.length < 2) continue;
    // 6. Simplify, then scale to world coordinates (pixel centres)
    const simple = rdp([...raw, raw[0]], 1.0);
    simple.pop();
    const points = simple.map((p) => ({ x: (p.x + 0.5) * s, y: (p.y + 0.5) * s }));
    shapes.push({
      points,
      area: area * s * s,
      bbox: { x: minX * s, y: minY * s, w: (maxX - minX + 1) * s, h: (maxY - minY + 1) * s },
    });
  }
  return { shapes, mask: closed, w, h };
}
