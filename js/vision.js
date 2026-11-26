// Reads the flattened paper image and works out what each marker colour drew.
//
//   black          -> solid ground and walls
//   blue           -> bouncy (trampoline)
//   red            -> danger (lava, spikes)
//   green          -> goal
//   orange/yellow  -> coins
//
// Pipeline: average-downsample -> normalise against local paper colour ->
//           classify each pixel -> clean up fringes -> join gaps ->
//           connected components -> outlines, coins and per-type masks.

export const DEFAULT_VISION = {
  sensitivity: 0.62,  // black: darker than this fraction of paper brightness
  colourSat: 0.3,     // colours: minimum saturation to count as coloured ink
  gapFill: 1,         // radius (detection px) used to join breaks in black lines
  minArea: 18,        // ignore specks smaller than this (detection px)
  margin: 4,          // ignore a thin border around the paper edge
  scale: 2,           // detection runs at 1/scale of the world resolution
};

export const TYPES = ['solid', 'bouncy', 'hazard', 'goal', 'coin'];

// ---------- mask helpers ----------

function dilate(src, w, h, r) {
  if (r <= 0) return src;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      for (let k = x0; k <= x1; k++) if (src[row + k]) { tmp[row + x] = 1; break; }
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      for (let k = y0; k <= y1; k++) if (tmp[k * w + x]) { out[y * w + x] = 1; break; }
    }
  }
  return out;
}
const invert = (m) => m.map((v) => (v ? 0 : 1));
const close = (m, w, h, r) => (r <= 0 ? m : invert(dilate(invert(dilate(m, w, h, r)), w, h, r)));
const andNot = (a, b) => a.map((v, i) => (v && !b[i] ? 1 : 0));

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
      const d = len < 1e-9
        ? Math.hypot(pts[i].x - A.x, pts[i].y - A.y)
        : Math.abs(dy * (pts[i].x - A.x) - dx * (pts[i].y - A.y)) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Clockwise neighbour order (y down): W, NW, N, NE, E, SE, S, SW
const DX = [-1, -1, 0, 1, 1, 1, 0, -1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
const dirOf = (dx, dy) => { for (let i = 0; i < 8; i++) if (DX[i] === dx && DY[i] === dy) return i; return 0; };

// Moore-neighbour tracing of a component's outer boundary.
function traceOutline(labels, w, h, id, sx, sy, maxSteps) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === id;
  const pts = [{ x: sx, y: sy }];
  let cx = sx, cy = sy, back = 0;
  for (let step = 0; step < maxSteps; step++) {
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const nx = cx + DX[d], ny = cy + DY[d];
      if (!inside(nx, ny)) continue;
      const pd = (d + 7) % 8;
      const bx = cx + DX[pd], by = cy + DY[pd];
      const px = cx, py = cy;
      cx = nx; cy = ny;
      back = dirOf(bx - cx, by - cy);
      if (pts.length > 2 && px === sx && py === sy && cx === pts[1].x && cy === pts[1].y) { pts.pop(); return pts; }
      pts.push({ x: cx, y: cy });
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return pts;
}

// Connected components; drops small ones. Returns the cleaned mask and blobs.
function components(mask, w, h, minArea, s) {
  const labels = new Int32Array(w * h);
  const kept = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const blobs = [];
  let next = 1;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = next++;
    let head = 0, tail = 0, area = 0, sx = 0, sy = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const p = queue[head++];
      const px = p % w, py = (p / w) | 0;
      area++; sx += px; sy += py;
      for (let d = 0; d < 8; d++) {
        const nx = px + DX[d], ny = py + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !labels[q]) { labels[q] = id; queue[tail++] = q; }
      }
    }
    if (area < minArea) continue;
    for (let i = 0; i < tail; i++) kept[queue[i]] = 1;
    const raw = traceOutline(labels, w, h, id, start % w, (start / w) | 0, area * 4 + 100);
    const simple = rdp([...raw, raw[0]], 1.0);
    simple.pop();
    blobs.push({
      area: area * s * s,
      cx: (sx / area + 0.5) * s,
      cy: (sy / area + 0.5) * s,
      points: simple.map((p) => ({ x: (p.x + 0.5) * s, y: (p.y + 0.5) * s })),
    });
  }
  return { mask: kept, blobs };
}

function hueOf(r, g, b, max, chroma) {
  let h;
  if (max === r) h = ((g - b) / chroma) % 6;
  else if (max === g) h = (b - r) / chroma + 2;
  else h = (r - g) / chroma + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

// Which game type a marker hue becomes.
function typeForHue(h) {
  if (h >= 330 || h < 16) return 'hazard';   // red
  if (h < 72) return 'coin';                  // orange / yellow
  if (h < 165) return 'goal';                 // green
  if (h < 290) return 'bouncy';               // blue (includes purple-ish blues)
  return null;                                // pink / magenta: ignored
}

// ---------- main entry ----------

// img: ImageData of the flattened paper at world resolution.
export function detectLevel(img, opts = {}) {
  const o = { ...DEFAULT_VISION, ...opts };
  const s = o.scale;
  const w = Math.floor(img.width / s);
  const h = Math.floor(img.height / s);
  const n = w * h;
  const src = img.data;

  // 1. Average-downsample (reduces camera noise and colour fringing)
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const inv = 1 / (s * s);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < s; dy++) {
        let j = ((y * s + dy) * img.width + x * s) * 4;
        for (let dx = 0; dx < s; dx++, j += 4) { r += src[j]; g += src[j + 1]; b += src[j + 2]; }
      }
      const i = y * w + x;
      R[i] = r * inv; G[i] = g * inv; B[i] = b * inv;
    }
  }

  // 2. Paper colour: global (brightest 30%) and local (box average)
  const grey = new Float32Array(n);
  for (let i = 0; i < n; i++) grey[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
  const sorted = Float32Array.from(grey).sort();
  const cut = sorted[Math.floor(n * 0.7)];
  let pr = 0, pg = 0, pb = 0, pc = 0;
  for (let i = 0; i < n; i++) if (grey[i] >= cut) { pr += R[i]; pg += G[i]; pb += B[i]; pc++; }
  const paper = [pr / pc, pg / pc, pb / pc];

  const rad = Math.max(8, Math.round(w / 18));
  const local = [R, G, B].map((C) => {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += C[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
    }
    const out = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
        out[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
      }
    }
    return out;
  });

  // 3. Classify every pixel
  const raw = { solid: new Uint8Array(n), bouncy: new Uint8Array(n), hazard: new Uint8Array(n), goal: new Uint8Array(n), coin: new Uint8Array(n) };
  const anyColour = new Uint8Array(n);
  const m = o.margin;
  for (let y = m; y < h - m; y++) {
    for (let x = m; x < w - m; x++) {
      const i = y * w + x;
      // Normalise so the local paper reads as white (removes tinted / uneven light).
      const lr = local[0][i], lg = local[1][i], lb = local[2][i];
      const r = Math.min(255, (R[i] / Math.max(lr, 0.6 * lr + 0.4 * paper[0], 1)) * 240);
      const g = Math.min(255, (G[i] / Math.max(lg, 0.6 * lg + 0.4 * paper[1], 1)) * 240);
      const b = Math.min(255, (B[i] / Math.max(lb, 0.6 * lb + 0.4 * paper[2], 1)) * 240);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
      const sat = max > 0 ? chroma / max : 0;
      if (max > 55 && chroma > 38 && sat > o.colourSat) {
        const t = typeForHue(hueOf(r, g, b, max, chroma));
        if (t) { raw[t][i] = 1; anyColour[i] = 1; }
      } else if (0.299 * r + 0.587 * g + 0.114 * b < 240 * o.sensitivity) {
        raw.solid[i] = 1;
      }
    }
  }

  // 4. Clean up: edges where black meets colour produce misleading fringes.
  const blackNear = dilate(raw.solid, w, h, 1);
  const colourNear = dilate(anyColour, w, h, 1);
  const cleaned = {
    solid: close(andNot(raw.solid, colourNear), w, h, Math.round(o.gapFill)),
  };
  for (const t of ['bouncy', 'hazard', 'goal', 'coin']) cleaned[t] = close(andNot(raw[t], blackNear), w, h, 1);
  // A colour can't also be ground.
  cleaned.solid = andNot(cleaned.solid, cleaned.bouncy);

  // 5. Components per type
  const masks = {};
  const outlines = [];
  const coins = [];
  const counts = {};
  for (const t of TYPES) {
    const { mask, blobs } = components(cleaned[t], w, h, t === 'coin' ? Math.max(6, o.minArea / 2) : o.minArea, s);
    masks[t] = mask;
    counts[t] = blobs.length;
    for (const b of blobs) {
      outlines.push({ type: t, points: b.points });
      if (t === 'coin') coins.push({ x: b.cx, y: b.cy, r: Math.max(9, Math.min(18, Math.sqrt(b.area / Math.PI))) });
    }
  }
  return { w, h, scale: s, masks, outlines, coins, counts };
}
