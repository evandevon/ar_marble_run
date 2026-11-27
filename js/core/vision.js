// Reads the flattened paper image and works out what each marker colour drew.
// It only knows colours: black, blue, red, green and orange (orange includes
// yellow). Each game decides what the colours mean (see js/games/index.js).
//
// Colours are matched to the nearest example colour: built-in marker colours plus
// any fixes the teacher has made by clicking mistakes. That lets the game adapt
// to different lighting and whatever markers a class has.
//
// Pipeline: average-downsample -> normalise against local paper colour ->
//           classify each pixel -> clean up fringes -> join gaps ->
//           connected components -> outlines, blobs and a mask per colour.

export const DEFAULT_VISION = {
  sensitivity: 0.62,  // black: darker than this fraction of paper brightness
  colourMatch: 70,    // how far a colour may be from its nearest example and still count
  gapFill: 1,         // radius (detection px) used to join breaks in black lines
  minArea: 18,        // ignore specks smaller than this (detection px)
  margin: 4,          // ignore a thin border around the paper edge
  scale: 2,           // detection runs at 1/scale of the world resolution
  samples: [],        // colour fixes from the teacher: [{ type: colour, r, g, b }] (type may be 'ignore')
};

export const COLOURS = ['black', 'blue', 'red', 'green', 'orange'];

// Fix colours used to store game meanings; these map them to colours.
export const LEGACY_TYPES = { solid: 'black', bouncy: 'blue', hazard: 'red', goal: 'green', coin: 'orange' };

// Built-in examples of common whiteboard markers and textas, measured after the
// paper has been normalised to white (240). Teacher fixes are added on top.
const BUILT_IN = [
  ['red', 205, 55, 55], ['red', 170, 45, 55], ['red', 225, 70, 95],
  ['orange', 238, 140, 45], ['orange', 240, 170, 50], ['orange', 238, 215, 70],
  ['green', 45, 150, 75], ['green', 35, 145, 125], ['green', 110, 185, 70],
  ['blue', 45, 85, 195], ['blue', 60, 95, 160], ['blue', 40, 130, 210],
];

// ---------- mask helpers ----------

// Square dilation using running counts (cost doesn't grow with radius).
function dilate(src, w, h, r) {
  if (r <= 0) return src;
  if (src.indexOf(1) < 0) return new Uint8Array(w * h);   // nothing to grow
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x < Math.min(r, w); x++) count += src[row + x];
    for (let x = 0; x < w; x++) {
      if (x + r < w) count += src[row + x + r];
      if (x - r - 1 >= 0) count -= src[row + x - r - 1];
      tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  // Vertical pass, row by row (cache friendly): keep a running count per column.
  const col = new Int32Array(w);
  for (let y = 0; y < Math.min(r, h); y++) for (let x = 0; x < w; x++) col[x] += tmp[y * w + x];
  for (let y = 0; y < h; y++) {
    const add = y + r < h ? (y + r) * w : -1;
    const sub = y - r - 1 >= 0 ? (y - r - 1) * w : -1;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (add >= 0) col[x] += tmp[add + x];
      if (sub >= 0) col[x] -= tmp[sub + x];
      out[row + x] = col[x] > 0 ? 1 : 0;
    }
  }
  return out;
}
function invert(m) {
  const o = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) o[i] = m[i] ? 0 : 1;
  return o;
}
const close = (m, w, h, r) => (r <= 0 || m.indexOf(1) < 0 ? m : invert(dilate(invert(dilate(m, w, h, r)), w, h, r)));
function andNot(a, b) {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] && !b[i] ? 1 : 0;
  return o;
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

// Colour features: lightness plus two opponent-colour axes. Lightness counts for
// less than colour, because shadows and uneven light change it the most.
function feat(r, g, b) {
  return [0.299 * r + 0.587 * g + 0.114 * b, (r - g) * 0.7071, (r + g - 2 * b) * 0.4082];
}
const L_WEIGHT = 0.35;
const TYPE_CODE = { none: 0, black: 1, blue: 2, red: 3, green: 4, orange: 5 };
const CODE_TYPE = ['none', 'black', 'blue', 'red', 'green', 'orange'];

// Look-up table from (quantised) colour to game type, rebuilt only when settings change.
let lutCache = { key: '', lut: null };
function getLUT(o) {
  const key = JSON.stringify([o.sensitivity, o.colourMatch, o.samples]);
  if (lutCache.key === key) return lutCache.lut;
  const blackL = 2 * 240 * o.sensitivity - 240;       // paper/black midpoint sits at 240 x sensitivity
  const protos = [
    { type: 'none', f: feat(240, 240, 240), w: 1 },     // paper
    { type: 'black', f: [Math.max(0, blackL), 0, 0], w: 1 },
    { type: 'black', f: [Math.max(0, blackL - 40), 0, 0], w: 1 },
    ...BUILT_IN.map(([type, r, g, b]) => ({ type, f: feat(r, g, b), w: 1 })),
    // Teacher fixes win ties with the built-in examples.
    ...o.samples.filter((sm) => sm.type === 'ignore' || TYPE_CODE[sm.type])
      .map((sm) => ({ type: sm.type === 'ignore' ? 'none' : sm.type, f: feat(sm.r, sm.g, sm.b), w: 0.8 })),
  ];
  const maxD2 = o.colourMatch * o.colourMatch;
  const lut = new Uint8Array(32 * 32 * 32);
  for (let qr = 0; qr < 32; qr++) for (let qg = 0; qg < 32; qg++) for (let qb = 0; qb < 32; qb++) {
    const [L, a, bb] = feat(qr * 8 + 4, qg * 8 + 4, qb * 8 + 4);
    let best = 'none', bestD = Infinity;
    for (const p of protos) {
      const dl = (L - p.f[0]) * L_WEIGHT, da = a - p.f[1], db = bb - p.f[2];
      const d = (dl * dl + da * da + db * db) * p.w * p.w;
      if (d < bestD) { bestD = d; best = p.type; }
    }
    lut[(qr << 10) | (qg << 5) | qb] = bestD <= maxD2 || best === 'none' ? TYPE_CODE[best] : 0;
  }
  lutCache = { key, lut };
  return lut;
}

// Colour examples from the ink around a point (for fixing a mistake).
// Returns up to three samples (typical, darker and lighter parts), or null if it's blank paper.
export function sampleColours(det, x, y, radius = 12) {
  const s = det.scale, r = Math.round(radius / s);
  const cx = Math.round(x / s), cy = Math.round(y / s);
  const px = [];
  for (let yy = cy - r; yy <= cy + r; yy++) {
    for (let xx = cx - r; xx <= cx + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= det.w || yy >= det.h || (xx - cx) ** 2 + (yy - cy) ** 2 > r * r) continue;
      const i = (yy * det.w + xx) * 3;
      const c = [det.norm[i], det.norm[i + 1], det.norm[i + 2]];
      const [L, a, b] = feat(...c);
      if (L < 205 || Math.hypot(a, b) > 28) px.push({ c, L }); // looks like ink, not paper
    }
  }
  if (px.length < 4) return null;
  px.sort((p, q) => p.L - q.L);
  const median = (arr) => [0, 1, 2].map((k) => arr.map((p) => p.c[k]).sort((m, n) => m - n)[arr.length >> 1]);
  const third = Math.max(1, Math.floor(px.length / 3));
  const picks = [median(px), median(px.slice(0, third)), median(px.slice(-third))];
  return picks.map(([r2, g2, b2]) => ({ r: Math.round(r2), g: Math.round(g2), b: Math.round(b2) }));
}

// Which colour the detector currently sees at a point (nearest within a radius).
export function colourAt(det, x, y, radius = 10) {
  const s = det.scale, r = Math.round(radius / s);
  const cx = Math.round(x / s), cy = Math.round(y / s);
  let best = null, bestD = Infinity;
  for (const t of COLOURS) {
    const m = det.masks[t];
    for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= det.w || yy >= det.h || !m[yy * det.w + xx]) continue;
      const d = (xx - cx) ** 2 + (yy - cy) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
  }
  return best;
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
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.min(255, grey[i] | 0)]++;
  let cut = 255;
  for (let v = 0, acc = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.7) { cut = v; break; } }
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
  const raw = {};
  for (const c of COLOURS) raw[c] = new Uint8Array(n);
  const anyColour = new Uint8Array(n);
  const norm = new Uint8Array(n * 3);   // kept so the teacher can fix colours by clicking
  const lut = getLUT(o);
  const m = o.margin;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Normalise so the local paper reads as white (removes tinted / uneven light).
      const lr = local[0][i], lg = local[1][i], lb = local[2][i];
      const r = Math.min(255, (R[i] / Math.max(lr, 0.6 * lr + 0.4 * paper[0], 1)) * 240) | 0;
      const g = Math.min(255, (G[i] / Math.max(lg, 0.6 * lg + 0.4 * paper[1], 1)) * 240) | 0;
      const b = Math.min(255, (B[i] / Math.max(lb, 0.6 * lb + 0.4 * paper[2], 1)) * 240) | 0;
      norm[i * 3] = r; norm[i * 3 + 1] = g; norm[i * 3 + 2] = b;
      if (x < m || y < m || x >= w - m || y >= h - m) continue;
      const code = lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
      if (!code) continue;
      raw[CODE_TYPE[code]][i] = 1;
      if (code > 1) anyColour[i] = 1;
    }
  }

  // 4. Clean up: edges where black meets colour produce misleading fringes.
  const blackNear = dilate(raw.black, w, h, 1);
  const colourNear = dilate(anyColour, w, h, 1);
  const cleaned = {
    black: close(andNot(raw.black, colourNear), w, h, Math.round(o.gapFill)),
  };
  for (const t of ['blue', 'red', 'green', 'orange']) cleaned[t] = close(andNot(raw[t], blackNear), w, h, 1);
  // A blue line can't also be black.
  cleaned.black = andNot(cleaned.black, cleaned.blue);
  // The darker edges of orange marks can read as red: they never count as red.
  cleaned.red = andNot(cleaned.red, dilate(cleaned.orange, w, h, 3));

  // 5. Components per colour. Orange is often drawn as small dots, so smaller marks count.
  const masks = {};
  const outlines = [];
  const blobs = {};
  const counts = {};
  for (const t of COLOURS) {
    const res = components(cleaned[t], w, h, t === 'orange' ? Math.max(6, o.minArea / 2) : o.minArea, s);
    masks[t] = res.mask;
    counts[t] = res.blobs.length;
    blobs[t] = res.blobs.map((b) => ({ x: b.cx, y: b.cy, area: b.area, points: b.points }));
    for (const b of res.blobs) outlines.push({ type: t, points: b.points });
  }
  return { w, h, scale: s, masks, outlines, blobs, counts, norm };
}
