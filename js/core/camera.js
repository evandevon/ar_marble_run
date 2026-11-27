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
