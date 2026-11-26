// Particles, floating text and little synthesised sound effects.

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

  // Turn game events into effects.
  handle(e, sfx) {
    switch (e.type) {
      case 'jump':
        this.burst(e.x, e.y, { count: 8, speed: 2, colour: '#c9c2b4', angle: 0, spread: Math.PI, gravity: -0.02, life: 22, size: 4 });
        sfx.play('jump');
        break;
      case 'land':
        if (e.impact > 5) {
          const n = Math.min(16, Math.round(e.impact * 1.2));
          this.burst(e.x - 4, e.y, { count: n / 2, speed: e.impact / 4, colour: '#c9c2b4', angle: Math.PI, spread: 0.7, gravity: -0.01, life: 24, size: 4 });
          this.burst(e.x + 4, e.y, { count: n / 2, speed: e.impact / 4, colour: '#c9c2b4', angle: 0, spread: 0.7, gravity: -0.01, life: 24, size: 4 });
          sfx.play('land');
        }
        break;
      case 'dust':
        this.burst(e.x, e.y - 2, { count: 1, speed: 0.8, colour: '#d6d0c4', angle: -Math.PI / 2, spread: 1.5, gravity: -0.02, life: 18, size: 3.5 });
        break;
      case 'bounce':
        this.ring(e.x, e.y, '#3a7bff', 46);
        this.burst(e.x, e.y, { count: 14, speed: 4, colour: ['#3a7bff', '#9cc0ff', '#fff'], angle: -Math.PI / 2, spread: 2.2, life: 28 });
        sfx.play('bounce');
        break;
      case 'boost': {
        const n = Math.round(6 + e.power * 18);
        this.ring(e.x, e.y, '#9cc0ff', 20 + e.power * 30);
        this.burst(e.x, e.y, { count: n, speed: 2 + e.power * 4, colour: ['#3a7bff', '#9cc0ff', '#ffffff'], angle: Math.PI / 2, spread: 1.6, life: 26, shape: 'star', size: 3.5 });
        if (e.power > 0.8) this.text(e.x, e.y - 50, 'SUPER!', '#3a7bff');
        sfx.play('boost', e.power);
        break;
      }
      case 'bonk':
        this.burst(e.x, e.y, { count: 5, speed: 2, colour: '#fff', angle: Math.PI / 2, spread: 2, life: 15 });
        break;
      case 'coin':
        this.ring(e.x, e.y, '#ffb703', 34);
        this.burst(e.x, e.y, { count: 14, speed: 3.5, colour: ['#ffb703', '#ffe08a', '#fff'], gravity: 0.05, life: 30, shape: 'star', size: 4 });
        this.text(e.x, e.y - 18, '+1');
        sfx.play('coin');
        break;
      case 'die':
        this.burst(e.x, e.y, { count: 26, speed: 5, colour: e.fell ? ['#e0157f', '#fff'] : ['#ff3b30', '#ff9f0a', '#e0157f'], life: 40, size: 4 });
        this.ring(e.x, e.y, '#ff3b30', 60);
        sfx.play('die');
        break;
      case 'spawn':
        this.ring(e.x, e.y - 20, '#e0157f', 40);
        this.burst(e.x, e.y - 20, { count: 12, speed: 2.5, colour: ['#e0157f', '#fff'], gravity: 0, life: 24 });
        break;
      case 'gameover':
        sfx.play('gameover');
        break;
      case 'win':
        for (let i = 0; i < 4; i++) {
          this.burst(e.x, e.y, { count: 30, speed: 7 + i, colour: ['#2ecc71', '#ffb703', '#3a7bff', '#e0157f', '#fff'], gravity: 0.12, life: 90, shape: 'confetti', size: 5, spread: 1.6 });
        }
        this.ring(e.x, e.y, '#2ecc71', 90);
        sfx.play('win');
        break;
    }
  }

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
      case 'boost': this.tone(400, 900 + power * 900, 0.22, 'square', 0.06); break;
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
