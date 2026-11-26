// Platformer rules. The character collides directly with the ink masks, so any
// shape a child draws works as ground, no matter how wobbly.
//
// Units are world (paper) pixels; one update() is one 1/60 s step.
// The player's position is the centre of their feet.

export const PLAYER = {
  w: 16,            // hitbox width
  h: 42,            // hitbox height
  gravity: 0.5,
  jumpV: 10.2,      // ~104 px jump height
  runMax: 4.2,
  accel: 0.55,
  airAccel: 0.32,
  friction: 0.72,
  maxFall: 13,
  stepUp: 9,        // can walk up bumps/slopes this tall
  coyote: 6,        // frames you can still jump after running off a ledge
  buffer: 7,        // frames a jump press is remembered before landing
};
// Trampolines: on their own they bounce you to half a normal jump. Press jump
// while rising for more: the earlier the press, the higher you go, up to 1.5x a
// normal jump. (Height grows with speed squared, hence the square roots.)
PLAYER.bounceAuto = 0.5;   // fraction of a normal jump with no input
PLAYER.bounceMax = 1.5;    // fraction of a normal jump with a perfectly timed press
// Holding jump the whole time "pumps" the trampoline: each bounce in a row goes higher.
PLAYER.bounceGrow = 0.25;  // extra fraction of a jump per held bounce
PLAYER.bounceCeiling = 4;  // safety ceiling for pumped bounces
// Height reached from launch speed v, and its inverse, for this game's
// frame-by-frame physics (gravity is applied before each move).
export const heightFor = (v) => (v * v) / (2 * PLAYER.gravity) - v / 2;
export const speedFor = (h) => (PLAYER.gravity + Math.sqrt(PLAYER.gravity ** 2 + 8 * PLAYER.gravity * Math.max(0, h))) / 2;
PLAYER.jumpHeight = heightFor(PLAYER.jumpV);
PLAYER.bounceV = speedFor(PLAYER.bounceAuto * PLAYER.jumpHeight);
PLAYER.bounceMaxV = speedFor(PLAYER.bounceMax * PLAYER.jumpHeight);

export class Level {
  constructor(det, W, H) {
    this.W = W;
    this.H = H;
    this.w = det.w;
    this.h = det.h;
    this.s = det.scale;
    const { solid, bouncy, hazard, goal } = det.masks;
    // Only black ink is solid from every side. Trampolines are one-way: you can
    // pass up (or sideways) through them, and only land on them from above.
    this.block = solid;
    this.bouncy = bouncy;
    this.hazard = hazard.slice();
    this.goal = goal;
    this.coins = det.coins.map((c) => ({ ...c, taken: false, spin: Math.random() * 6 }));
    // Coins are never dangerous, even if their edges looked red to the camera.
    for (const c of this.coins) {
      const r = (c.r + 8) / this.s;
      const cx = c.x / this.s, cy = c.y / this.s;
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.h - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(this.w - 1, Math.ceil(cx + r)); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.hazard[y * this.w + x] = 0;
        }
      }
    }
  }

  // Does `mask` have ink anywhere inside this world-space rectangle?
  // Paper sides count as walls for the block mask; above and below are open.
  hits(mask, left, top, right, bottom, edgesSolid = false) {
    if (edgesSolid && (left < 0 || right > this.W)) return true;
    const s = this.s;
    const x0 = Math.max(0, Math.floor(left / s)), x1 = Math.min(this.w - 1, Math.floor((right - 0.01) / s));
    const y0 = Math.max(0, Math.floor(top / s)), y1 = Math.min(this.h - 1, Math.floor((bottom - 0.01) / s));
    for (let y = y0; y <= y1; y++) {
      const row = y * this.w;
      for (let x = x0; x <= x1; x++) if (mask[row + x]) return true;
    }
    return false;
  }

  // Is there trampoline ink in the thin band from y0 down to y1 under the feet?
  bouncyBand(x, y0, y1) {
    const hw = PLAYER.w / 2;
    return this.hits(this.bouncy, x - hw, y0, x + hw, y1);
  }

  blocked(x, y) {
    const hw = PLAYER.w / 2;
    return this.hits(this.block, x - hw, y - PLAYER.h, x + hw, y, true);
  }
}

export class Player {
  constructor(x, y) {
    this.spawn(x, y);
  }

  spawn(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.jumping = false;
    this.bouncing = false;   // rising from a trampoline, boost not used yet
    this.airborneFromBounce = false;  // in the air after a bounce (until landing)
    this.bounceFromY = 0;
    this.bounceCap = PLAYER.bounceMax; // highest this bounce may rise (fraction of a jump)
    this.chainRatio = 0;      // height of the previous bounce in a row (fraction of a jump)
    this.heldAirborne = false; // jump held continuously since leaving the ground
    this.inputHeld = false;
    this.coyote = 0;
    this.buffer = 0;
    this.phase = 0;        // run cycle
    this.squash = 0;       // landing squash / jump stretch (-ve)
    this.airTime = 0;
  }

  update(input, level, events) {
    const P = PLAYER;

    // --- horizontal intent
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir) {
      this.vx += dir * (this.onGround ? P.accel : P.airAccel);
      this.vx = Math.max(-P.runMax, Math.min(P.runMax, this.vx));
      this.facing = dir;
    } else {
      this.vx *= this.onGround ? P.friction : 0.96;
      if (Math.abs(this.vx) < 0.05) this.vx = 0;
    }

    // --- jumping (with coyote time and input buffering so it feels fair)
    this.inputHeld = !!input.jumpHeld;
    if (!this.onGround && !input.jumpHeld) this.heldAirborne = false;
    if (input.jumpPressed) this.buffer = P.buffer;
    this.coyote = this.onGround ? P.coyote : this.coyote - 1;
    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = -P.jumpV;
      this.onGround = false;
      this.jumping = true;
      this.heldAirborne = true;
      this.chainRatio = 0;
      this.coyote = 0;
      this.buffer = 0;
      this.squash = -0.25;
      events.push({ type: 'jump', x: this.x, y: this.y });
    }
    // Trampoline boost: press jump on the way up. Earlier = higher.
    if (this.bouncing && this.vy < 0 && input.jumpPressed) this.boost(events);
    if (this.vy >= 0) this.bouncing = false;
    // Hard limit: nothing can carry a bounce above the trampoline's maximum height.
    if (this.airborneFromBounce && this.vy < 0) {
      const allowed = this.bounceCap * P.jumpHeight - (this.bounceFromY - this.y);
      if (allowed <= 0) this.vy = 0;
      else if (heightFor(-this.vy) > allowed) this.vy = -speedFor(allowed);
    }
    this.buffer--;
    // Let go early for a small hop.
    if (this.jumping && !input.jumpHeld && this.vy < -3.5) this.vy = -3.5;

    this.vy = Math.min(this.vy + P.gravity, P.maxFall);

    // --- move, one pixel at a time
    this.moveX(level);
    this.moveY(level, events);

    // Stick to the ground when walking down slopes.
    if (!this.onGround && !this.jumping && this.vy >= 0 && this.airTime < 2) {
      for (let k = 1; k <= P.stepUp; k++) {
        if (level.blocked(this.x, this.y + k)) { this.y += k - 1; this.onGround = true; this.vy = 0; break; }
      }
    }
    this.airTime = this.onGround ? 0 : this.airTime + 1;

    // --- animation state
    if (this.onGround) this.phase += Math.abs(this.vx) * 0.17;
    this.squash *= 0.82;
    if (this.onGround && Math.abs(this.vx) > 2.2 && Math.random() < 0.25) {
      events.push({ type: 'dust', x: this.x - this.facing * 6, y: this.y });
    }
  }

  // Raise a trampoline bounce. `progress` is how far through the automatic
  // bounce's rise we are (0 = just launched, 1 = at its top).
  boost(events) {
    const P = PLAYER;
    const autoRise = P.bounceAuto * P.jumpHeight;
    const progress = Math.max(0, Math.min(1, (this.bounceFromY - this.y) / autoRise));
    // Remaining rise needed so the total height is auto + (max - auto) * (1 - progress).
    const remaining = P.bounceMax * P.jumpHeight * (1 - progress);
    const v = speedFor(remaining);
    if (v > -this.vy) this.vy = -v;
    // Remember how high this bounce goes, so a held chain can grow from it.
    this.chainRatio = Math.max(this.chainRatio, P.bounceAuto + (P.bounceMax - P.bounceAuto) * (1 - progress));
    this.bouncing = false;
    this.buffer = 0;
    this.heldAirborne = true;
    this.squash = -0.3;
    events.push({ type: 'boost', x: this.x, y: this.y, power: 1 - progress });
  }

  moveX(level) {
    const steps = Math.ceil(Math.abs(this.vx));
    if (!steps) return;
    const step = this.vx / steps;
    for (let i = 0; i < steps; i++) {
      const nx = this.x + step;
      if (!level.blocked(nx, this.y)) { this.x = nx; continue; }
      // Try to step up a slope or small bump.
      let up = 0;
      if (this.onGround || this.airTime < 3) {
        for (let k = 1; k <= PLAYER.stepUp; k++) if (!level.blocked(nx, this.y - k)) { up = k; break; }
      }
      if (up) { this.x = nx; this.y -= up; }
      else { this.vx = 0; break; }
    }
  }

  moveY(level, events) {
    const wasOnGround = this.onGround;
    const steps = Math.ceil(Math.abs(this.vy));
    const step = steps ? this.vy / steps : 0;
    let hitFloor = false, hitTrampoline = false;
    for (let i = 0; i < steps; i++) {
      const ny = this.y + step;
      // Falling onto a trampoline: only if the feet are above it, not already inside it.
      if (step > 0 && !level.bouncyBand(this.x, this.y - 2, this.y) && level.bouncyBand(this.x, ny - 1, ny)) {
        hitTrampoline = true;
        break;
      }
      if (!level.blocked(this.x, ny)) { this.y = ny; continue; }
      if (step > 0) hitFloor = true;
      else { this.vy = 0; events.push({ type: 'bonk', x: this.x, y: this.y - PLAYER.h }); }
      break;
    }
    // Touching the floor counts as landing even if the fall ended exactly on it.
    const onTrampoline = hitTrampoline ||
      (this.vy >= 0 && !level.bouncyBand(this.x, this.y - 2, this.y) && level.bouncyBand(this.x, this.y, this.y + 1));
    const onFloor = onTrampoline || hitFloor || (this.vy >= 0 && level.blocked(this.x, this.y + 1));
    if (!onFloor) { this.onGround = false; return; }

    if (onTrampoline) {
      const P = PLAYER;
      const heldThrough = this.heldAirborne && this.inputHeld;
      this.onGround = false;
      this.jumping = false;
      this.coyote = 0;           // no normal jump in mid-air after a bounce
      this.airborneFromBounce = true;
      this.bounceFromY = this.y;
      this.squash = -0.35;
      events.push({ type: 'bounce', x: this.x, y: this.y });
      if (heldThrough) {
        // Held jump the whole way down: pump. First bounce is a full jump+bounce,
        // then each bounce in a row adds a little more.
        const ratio = this.chainRatio > 0
          ? Math.min(P.bounceCeiling, this.chainRatio + P.bounceGrow)
          : P.bounceMax;
        this.vy = -speedFor(ratio * P.jumpHeight);
        this.bounceCap = ratio;
        this.chainRatio = ratio;
        this.bouncing = false;
        this.buffer = 0;
        events.push({ type: 'boost', x: this.x, y: this.y, power: 1, ratio });
      } else {
        this.vy = -P.bounceV;
        this.bounceCap = P.bounceMax;
        this.chainRatio = P.bounceAuto;
        this.bouncing = true;
        // Pressed jump just before landing on it? That's the earliest press: full boost.
        if (this.buffer > 0) this.boost(events);
      }
      this.heldAirborne = this.inputHeld;
      return;
    }
    if (!wasOnGround) {
      this.squash = Math.min(0.4, this.vy / 30);
      events.push({ type: 'land', x: this.x, y: this.y, impact: this.vy });
    }
    this.vy = 0;
    this.onGround = true;
    this.jumping = false;
    this.airborneFromBounce = false;
    this.chainRatio = 0;
    this.heldAirborne = false;
  }
}

// One attempt at a level: player, coins, timer, win/lose.
export class Game {
  constructor(level, start, maxLives = 3) {
    this.level = level;
    this.start = { ...start };
    this.maxLives = maxLives;   // Infinity for unlimited
    this.lives = maxLives;
    this.player = new Player(start.x, start.y);
    this.state = 'playing';  // playing | dead | won | over
    this.frames = 0;
    this.deaths = 0;
    this.deadTimer = 0;
    this.events = [];
    this.placeAtStart();
  }

  get coinsTaken() { return this.level.coins.filter((c) => c.taken).length; }
  get coinsTotal() { return this.level.coins.length; }
  get seconds() { return this.frames / 60; }

  placeAtStart() {
    const p = this.player;
    p.spawn(this.start.x, this.start.y);
    // If the start point is inside a drawing, pop up above it.
    while (this.level.blocked(p.x, p.y) && p.y > PLAYER.h) p.y -= 2;
  }

  restart() {
    this.level.coins.forEach((c) => (c.taken = false));
    this.frames = 0;
    this.deaths = 0;
    this.lives = this.maxLives;
    this.state = 'playing';
    this.placeAtStart();
    this.events.push({ type: 'spawn', x: this.player.x, y: this.player.y });
  }

  update(input) {
    const ev = this.events;
    const p = this.player;
    const L = this.level;

    if (this.state === 'dead') {
      if (--this.deadTimer <= 0) {
        this.state = 'playing';
        this.placeAtStart();
        ev.push({ type: 'spawn', x: p.x, y: p.y });
      }
      return;
    }
    if (this.state === 'over') return;
    if (this.state === 'won') {
      p.phase += 0.15;
      return;
    }

    this.frames++;
    p.update(input, L, ev);

    // Coins
    const cy = p.y - PLAYER.h / 2;
    for (const c of L.coins) {
      if (!c.taken && Math.abs(c.x - p.x) < c.r + 10 && Math.abs(c.y - cy) < c.r + PLAYER.h / 2) {
        c.taken = true;
        ev.push({ type: 'coin', x: c.x, y: c.y });
      }
    }

    // Danger and falling off the paper
    const hw = PLAYER.w / 2 - 2;
    const touchedDanger = L.hits(L.hazard, p.x - hw, p.y - PLAYER.h + 6, p.x + hw, p.y + 1);
    if (touchedDanger || p.y > L.H + 80) {
      this.state = 'dead';
      this.deaths++;
      this.lives--;
      this.deadTimer = 50;
      ev.push({ type: 'die', x: p.x, y: Math.min(p.y, L.H) - PLAYER.h / 2, fell: !touchedDanger });
      if (this.lives <= 0) {
        this.state = 'over';
        ev.push({ type: 'gameover' });
      }
      return;
    }

    // Goal
    if (L.hits(L.goal, p.x - hw - 3, p.y - PLAYER.h - 3, p.x + hw + 3, p.y + 3)) {
      this.state = 'won';
      ev.push({ type: 'win', x: p.x, y: p.y - PLAYER.h });
    }
  }
}
