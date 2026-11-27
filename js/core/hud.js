// A rounded panel of status items (lives, coins, time…) in the top-left corner.

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawHud(ctx, items) {
  if (!items || !items.length) return;
  ctx.save();
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const text = items.join('    ');
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(20,22,28,0.72)';
  roundRect(ctx, 12, 12, tw + 28, 38, 19);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 26, 20);
  ctx.restore();
}
