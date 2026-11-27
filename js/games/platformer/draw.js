// Platformer drawing: start flag, jump-reach arcs, coins, goal glow and the
// stick figure. Everything is in world (paper) coordinates.

import { drawStickman } from './stickman.js';
import { PLAYER } from './physics.js';
import { tracePath } from '../../core/colours.js';

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

// Dotted arcs showing how far and high you can travel from a point, so kids
// draw fair levels. Used for the normal jump and for trampoline bounces.
function drawReach(ctx, x, y, v0, colour, label) {
  const g = PLAYER.gravity, vx = PLAYER.runMax;
  ctx.save();
  ctx.setLineDash([3, 6]);
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = colour;
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
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = colour;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y - (v0 * v0) / (2 * g) - 6);
  ctx.restore();
}

// Where a trampoline launches from: the middle of its top surface.
function trampolineTop(points) {
  let minX = Infinity, maxX = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
  const cx = (minX + maxX) / 2, band = Math.max(6, (maxX - minX) * 0.2);
  let top = Infinity;
  for (const p of points) if (Math.abs(p.x - cx) <= band) top = Math.min(top, p.y);
  if (!Number.isFinite(top)) top = Math.min(...points.map((p) => p.y));
  return { x: cx, y: top };
}

// Build mode: jump guides from the start flag and above each trampoline.
export function drawBuild(ctx, { det, start, now }) {
  for (const o of det.outlines) {
    if (o.type !== 'blue') continue;
    const t = trampolineTop(o.points);
    drawReach(ctx, t.x, t.y, PLAYER.bounceMaxV, '#3a7bff', 'bounce + jump');
    drawReach(ctx, t.x, t.y, PLAYER.bounceV, '#7fa6ff', 'bounce');
  }
  drawReach(ctx, start.x, start.y, PLAYER.jumpV, '#e0157f', 'jump reach');
  drawStartFlag(ctx, start.x, start.y, 1);
  // Ghost figure for scale
  ctx.globalAlpha = 0.45;
  drawStickman(ctx, { x: start.x, y: start.y, vx: 0, vy: 0, facing: 1, onGround: true, phase: 0, squash: 0 }, 'idle', now);
  ctx.globalAlpha = 1;
}

// Play mode.
export function drawPlay(ctx, game, { det, now }) {
  const pulse = 0.5 + 0.5 * Math.sin(now / 250);
  ctx.save();
  ctx.shadowColor = '#2ecc71';
  ctx.shadowBlur = 10 + pulse * 14;
  ctx.lineWidth = 3;
  ctx.strokeStyle = `rgba(46,204,113,${0.5 + pulse * 0.5})`;
  for (const o of det.outlines) if (o.type === 'green') { tracePath(ctx, o.points); ctx.stroke(); }
  ctx.restore();
  drawStartFlag(ctx, game.start.x, game.start.y, 0.5);
  for (const c of game.level.coins) {
    if (c.taken) continue;
    c.spin += 0.06;
    drawCoin(ctx, c.x, c.y + Math.sin(now / 300 + c.spin) * 2, c.r, c.spin);
  }
  if (game.state !== 'dead' && game.state !== 'over') drawStickman(ctx, game.player, game.state, now);
}

export function hudItems(game) {
  const items = [];
  if (Number.isFinite(game.maxLives)) {
    const left = Math.max(0, Math.min(game.maxLives, game.lives));
    items.push('❤️'.repeat(left) + '🖤'.repeat(game.maxLives - left));
  }
  if (game.coinsTotal) items.push(`🪙 ${game.coinsTaken}/${game.coinsTotal}`);
  items.push(`⏱ ${game.seconds.toFixed(1)}s`);
  if (game.deaths && !Number.isFinite(game.maxLives)) items.push(`💥 ${game.deaths}`);
  return items;
}
