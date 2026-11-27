// On-screen controls: a movement stick on the left, A and B buttons on the right.
// Each side tracks its own finger, so moving and jumping at the same time works.
//
//   Left half of the screen   touch anywhere and slide: the D-pad jumps to your
//                             thumb, so you never have to find it by looking.
//                             Sliding far drags the centre along, so turning round
//                             is a short slide back, not a long one.
//   Right half of the screen  touch anywhere: the nearest of A or B is pressed.
//                             Each game decides what A and B do.

const DEAD = 0.16;        // left / right: how far (as a fraction of the pad radius) before it counts
const DEAD_V = 0.55;      // up / down need a firmer push, so running doesn't press them by accident

export class TouchControls {
  constructor({ left, right, dpad, thumb, a, b }) {
    this.dpad = dpad;
    this.thumb = thumb;
    this.btns = { a, b };
    this.left = this.right = this.up = this.down = false;
    this.a = this.b = false;
    this.pressed = { up: false, down: false, a: false, b: false };   // since the last read
    this.padPointer = null;
    this.origin = null;     // where the stick's centre is (screen px)
    this.arrows = {
      up: dpad.querySelector('.dp.up'), down: dpad.querySelector('.dp.down'),
      left: dpad.querySelector('.dp.left'), right: dpad.querySelector('.dp.right'),
    };

    // --- movement (left half)
    left.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.padPointer !== null) return;
      this.padPointer = e.pointerId;
      try { left.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      // Touching the pad itself uses its centre, like a real D-pad. Anywhere
      // else, the pad comes to the thumb.
      const home = this.homeCentre();
      const r = this.radius();
      if (Math.hypot(e.clientX - home.x, e.clientY - home.y) <= r * 1.1) this.origin = home;
      else {
        this.origin = { x: e.clientX, y: e.clientY };
        this.placePad(this.origin);
      }
      this.padMove(e);
    });
    left.addEventListener('pointermove', (e) => { if (e.pointerId === this.padPointer) this.padMove(e); });
    const padEnd = (e) => { if (e.pointerId === this.padPointer) this.padRelease(); };
    left.addEventListener('pointerup', padEnd);
    left.addEventListener('pointercancel', padEnd);
    left.addEventListener('lostpointercapture', padEnd);

    // --- A / B (right half): the nearest button to the finger
    const fingers = new Map();   // pointerId -> 'a' | 'b'
    const press = (key) => {
      if (!this[key]) this.pressed[key] = true;
      this[key] = true;
      this.btns[key].classList.add('on');
      try { navigator.vibrate?.(8); } catch { /* not supported */ }
    };
    const releaseIfFree = (key) => {
      if ([...fingers.values()].includes(key)) return;
      this[key] = false;
      this.btns[key].classList.remove('on');
    };
    right.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { right.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const key = this.nearestButton(e.clientX, e.clientY);
      fingers.set(e.pointerId, key);
      press(key);
    });
    // Sliding a thumb from B onto A (or back) switches button, like a real pad.
    right.addEventListener('pointermove', (e) => {
      const was = fingers.get(e.pointerId);
      if (!was) return;
      const key = this.nearestButton(e.clientX, e.clientY, was);
      if (key === was) return;
      fingers.set(e.pointerId, key);
      releaseIfFree(was);
      press(key);
    });
    const end = (e) => {
      const key = fingers.get(e.pointerId);
      if (!key) return;
      fingers.delete(e.pointerId);
      releaseIfFree(key);
    };
    right.addEventListener('pointerup', end);
    right.addEventListener('pointercancel', end);
    right.addEventListener('lostpointercapture', end);
    this.fingers = fingers;

    // Long presses must not open menus or select text.
    for (const el of [left, right]) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  radius() { return this.dpad.offsetWidth / 2 || 75; }

  // Where the pad sits when nobody is touching it.
  homeCentre() {
    const moved = this.dpad.style.translate;
    this.dpad.style.translate = '';
    const r = this.dpad.getBoundingClientRect();
    this.dpad.style.translate = moved;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Draw the pad centred on a screen point.
  placePad(p) {
    const home = this.homeCentre();
    this.dpad.style.translate = `${p.x - home.x}px ${p.y - home.y}px`;
  }

  nearestButton(x, y, current) {
    let best = null, bestD = Infinity;
    for (const key of ['a', 'b']) {
      const r = this.btns[key].getBoundingClientRect();
      let d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (key === current) d -= r.width * 0.15;   // a little stickiness, so it doesn't flicker
      if (d < bestD) { bestD = d; best = key; }
    }
    return best;
  }

  padMove(e) {
    const rad = this.radius();
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    // Past the edge: drag the centre along, so reversing is a short slide.
    const len = Math.hypot(dx, dy);
    if (len > rad) {
      const k = (len - rad) / len;
      this.origin = { x: this.origin.x + dx * k, y: this.origin.y + dy * k };
      dx -= dx * k; dy -= dy * k;
      this.placePad(this.origin);
    }
    const nx = dx / rad, ny = dy / rad;
    this.left = nx < -DEAD;
    this.right = nx > DEAD;
    const up = ny < -DEAD_V, down = ny > DEAD_V;
    if (up && !this.up) this.pressed.up = true;
    if (down && !this.down) this.pressed.down = true;
    this.up = up;
    this.down = down;
    this.thumb.style.transform = `translate(calc(-50% + ${nx * rad * 0.55}px), calc(-50% + ${ny * rad * 0.55}px))`;
    this.showArrows();
  }

  padRelease() {
    this.padPointer = null;
    this.origin = null;
    this.left = this.right = this.up = this.down = false;
    this.thumb.style.transform = '';
    this.dpad.style.translate = '';
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
    this.fingers.clear();
    this.a = this.b = false;
    for (const k of ['a', 'b']) this.btns[k].classList.remove('on');
    this.pressed = { up: false, down: false, a: false, b: false };
  }
}
