// Video sources: a live webcam, a still photo, or a built-in demo drawing.
// Every source exposes the same tiny interface:
//   source.width, source.height  (after rotation)
//   source.draw()    -> canvas holding the current, correctly oriented frame
//   source.capture() -> ImageData of that frame
//   source.setOrientation({ rotate: 0|90|180|270, flipH, flipV })

export async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

// Shared rotate / flip handling.
class OrientedSource {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.orient = { rotate: 0, flipH: false, flipV: false };
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  // Raw (unrotated) size of the underlying image; set by subclasses.
  get rawSize() { return { w: 1, h: 1 }; }
  get rawElement() { return null; }

  setOrientation(o) {
    this.orient = { ...this.orient, ...o };
    this.orient.rotate = ((this.orient.rotate % 360) + 360) % 360;
    this.resize();
  }

  resize() {
    const { w, h } = this.rawSize;
    const sideways = this.orient.rotate === 90 || this.orient.rotate === 270;
    this.canvas.width = sideways ? h : w;
    this.canvas.height = sideways ? w : h;
  }

  draw() {
    const { w, h } = this.rawSize;
    const c = this.ctx;
    const o = this.orient;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.translate(this.canvas.width / 2, this.canvas.height / 2);
    c.rotate((o.rotate * Math.PI) / 180);
    c.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
    c.drawImage(this.rawElement, -w / 2, -h / 2, w, h);
    c.setTransform(1, 0, 0, 1, 0, 0);
    return this.canvas;
  }

  capture() {
    this.draw();
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }
}

export class WebcamSource extends OrientedSource {
  constructor(video) {
    super();
    this.video = video;
    this.stream = null;
    this.kind = 'webcam';
  }

  get rawSize() { return { w: this.video.videoWidth || 1, h: this.video.videoHeight || 1 }; }
  get rawElement() { return this.video; }

  async start(deviceId) {
    this.stop();
    const video = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      // Phones and tablets: use the back camera unless a camera is chosen.
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
    };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise((r) => (this.video.videoWidth ? r() : (this.video.onloadedmetadata = r)));
    this.resize();
  }

  // Freeze auto exposure / white balance so colours stay steady when hands
  // move over the paper. Not every webcam allows this.
  async lockColours() {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return { ok: false, msg: 'This browser cannot lock camera settings.' };
    const caps = track.getCapabilities();
    const adv = {};
    if (caps.exposureMode && caps.exposureMode.includes('manual')) adv.exposureMode = 'manual';
    if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('manual')) adv.whiteBalanceMode = 'manual';
    if (caps.focusMode && caps.focusMode.includes('manual')) adv.focusMode = 'manual';
    if (!Object.keys(adv).length) return { ok: false, msg: 'This camera does not allow locking. It will still work.' };
    try {
      await track.applyConstraints({ advanced: [adv] });
      return { ok: true, msg: 'Locked: ' + Object.keys(adv).map((k) => k.replace('Mode', '')).join(', ') };
    } catch (e) {
      return { ok: false, msg: 'Could not lock: ' + e.message };
    }
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

// A still image (a phone photo of a drawing, or the demo drawing).
export class ImageSource extends OrientedSource {
  constructor(canvasOrImage) {
    super();
    this.img = canvasOrImage;
    this.kind = 'image';
    this.frame = null;
    this.resize();
  }
  get rawSize() { return { w: this.img.naturalWidth || this.img.width, h: this.img.naturalHeight || this.img.height }; }
  get rawElement() { return this.img; }
  resize() { super.resize(); this.frame = null; }
  draw() {
    if (!this.frame) { super.draw(); this.frame = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height); }
    return this.canvas;
  }
  capture() { this.draw(); return this.frame; }
  async lockColours() { return { ok: true, msg: 'Still image: nothing to lock.' }; }
  stop() {}
}

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// A hand-drawn-looking test level so the game can be tried without a camera.
// Drawn slightly in perspective, on a grey "table", like a real camera view.
export function makeDemoDrawing() {
  const W = 1280, H = 720;
  const paper = document.createElement('canvas');
  paper.width = 1000; paper.height = 707;
  const p = paper.getContext('2d');
  p.fillStyle = '#f7f6f1';
  p.fillRect(0, 0, 1000, 707);
  p.strokeStyle = '#151515';
  p.lineCap = 'round';
  p.lineJoin = 'round';

  // Seeded wobble so the lines look hand drawn but are the same every time.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const wobbly = (pts, width) => {
    p.lineWidth = width;
    p.beginPath();
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 25));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = x0 + (x1 - x0) * t + rand() * 3;
        const y = y0 + (y1 - y0) * t + rand() * 3;
        if (i === 0 && s === 0) p.moveTo(x, y); else p.lineTo(x, y);
      }
    }
    p.stroke();
  };
  const INK = { black: '#161616', red: '#cf2e2e', blue: '#1f5fd1', green: '#1e9a4b', orange: '#f28a1c' };
  const fillPoly = (pts, colour) => {
    p.fillStyle = colour;
    p.beginPath();
    pts.forEach(([x, y], i) => (i ? p.lineTo(x + rand() * 2, y + rand() * 2) : p.moveTo(x, y)));
    p.closePath();
    p.fill();
  };
  const dot = (x, y, r, colour) => { p.fillStyle = colour; p.beginPath(); p.arc(x, y, r, 0, Math.PI * 2); p.fill(); };

  p.strokeStyle = INK.black;
  wobbly([[30, 600], [270, 600]], 10);               // starting ground
  wobbly([[400, 598], [560, 568]], 10);              // gentle slope
  wobbly([[730, 480], [920, 480]], 10);              // high ledge (reach it with the trampoline)
  wobbly([[560, 395], [680, 395]], 10);
  wobbly([[310, 330], [480, 330]], 10);
  wobbly([[60, 270], [230, 270]], 10);               // goal ledge
  wobbly([[920, 480], [925, 405]], 9);               // little wall at the ledge end

  // Lava pit
  const lava = [[285, 690]];
  for (let x = 285; x <= 385; x += 10) lava.push([x, 655 + Math.sin(x / 9) * 5]);
  lava.push([385, 690]);
  fillPoly(lava, INK.red);
  // Spikes
  fillPoly([[378, 327], [387, 307], [396, 327], [405, 307], [414, 327]], INK.red);

  // Trampoline
  p.strokeStyle = INK.blue;
  wobbly([[612, 615], [702, 615]], 13);

  // Goal flag
  p.strokeStyle = INK.green;
  wobbly([[112, 265], [112, 185]], 7);
  fillPoly([[112, 183], [165, 199], [112, 217]], INK.green);

  // Coins
  for (const [x, y] of [[335, 535], [790, 440], [850, 440], [396, 265]]) dot(x, y, 10, INK.orange);

  // Faint pencil smudge that should be ignored
  p.fillStyle = 'rgba(0,0,0,0.08)';
  p.fillRect(820, 600, 70, 30);

  // Place the paper on a table, viewed at a slight angle.
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const c = out.getContext('2d');
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#6b6458');
  g.addColorStop(1, '#4e4940');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const corners = [{ x: 210, y: 70 }, { x: 1090, y: 95 }, { x: 1150, y: 670 }, { x: 140, y: 650 }];
  // Draw the paper warped: slice into thin horizontal strips (good enough for a demo).
  const strips = 140;
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips, t1 = (i + 1) / strips;
    const L0 = lerpPt(corners[0], corners[3], t0), R0 = lerpPt(corners[1], corners[2], t0);
    const L1 = lerpPt(corners[0], corners[3], t1);
    c.save();
    c.setTransform((R0.x - L0.x) / 1000, (R0.y - L0.y) / 1000,
      (L1.x - L0.x) / (707 / strips), (L1.y - L0.y) / (707 / strips), L0.x, L0.y);
    c.drawImage(paper, 0, t0 * 707, 1000, 707 / strips + 1, 0, 0, 1000, 707 / strips + 1);
    c.restore();
  }
  // Soft lighting gradient, like a real room.
  const shade = c.createRadialGradient(300, 200, 50, 640, 360, 900);
  shade.addColorStop(0, 'rgba(255,255,255,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.18)');
  c.fillStyle = shade;
  c.fillRect(0, 0, W, H);
  return { canvas: out, corners, start: { x: 80, y: 560 } };
}

function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
