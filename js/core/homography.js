// Perspective transform helpers.
// A homography maps points from one quadrilateral to another, which is how we
// "flatten" the camera's angled view of the paper into a clean rectangle.

// Solve A x = b with Gaussian elimination (A is n x n).
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    }
    [M[c], M[pivot]] = [M[pivot], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) throw new Error('Corners are degenerate');
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Returns a 3x3 matrix (flat array of 9) mapping src[i] -> dst[i].
// src and dst are arrays of four {x, y} points.
export function computeHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

export function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

// Warp the source image into a flat outW x outH rectangle.
// H must map OUTPUT (paper) coordinates -> SOURCE (camera) coordinates.
export function warpImage(srcData, H, outW, outH, out) {
  const { data: s, width: sw, height: sh } = srcData;
  const d = out.data;
  let i = 0;
  for (let v = 0; v < outH; v++) {
    // Incremental evaluation along the row keeps this fast.
    let X = H[1] * v + H[2];
    let Y = H[4] * v + H[5];
    let W = H[7] * v + H[8];
    for (let u = 0; u < outW; u++) {
      const sx = (X / W) | 0;
      const sy = (Y / W) | 0;
      if (sx >= 0 && sy >= 0 && sx < sw && sy < sh) {
        const j = (sy * sw + sx) * 4;
        d[i] = s[j];
        d[i + 1] = s[j + 1];
        d[i + 2] = s[j + 2];
      } else {
        d[i] = d[i + 1] = d[i + 2] = 255; // outside the camera view: treat as paper
      }
      d[i + 3] = 255;
      i += 4;
      X += H[0];
      Y += H[3];
      W += H[6];
    }
  }
  return out;
}

// 3x3 matrix helpers (flat arrays of 9).
export function mulH(A, B) {
  const C = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  }
  return C;
}
export function invertH(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) throw new Error('Not invertible');
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
  return inv.map((v) => v / det);
}

// Best fit for four or more point pairs (least squares), so one slightly
// misplaced point doesn't throw the whole thing off. The points are scaled to
// a similar size first, which keeps the sums well behaved.
export function fitHomography(src, dst) {
  if (src.length < 4) throw new Error('Need at least four points');
  const norm = (pts) => {
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const d = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length || 1;
    const k = Math.SQRT2 / d;
    return [k, 0, -k * cx, 0, k, -k * cy, 0, 0, 1];
  };
  const Ts = norm(src), Td = norm(dst);
  const ns = src.map((p) => applyHomography(Ts, p.x, p.y));
  const nd = dst.map((p) => applyHomography(Td, p.x, p.y));
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const add = (row, rhs) => {
    for (let r = 0; r < 8; r++) {
      Atb[r] += row[r] * rhs;
      for (let c = 0; c < 8; c++) AtA[r][c] += row[r] * row[c];
    }
  };
  for (let i = 0; i < ns.length; i++) {
    const { x, y } = ns[i], { x: u, y: v } = nd[i];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const Hn = [...solve(AtA, Atb), 1];
  const H = mulH(invertH(Td), mulH(Hn, Ts));
  return H.map((v) => v / H[8]);
}
