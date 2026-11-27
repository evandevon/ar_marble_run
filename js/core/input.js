// One input shape for every game, merged from the keyboard, game controllers and
// the on-screen touch controls:
//
//   { left, right, up, down, a, b }                       held this step
//   { upPressed, downPressed, aPressed, bPressed }        newly pressed this step
//   { upKey, upKeyPressed }   up from the keyboard or a controller only (not the
//                             touch D-pad), for games where up means jump
//
//   Keyboard  arrows or WASD to move · A button: Space or Z · B button: X or Shift
//   Gamepad   stick or d-pad to move · A / B buttons

const DIRS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  a: ['Space', 'KeyZ'],
  b: ['KeyX', 'ShiftLeft', 'ShiftRight'],
};
export const GAME_KEYS = Object.values(DIRS).flat();
const NAMES = Object.keys(DIRS);

export class Input {
  constructor(touch) {
    this.touch = touch;
    this.keys = new Set();
    this.keyPressed = {};
    this.padWas = {};
  }

  keyDown(code) {
    if (!this.keys.has(code)) for (const n of NAMES) if (DIRS[n].includes(code)) this.keyPressed[n] = true;
    this.keys.add(code);
  }
  keyUp(code) { this.keys.delete(code); }
  clear() { this.keys.clear(); this.keyPressed = {}; this.touch?.reset(); }

  read() {
    const held = {}, pressed = {};
    for (const n of NAMES) {
      held[n] = DIRS[n].some((k) => this.keys.has(k));
      pressed[n] = !!this.keyPressed[n];
    }
    this.keyPressed = {};

    for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (!pad) continue;
      const btn = (i) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const now = {
        left: ax < -0.35 || btn(14), right: ax > 0.35 || btn(15),
        up: ay < -0.5 || btn(12), down: ay > 0.5 || btn(13),
        a: btn(0), b: btn(1),
      };
      const was = this.padWas[pad.index] || {};
      for (const n of NAMES) {
        if (now[n]) held[n] = true;
        if (now[n] && !was[n]) pressed[n] = true;
      }
      this.padWas[pad.index] = now;
    }

    const upKey = held.up, upKeyPressed = pressed.up;
    if (this.touch) {
      const t = this.touch.read();
      for (const n of NAMES) {
        if (t[n]) held[n] = true;
        if (t[`${n}Pressed`]) pressed[n] = true;
      }
    }
    return {
      ...held,
      upPressed: pressed.up, downPressed: pressed.down, aPressed: pressed.a, bPressed: pressed.b,
      leftPressed: pressed.left, rightPressed: pressed.right,
      upKey, upKeyPressed,
    };
  }
}

// Gamepad buttons the app itself uses (Start, Back/Y), read once per frame.
export function padButtonsPressed(state) {
  const out = { start: false, restart: false };
  for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!pad) continue;
    const btn = (i) => !!pad.buttons[i]?.pressed;
    const was = state[pad.index] || {};
    const now = { start: btn(9), restart: btn(3) || btn(8) };
    if (now.start && !was.start) out.start = true;
    if (now.restart && !was.restart) out.restart = true;
    state[pad.index] = now;
  }
  return out;
}
