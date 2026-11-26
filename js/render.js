// Draws the paper, detected shapes, drop point and marble.
// All drawing is in world (paper) coordinates; `scale` maps world -> canvas pixels.

import { BALL_RADIUS } from './physics.js';

function tracePath(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

export function drawScene(ctx, scale, s) {
  const { world, shapes, paper, view, mode, drop, now, W, H } = s;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // 1. Background
  if (view === 'camera') {
    ctx.drawImage(paper, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#20232b';
    for (const sh of shapes) {
      tracePath(ctx, sh.points);
      ctx.fill('evenodd');
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#20232b';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  // 2. "What the camera sees" overlay while building
  if (mode === 'build') {
    ctx.lineJoin = 'round';
    for (const sh of shapes) {
      tracePath(ctx, sh.points);
      ctx.fillStyle = 'rgba(25,195,255,0.18)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#19c3ff';
      ctx.stroke();
    }
  }

  // 3. Drop point
  const pulse = (Math.sin(now / 300) + 1) / 2;
  ctx.save();
  ctx.translate(drop.x, drop.y);
  ctx.globalAlpha = mode === 'build' ? 1 : 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_RADIUS + 6 + pulse * 6, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = '#ff3fa4';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(-7, -BALL_RADIUS - 26);
  ctx.lineTo(7, -BALL_RADIUS - 26);
  ctx.lineTo(0, -BALL_RADIUS - 14);
  ctx.closePath();
  ctx.fillStyle = '#ff3fa4';
  ctx.fill();
  ctx.restore();

  // 4. Trail and marble
  const t = world.trail;
  for (let i = 1; i < t.length; i++) {
    const a = i / t.length;
    ctx.beginPath();
    ctx.moveTo(t[i - 1].x, t[i - 1].y);
    ctx.lineTo(t[i].x, t[i].y);
    ctx.lineWidth = BALL_RADIUS * 1.4 * a;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,63,164,${0.45 * a})`;
    ctx.stroke();
  }
  const b = world.ball;
  if (b) {
    const { x, y } = b.position;
    ctx.save();
    ctx.shadowColor = 'rgba(255,63,164,0.9)';
    ctx.shadowBlur = 22;
    const g = ctx.createRadialGradient(x - 4, y - 5, 1, x, y, BALL_RADIUS);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, '#ff9ad2');
    g.addColorStop(0.75, '#e01f84');
    g.addColorStop(1, '#6d0a3e');
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }
}
