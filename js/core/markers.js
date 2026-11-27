// Finds the four solid black corner squares printed on the level sheet
// (template.html). Their inner corners mark the drawing area exactly, so scans,
// photos and the webcam can be cropped without clicking corners.
//
// Returns [TL, TR, BR, BL] in source pixels, or null if the marks aren't found.

export function findCornerMarks(img) {
  const { width: W, height: H, data } = img;
  const s = Math.max(1, Math.ceil(Math.max(W, H) / 700));
  const w = Math.floor(W / s), h = Math.floor(H / s), n = w * h;

  // Grey, downscaled
  const grey = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = ((y * s) * W + x * s) * 4;
    grey[y * w + x] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  // Paper brightness (80th percentile) -> dark threshold
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[grey[i]]++;
  let paper = 255;
  for (let v = 0, acc = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.8) { paper = v; break; } }
  const thr = paper * 0.45;

  // Connected components of dark pixels (4-connected)
  const labels = new Int32Array(n);
  const queue = new Int32Array(n);
  const minA = n * 0.0003, maxA = n * 0.03;
  const cands = [];
  let next = 1;
  for (let start = 0; start < n; start++) {
    if (labels[start] || grey[start] >= thr) continue;
    const id = next++;
    let head = 0, tail = 0, sx = 0, sy = 0, minX = w, minY = h, maxX = 0, maxY = 0;
    queue[tail++] = start; labels[start] = id;
    while (head < tail) {
      const p = queue[head++], px = p % w, py = (p / w) | 0;
      sx += px; sy += py;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      const nb = [p - 1, p + 1, p - w, p + w];
      const ok = [px > 0, px < w - 1, py > 0, py < h - 1];
      for (let k = 0; k < 4; k++) {
        const q = nb[k];
        if (ok[k] && !labels[q] && grey[q] < thr) { labels[q] = id; queue[tail++] = q; }
      }
    }
    const area = tail;
    if (area < minA || area > maxA) continue;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const aspect = bw / bh, fill = area / (bw * bh);
    if (aspect < 0.55 || aspect > 1.8 || fill < 0.5) continue;
    cands.push({ id, area, cx: sx / area, cy: sy / area, pixels: queue.slice(0, tail) });
  }
  if (cands.length < 4) return null;

  // Best candidate for each image corner
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  const picks = corners.map(([qx, qy]) => {
    let best = null, bestScore = Infinity;
    for (const c of cands) {
      const dx = Math.abs(c.cx - qx) / w, dy = Math.abs(c.cy - qy) / h;
      if (dx > 0.4 || dy > 0.4) continue;
      const score = Math.hypot(dx, dy) / Math.sqrt(c.area);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  });
  if (picks.some((p) => !p) || new Set(picks.map((p) => p.id)).size < 4) return null;
  const areas = picks.map((p) => p.area);
  if (Math.max(...areas) / Math.min(...areas) > 4) return null;

  // Inner corner of each square: the pixel furthest toward the middle of the four.
  const mx = picks.reduce((a, p) => a + p.cx, 0) / 4, my = picks.reduce((a, p) => a + p.cy, 0) / 4;
  const pts = picks.map((p) => {
    const vx = mx - p.cx, vy = my - p.cy, len = Math.hypot(vx, vy) || 1;
    const ux = vx / len, uy = vy / len;
    let best = 0, bestD = -Infinity;
    for (const q of p.pixels) {
      const d = ((q % w) - p.cx) * ux + (((q / w) | 0) - p.cy) * uy;
      if (d > bestD) { bestD = d; best = q; }
    }
    return { x: ((best % w) + 0.5) * s, y: (((best / w) | 0) + 0.5) * s };
  });

  // Sanity: the drawing area should be a decent-sized, convex quadrilateral.
  let area2 = 0;
  for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; area2 += a.x * b.y - b.x * a.y; }
  if (Math.abs(area2) / 2 < W * H * 0.15) return null;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0) return null;
  }
  return pts;
}
