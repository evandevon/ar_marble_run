// Draws the paper, what the camera detected, the start flag, coins, effects
// and the stick figure. Everything is in world (paper) coordinates.

import { drawStickman } from './stickman.js';
import { PLAYER } from './platformer.js';

export const TYPE_STYLE = {
  solid: { label: 'Ground', colour: '#19c3ff', fill: '#23262e' },
  bouncy: { label: 'Bouncy', colour: '#3a7bff', fill: '#2a64e0' },
  hazard: { label: 'Danger', colour: '#ff3b30', fill: '#d8322a' },
  goal: { label: 'Goal', colour: '#2ecc71', fill: '#22a85a' },
  coin: { label: 'Coin', colour: '#ffb703', fill: '#f39c12' },
};

const RGB = {
  solid: [35, 38, 46], bouncy: [42, 100, 224], hazard: [216, 50, 42], goal: [34, 168, 90], coin: [243, 156, 18],
};

// Render the detection masks into a small image used for the clean view.
export function buildCleanImage(det, canvas) {
  canvas.width = det.w;
  canvas.height = det.h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(det.w, det.h);
  const d = img.data;
  for (const t of ['solid', 'bouncy', 'hazard', 'goal', 'coin']) {
    const m = det.masks[t];
    const [r, g, b] = RGB[t];
    for (let i = 0; i < m.length; i++) if (m[i]) { d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
}

function tracePath(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

function drawCoin(ctx, x, y, r, spin) {
  const w = Math.abs(Math.cos(spin)) * r + 1.5;
  ctx.save();
  ctx.shadowColor = 'rgba(255,183,3,0.9)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.ellipse(x, y, w, r, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffc93c';
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#b8740a';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, w * 0.55, r * 0.6, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#e09a12';
  ctx.stroke();
}

function drawStartFlag(ctx, x, y, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#e0157f';
  ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-14, -48); ctx.stroke();
  ctx.fillStyle = '#e0157f';
  ctx.beginPath(); ctx.moveTo(-14, -48); ctx.lineTo(8, -41); ctx.lineTo(-14, -34); ctx.closePath(); ctx.fill();
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.strokeText('START', -2, 14);
  ctx.fillText('START', -2, 14);
  ctx.restore();
}

// Dotted arcs showing how far and high a jump reaches, so kids draw fair levels.
function drawJumpGuide(ctx, x, y) {
  const g = PLAYER.gravity, v0 = PLAYER.jumpV, vx = PLAYER.runMax;
  ctx.save();
  ctx.setLineDash([3, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(224,21,127,0.55)';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    for (let f = 0; f <= (2 * v0) / g; f++) {
      const px = x + dir * vx * f;
      const py = y - (v0 * f - 0.5 * g * f * f);
      f ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const top = y - (v0 * v0) / (2 * g);
  ctx.fillStyle = 'rgba(224,21,127,0.8)';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('jump reach', x, top - 6);
  ctx.restore();
}

export function drawScene(ctx, scale, s) {
  const { W, H, paper, clean, view, mode, det, game, start, effects, now, fixing } = s;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;

  // 1. Background
  if (view === 'camera') {
    ctx.drawImage(paper, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(clean, 0, 0, W, H);
  }

  // Fix colours: tint everything the camera recognised, so mistakes stand out.
  if (fixing && view === 'camera') {
    ctx.globalAlpha = 0.6;
    ctx.drawImage(clean, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // 2. Build mode: outline what the camera sees, coloured by meaning
  if (mode === 'build' && det) {
    ctx.lineJoin = 'round';
    for (const o of det.outlines) {
      const st = TYPE_STYLE[o.type];
      tracePath(ctx, o.points);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = st.colour;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = st.colour;
      ctx.stroke();
    }
    drawJumpGuide(ctx, start.x, start.y);
    drawStartFlag(ctx, start.x, start.y, 1);
    // Ghost figure for scale
    ctx.globalAlpha = 0.45;
    drawStickman(ctx, { x: start.x, y: start.y, vx: 0, vy: 0, facing: 1, onGround: true, phase: 0, squash: 0 }, 'idle', now);
    ctx.globalAlpha = 1;
  }

  // 3. Play mode
  if (mode === 'play' && game) {
    const L = game.level;
    // Goal glow
    const pulse = 0.5 + 0.5 * Math.sin(now / 250);
    if (det) {
      ctx.save();
      ctx.shadowColor = '#2ecc71';
      ctx.shadowBlur = 10 + pulse * 14;
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(46,204,113,${0.5 + pulse * 0.5})`;
      for (const o of det.outlines) if (o.type === 'goal') { tracePath(ctx, o.points); ctx.stroke(); }
      ctx.restore();
    }
    drawStartFlag(ctx, game.start.x, game.start.y, 0.5);
    for (const c of L.coins) {
      if (c.taken) continue;
      c.spin += 0.06;
      drawCoin(ctx, c.x, c.y + Math.sin(now / 300 + c.spin) * 2, c.r, c.spin);
    }
    if (game.state !== 'dead' && game.state !== 'over') drawStickman(ctx, game.player, game.state, now);
  }

  effects.draw(ctx);

  // 4. HUD
  if (mode === 'play' && game) {
    ctx.save();
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const items = [];
    if (Number.isFinite(game.maxLives)) items.push('❤️'.repeat(Math.max(0, game.lives)) + '🖤'.repeat(game.maxLives - Math.max(0, game.lives)));
    if (game.coinsTotal) items.push(`🪙 ${game.coinsTaken}/${game.coinsTotal}`);
    items.push(`⏱ ${game.seconds.toFixed(1)}s`);
    if (game.deaths && !Number.isFinite(game.maxLives)) items.push(`💥 ${game.deaths}`);
    const text = items.join('    ');
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(20,22,28,0.72)';
    roundRect(ctx, 12, 12, tw + 28, 38, 19);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 26, 20);
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
