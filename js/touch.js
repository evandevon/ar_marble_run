// On-screen controls: a D-pad on the left, A and B buttons on the right.
// Each control tracks its own finger, so moving and jumping at the same time works.
//
//   D-pad  left / right to run, up to jump (slide your thumb between directions)
//   A      jump
//   B      jump for now (spare for future actions and other game types)

export class TouchControls {
  constructor({ dpad, thumb, a, b }) {
    this.dpad = dpad;
    this.thumb = thumb;
    this.left = false;
    this.right = false;
    this.up = false;
    this.a = false;
    this.b = false;
    this.jumpQueued = false;
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
        if (!this[key]) this.jumpQueued = true;
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
    const up = dy < -0.5;
    if (up && !this.up) this.jumpQueued = true;
    this.up = up;
    this.thumb.style.transform = `translate(calc(-50% + ${dx * rad * 0.55}px), calc(-50% + ${dy * rad * 0.55}px))`;
    this.showArrows(dy > 0.5);
  }

  padRelease() {
    this.padPointer = null;
    this.left = this.right = this.up = false;
    this.thumb.style.transform = '';
    this.showArrows(false);
  }

  showArrows(down) {
    this.arrows.left.classList.toggle('on', this.left);
    this.arrows.right.classList.toggle('on', this.right);
    this.arrows.up.classList.toggle('on', this.up);
    this.arrows.down.classList.toggle('on', down);
  }

  // Merge into the game's input for this step.
  read() {
    const pressed = this.jumpQueued;
    this.jumpQueued = false;
    return {
      left: this.left,
      right: this.right,
      jumpHeld: this.up || this.a || this.b,
      jumpPressed: pressed,
    };
  }

  reset() {
    this.padRelease();
    this.a = this.b = false;
    this.jumpQueued = false;
  }
}
