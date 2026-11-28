// Projector mode: a second window shown by the projector, and the automatic
// line-up that works out where the projected picture lands in the camera view.
//
//   Line up     The projector shows white dots on black, one at a time. The
//               camera finds each dot by comparing with an all-black picture.
//               Nine dots give a best-fit perspective map from projector pixels
//               to camera pixels.
//   The level   is a rectangle of the projected picture (the paper's shape,
//               as large as fits). Its four corners in the camera view become
//               the setup corners, so scanning works exactly as in screen mode,
//               and anything drawn at a level position is projected on top of
//               the ink at that position.

import { fitHomography, applyHomography } from './homography.js';

const GRID = [0.1, 0.5, 0.9];       // dot positions, as fractions of the window
const DOT_R = 0.035;                // dot radius, as a fraction of the window's shorter side
const SETTLE_MS = 550;              // wait for the projector and camera to catch up
const MARGIN = 0.03;                // gap around the level inside the projected picture

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Projector {
  constructor({ worldW, worldH, onState }) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.win = null;
    this.canvas = null;
    this.pattern = null;    // what to show while lining up: { kind: 'black' | 'dot' | 'white', x, y }
    this.cal = null;        // { w, h, rect, H } from the last line-up
    this.onState = onState || (() => {});
  }

  get open() { return !!this.win && !this.win.closed && !!this.canvas; }
  // The window's size in CSS pixels.
  size() { return this.open ? { w: this.win.innerWidth, h: this.win.innerHeight } : null; }
  get fullscreen() { return this.open && !!this.win.document.fullscreenElement; }
  // The window changed size since the line-up (e.g. it went full screen after).
  get stale() {
    const s = this.size();
    return !!(this.cal && s && (Math.abs(s.w - this.cal.w) > 2 || Math.abs(s.h - this.cal.h) > 2));
  }

  // Must be called from a click (pop-up blockers).
  openWindow() {
    if (this.open) { this.win.focus(); return true; }
    const w = window.open('projector.html', 'paper-arcade-projector', 'popup,width=960,height=600');
    if (!w) return false;
    this.win = w;
    this.canvas = null;
    return true;
  }
  close() {
    if (this.win && !this.win.closed) this.win.close();
    this.win = null;
    this.canvas = null;
  }
  // Called by projector.html once its canvas exists.
  attach(win, canvas) {
    this.win = win;
    this.canvas = canvas;
    win.addEventListener('resize', () => this.onState());
    win.document.addEventListener('fullscreenchange', () => this.onState());
    win.addEventListener('pagehide', () => { if (this.win === win) { this.canvas = null; this.onState(); } });
    this.onState();
  }

  // The level's rectangle inside a w x h window: the paper's shape, as large as fits.
  static levelRect(w, h, worldW, worldH) {
    const aw = w * (1 - 2 * MARGIN), ah = h * (1 - 2 * MARGIN);
    const s = Math.min(aw / worldW, ah / worldH);
    const rw = worldW * s, rh = worldH * s;
    return { x: (w - rw) / 2, y: (h - rh) / 2, w: rw, h: rh, s };
  }

  // ------------------------------------------------------------ lining up
  // capture() returns the current camera ImageData. progress(text) reports
  // along the way. Resolves to { ok, msg, corners?, error? }.
  async lineUp(capture, progress = () => {}) {
    if (!this.open) return { ok: false, msg: 'Open the projector window first.' };
    const { w, h } = this.size();
    const r = DOT_R * Math.min(w, h);
    const targets = [];
    for (const fy of GRID) for (const fx of GRID) targets.push({ x: fx * w, y: fy * h });
    try {
      progress('Looking at the board…');
      this.pattern = { kind: 'black' };
      await wait(SETTLE_MS + 250);
      const base = await average(capture);
      const found = [];
      let i = 0;
      for (const t of targets) {
        progress(`Finding dot ${++i} of ${targets.length}…`);
        this.pattern = { kind: 'dot', x: t.x, y: t.y, r };
        await wait(SETTLE_MS);
        const spot = findSpot(base, await average(capture));
        if (spot) found.push({ proj: t, cam: spot });
      }
      this.pattern = { kind: 'black' };
      if (found.length < 6) {
        return { ok: false, msg: found.length
          ? `The camera only saw ${found.length} of the 9 dots. Point it so it sees the whole projected picture, dim the lights a little, and try again.`
          : 'The camera couldn’t see the projected dots. Check the projector window is on the projector and full screen, and that the camera can see the board.' };
      }
      const H = fitHomography(found.map((f) => f.proj), found.map((f) => f.cam));
      // How well the fit matches what was seen, in camera pixels.
      const err = found.reduce((s, f) => {
        const p = applyHomography(H, f.proj.x, f.proj.y);
        return s + Math.hypot(p.x - f.cam.x, p.y - f.cam.y);
      }, 0) / found.length;
      const camW = base.w;
      if (err > camW * 0.02) {
        return { ok: false, msg: 'The dots didn’t line up neatly (something moved, or the board isn’t flat). Keep the camera still and try again.' };
      }
      const rect = Projector.levelRect(w, h, this.worldW, this.worldH);
      const corners = [
        [rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h],
      ].map(([x, y]) => applyHomography(H, x, y));
      const outside = corners.some((c) => c.x < -2 || c.y < -2 || c.x > base.w + 2 || c.y > base.h + 2);
      this.cal = { w, h, rect, H, err };
      const missed = targets.length - found.length;
      let msg = `Lined up ✓ (${found.length} of 9 dots, accurate to about ${Math.max(1, Math.round(err))} camera pixel${Math.round(err) > 1 ? 's' : ''}).`;
      if (missed) msg += ' Some dots were missed; if the game doesn’t sit on the drawing, line up again.';
      if (outside) msg += ' The camera can’t see all of the projected picture: move it back, or the edges won’t be scanned.';
      return { ok: true, msg, corners, error: err };
    } catch (e) {
      return { ok: false, msg: 'Lining up failed: ' + (e.message || e) };
    } finally {
      this.pattern = null;
    }
  }

  // ------------------------------------------------------------ drawing
  // drawLevel(ctx) draws the game in level coordinates (0..worldW, 0..worldH)
  // onto a black background. Returns false if there's nothing to draw into.
  render(drawLevel) {
    if (!this.open) return false;
    const win = this.win, cv = this.canvas;
    const dpr = win.devicePixelRatio || 1;
    const w = win.innerWidth, h = win.innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const p = this.pattern;
    if (p) {
      if (p.kind === 'dot') {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    }
    if (!this.cal) {
      message(ctx, w, h, ['Projector window', 'Make this window full screen on the projector (click here),', 'then press “Line up” on the main screen.']);
      return true;
    }
    if (this.stale) {
      message(ctx, w, h, ['This window changed size', 'Press “Line up” on the main screen again.']);
      return true;
    }
    const r = this.cal.rect;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.scale(r.s, r.s);
    drawLevel(ctx);
    ctx.restore();
    return true;
  }
}

function message(ctx, w, h, lines) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  const size = Math.max(16, Math.min(w, h) * 0.05);
  lines.forEach((t, i) => {
    ctx.font = `${i ? '' : 'bold '}${i ? size * 0.55 : size}px system-ui, sans-serif`;
    ctx.fillText(t, w / 2, h / 2 + (i ? size * 0.4 + i * size * 0.8 : -size * 0.6));
  });
  ctx.restore();
}

// A few camera frames averaged, which smooths out the camera's grain.
async function average(capture, n = 3) {
  let acc = null;
  for (let i = 0; i < n; i++) {
    if (i) await wait(70);
    const l = luminance(capture());
    if (!acc) acc = l;
    else for (let j = 0; j < acc.L.length; j++) acc.L[j] += l.L[j];
  }
  for (let j = 0; j < acc.L.length; j++) acc.L[j] /= n;
  return acc;
}

// Brightness of every pixel, at half size (plenty for finding dots).
function luminance(img) {
  const w = img.width >> 1, h = img.height >> 1, d = img.data, sw = img.width;
  const L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const j = ((y * 2 + oy) * sw + x * 2 + ox) * 4;
      s += d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11;
    }
    L[y * w + x] = s / 4;
  }
  return { L, w: w * 2, h: h * 2, hw: w, hh: h };
}

// Where a projected dot appeared: the centre of the pixels that got much
// brighter than the black picture. Returns camera pixels, or null.
export function findSpot(base, now) {
  const { hw: w, hh: h } = base;
  if (now.hw !== w || now.hh !== h) return null;
  const diff = new Float32Array(w * h);
  let max = 0, sum = 0;
  for (let i = 0; i < diff.length; i++) {
    const d = now.L[i] - base.L[i];
    diff[i] = d;
    sum += d;
    if (d > max) max = d;
  }
  const mean = sum / diff.length;   // the whole picture got brighter (exposure): ignore that part
  if (max - mean < 18) return null;
  const thr = mean + (max - mean) * 0.5;
  let n = 0, sx = 0, sy = 0, sw = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = diff[y * w + x] - thr;
    if (d <= 0) continue;
    n++; sx += x * d; sy += y * d; sw += d;
  }
  if (n < 3 || n > diff.length * 0.05) return null;
  const cx = sx / sw, cy = sy / sw;
  // One compact spot, not scattered changes (someone walking past).
  let spread = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (diff[y * w + x] > thr) spread += Math.hypot(x - cx, y - cy);
  }
  if (spread / n > Math.max(w, h) * 0.05) return null;
  return { x: cx * 2 + 1, y: cy * 2 + 1 };
}
