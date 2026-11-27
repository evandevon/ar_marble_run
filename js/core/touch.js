// On-screen controls: a D-pad on the left, A and B buttons on the right.
// Each control tracks its own finger, so moving and jumping at the same time works.
//
//   D-pad  four directions; slide your thumb between them (diagonals work)
//   A, B   two action buttons. Each game decides what they do.

export class TouchControls {
  constructor({ dpad, thumb, a, b }) {
    this.dpad = dpad;
    this.thumb = thumb;
    this.left = false;
    this.right = false;
    this.up = false;
    this.down = false;
    this.a = false;
    this.b = false;
    this.pressed = { up: false, down: false, a: false, b: false };   // since the last read
    this.padPointer = null;
    this.arrows = {
      up: dpad.querySelector('.dp.up'), down: dpad.querySelector('.dp.down'),
      left: dpad.querySelector('.dp.left'), right: dpad.querySelector('.dp.right'),
    };

    // --- D-pad
    dpad.addEventListener('pointerdown', (e) => {
      if (this.padPointer !== null) return;
      e.preventDefault();
      this.padPointer = e.pointerId;
      dpad.setPointerCapture(e.pointerId);
      this.padMove(e);
    });
    dpad.addEventListener('pointermove', (e) => { if (e.pointerId === this.padPointer) this.padMove(e); });
    const padEnd = (e) => { if (e.pointerId === this.padPointer) this.padRelease(); };
    dpad.addEventListener('pointerup', padEnd);
    dpad.addEventListener('pointercancel', padEnd);
    dpad.addEventListener('lostpointercapture', padEnd);

    // --- A / B buttons
    for (const [el, key] of [[a, 'a'], [b, 'b']]) {
      let id = null;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (id !== null) return;
        id = e.pointerId;
        el.setPointerCapture(e.pointerId);
        if (!this[key]) this.pressed[key] = true;
        this[key] = true;
        el.classList.add('on');
        try { navigator.vibrate?.(8); } catch { /* not supported */ }
      });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null;
        this[key] = false;
        el.classList.remove('on');
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
    }

    // Long presses must not open menus or select text.
    for (const el of [dpad, a, b]) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  padMove(e) {
    const r = this.dpad.getBoundingClientRect();
    const rad = r.width / 2;
    let dx = (e.clientX - (r.left + rad)) / rad;
    let dy = (e.clientY - (r.top + rad)) / rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.left = dx < -0.3;
    this.right = dx > 0.3;
    const up = dy < -0.5, down = dy > 0.5;
    if (up && !this.up) this.pressed.up = true;
    if (down && !this.down) this.pressed.down = true;
    this.up = up;
    this.down = down;
    this.thumb.style.transform = `translate(calc(-50% + ${dx * rad * 0.55}px), calc(-50% + ${dy * rad * 0.55}px))`;
    this.showArrows();
  }

  padRelease() {
    this.padPointer = null;
    this.left = this.right = this.up = this.down = false;
    this.thumb.style.transform = '';
    this.showArrows();
  }

  showArrows() {
    this.arrows.left.classList.toggle('on', this.left);
    this.arrows.right.classList.toggle('on', this.right);
    this.arrows.up.classList.toggle('on', this.up);
    this.arrows.down.classList.toggle('on', this.down);
  }

  // Current state, plus which controls were pressed since the last read.
  read() {
    const p = this.pressed;
    this.pressed = { up: false, down: false, a: false, b: false };
    return {
      left: this.left, right: this.right, up: this.up, down: this.down, a: this.a, b: this.b,
      upPressed: p.up, downPressed: p.down, aPressed: p.a, bPressed: p.b,
    };
  }

  reset() {
    this.padRelease();
    this.a = this.b = false;
    this.pressed = { up: false, down: false, a: false, b: false };
  }
}
