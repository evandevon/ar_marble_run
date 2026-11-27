// Particles, floating text and little synthesised sound effects, shared by all
// games. Each game decides which effects and sounds its events make.

export class Effects {
  constructor() {
    this.parts = [];
    this.texts = [];
    this.rings = [];
  }

  burst(x, y, { count = 10, speed = 3, colour = '#fff', life = 30, size = 3, gravity = 0.15, angle = -Math.PI / 2, spread = Math.PI * 2, shape = 'dot' } = {}) {
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life, max: life, size: size * (0.6 + Math.random() * 0.8),
        colour: Array.isArray(colour) ? colour[(Math.random() * colour.length) | 0] : colour,
        gravity, shape, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  text(x, y, str, colour = '#ffb703') { this.texts.push({ x, y, str, colour, life: 50, max: 50 }); }
  ring(x, y, colour, maxR = 40) { this.rings.push({ x, y, colour, r: 4, maxR, life: 22, max: 22 }); }

  update() {
    for (const p of this.parts) { p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.97; p.rot += p.vr; p.life--; }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const t of this.texts) { t.y -= 0.8; t.life--; }
    this.texts = this.texts.filter((t) => t.life > 0);
    for (const r of this.rings) { r.r += (r.maxR - r.r) * 0.18; r.life--; }
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  clear() { this.parts = []; this.texts = []; this.rings = []; }

  draw(ctx) {
    for (const r of this.rings) {
      ctx.globalAlpha = r.life / r.max;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = r.colour;
      ctx.stroke();
    }
    for (const p of this.parts) {
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      ctx.fillStyle = p.colour;
      if (p.shape === 'confetti') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else if (p.shape === 'star') {
        star(ctx, p.x, p.y, p.size, p.rot);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * p.life / p.max), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px system-ui, sans-serif';
    for (const t of this.texts) {
      ctx.globalAlpha = t.life / t.max;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.colour;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}

function star(ctx, x, y, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// Tiny synthesiser: no sound files to load.
export class Sfx {
  constructor() { this.ctx = null; this.muted = false; }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, endFreq, dur, type = 'square', vol = 0.12, delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(name, power = 1) {
    if (this.muted || !this.ctx) return;
    switch (name) {
      case 'boost': this.tone(400, Math.min(2600, 900 + power * 900), 0.22, 'square', 0.06); break;
      case 'jump': this.tone(300, 620, 0.12, 'square', 0.06); break;
      case 'land': this.tone(140, 60, 0.08, 'triangle', 0.12); break;
      case 'bounce': this.tone(180, 720, 0.28, 'sine', 0.16); break;
      case 'coin': this.tone(990, 990, 0.07, 'square', 0.06); this.tone(1320, 1320, 0.18, 'square', 0.06, 0.07); break;
      case 'die': this.tone(500, 80, 0.45, 'sawtooth', 0.08); break;
      case 'gameover': [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.97, 0.26, 'triangle', 0.1, 0.35 + i * 0.22)); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.18, 'square', 0.07, i * 0.11)); break;
    }
  }
}
