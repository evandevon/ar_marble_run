// The marker colours the camera can tell apart. Games give each one a meaning.

export const COLOUR_INFO = {
  black: { name: 'Black', swatch: '#23262e', outline: '#19c3ff', clean: [35, 38, 46] },
  blue: { name: 'Blue', swatch: '#2a64e0', outline: '#3a7bff', clean: [42, 100, 224] },
  red: { name: 'Red', swatch: '#d8322a', outline: '#ff3b30', clean: [216, 50, 42] },
  green: { name: 'Green', swatch: '#22a85a', outline: '#2ecc71', clean: [34, 168, 90] },
  orange: { name: 'Orange / yellow', swatch: '#f39c12', outline: '#ffb703', clean: [243, 156, 18] },
};
export const COLOUR_IDS = Object.keys(COLOUR_INFO);

// Draw the detected colours into a small image, used for the clean view and Fix colours.
export function buildCleanImage(det, canvas, used = COLOUR_IDS) {
  canvas.width = det.w;
  canvas.height = det.h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(det.w, det.h);
  const d = img.data;
  for (const t of used) {
    const m = det.masks[t];
    const [r, g, b] = COLOUR_INFO[t].clean;
    for (let i = 0; i < m.length; i++) if (m[i]) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
}

export function tracePath(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

// Build mode: outline what the camera sees, in each colour.
export function drawOutlines(ctx, det, used = COLOUR_IDS) {
  ctx.save();
  ctx.lineJoin = 'round';
  for (const o of det.outlines) {
    if (!used.includes(o.type)) continue;
    const col = COLOUR_INFO[o.type].outline;
    tracePath(ctx, o.points);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = col;
    ctx.stroke();
  }
  ctx.restore();
}
