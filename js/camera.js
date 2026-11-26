// Video sources: a live webcam, a still photo, or a built-in demo drawing.
// Every source exposes the same tiny interface:
//   source.width, source.height, source.capture() -> ImageData of the current frame

export async function listCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

export class WebcamSource {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.kind = 'webcam';
  }

  async start(deviceId) {
    this.stop();
    const video = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    };
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    await new Promise((r) => (this.video.videoWidth ? r() : (this.video.onloadedmetadata = r)));
    this.canvas.width = this.video.videoWidth;
    this.canvas.height = this.video.videoHeight;
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }
  get element() { return this.video; }

  capture() {
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
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

  async unlockColours() {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (!track) return;
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const adv = {};
    if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
    if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes('continuous')) adv.whiteBalanceMode = 'continuous';
    if (caps.focusMode && caps.focusMode.includes('continuous')) adv.focusMode = 'continuous';
    try { await track.applyConstraints({ advanced: [adv] }); } catch { /* ignore */ }
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

// A still image (a phone photo of a drawing, or the demo drawing).
export class ImageSource {
  constructor(canvasOrImage) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = canvasOrImage.naturalWidth || canvasOrImage.width;
    this.canvas.height = canvasOrImage.naturalHeight || canvasOrImage.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.drawImage(canvasOrImage, 0, 0);
    this.frame = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this.kind = 'image';
  }
  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }
  get element() { return this.canvas; }
  capture() { return this.frame; }
  async lockColours() { return { ok: true, msg: 'Still image: nothing to lock.' }; }
  async unlockColours() {}
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

// A hand-drawn-looking test sheet so the game can be tried without a camera.
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
  wobbly([[60, 170], [430, 260]], 9);            // first ramp
  wobbly([[560, 300], [940, 220]], 9);            // ramp back the other way
  // a curve
  const curve = [];
  for (let a = 0; a <= 1; a += 0.1) curve.push([380 + a * 380, 430 + Math.sin(a * Math.PI) * 70]);
  wobbly([[130, 360], [380, 430]], 8);
  wobbly(curve, 8);
  wobbly([[760, 430], [850, 400]], 8);
  // bucket
  wobbly([[300, 560], [320, 660], [470, 660], [490, 560]], 10);
  // a filled blob (cut-out style)
  p.fillStyle = '#1a1a1a';
  p.beginPath();
  p.ellipse(700, 600, 45, 28, 0.3, 0, Math.PI * 2);
  p.fill();
  // a broken line to show gap filling
  wobbly([[600, 120], [660, 130]], 7);
  wobbly([[664, 131], [720, 140]], 7);
  // pencil-faint smudge that should be ignored
  p.fillStyle = 'rgba(0,0,0,0.08)';
  p.fillRect(850, 600, 60, 30);

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
  return { canvas: out, corners };
}

function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
