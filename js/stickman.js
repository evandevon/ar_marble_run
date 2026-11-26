// Procedurally animated stick figure. Feet are at (0, 0); figure is ~42 px tall.

const COLOUR = '#e0157f';
const HALO = '#ffffff';

// Two-bone limb from (x, y): angles measured from straight down, +ve = forward.
function limb(x, y, a1, l1, a2, l2) {
  const kx = x + Math.sin(a1) * l1, ky = y + Math.cos(a1) * l1;
  const ex = kx + Math.sin(a2) * l2, ey = ky + Math.cos(a2) * l2;
  return [x, y, kx, ky, ex, ey];
}

function pose(p, state, t) {
  const run = Math.min(1, Math.abs(p.vx) / 4.2);
  const ph = p.phase;
  if (state === 'won') {
    const wave = Math.sin(t / 120);
    return {
      bob: -Math.abs(Math.sin(t / 160)) * 6,
      lean: 0,
      legs: [[0.15, 0], [-0.15, 0]],
      arms: [[Math.PI - 0.5 + wave * 0.3, Math.PI - 0.3 + wave * 0.4], [Math.PI + 0.5 - wave * 0.3, Math.PI + 0.3 - wave * 0.4]],
    };
  }
  if (!p.onGround) {
    if (p.vy < 0) {
      // Rising: one knee up, arms reaching
      return { bob: 0, lean: p.vx * p.facing * 0.03, legs: [[0.9, -0.2], [-0.25, -0.9]], arms: [[2.6, 2.9], [-0.6, -0.2]] };
    }
    // Falling: legs dangle, arms flail
    const f = Math.sin(t / 60) * 0.3;
    return { bob: 0, lean: p.vx * p.facing * 0.03, legs: [[0.35, 0.1], [-0.2, -0.4]], arms: [[1.9 + f, 2.4 + f], [-1.9 - f, -2.4 - f]] };
  }
  if (run < 0.08) {
    // Idle: gentle breathing
    const br = Math.sin(t / 400);
    return { bob: br * 0.6, lean: 0, legs: [[0.12, 0.12], [-0.12, -0.12]], arms: [[0.18 + br * 0.04, 0.1], [-0.18 - br * 0.04, -0.1]] };
  }
  // Running cycle
  const s = Math.sin(ph), c = Math.cos(ph);
  const legA = s * 0.85 * run, legB = -s * 0.85 * run;
  return {
    bob: -Math.abs(c) * 2.5 * run,
    lean: 0.18 * run * Math.sign(p.vx) * p.facing,
    legs: [
      [legA, legA - Math.max(0, -c) * 1.4 * run],
      [legB, legB - Math.max(0, c) * 1.4 * run],
    ],
    arms: [[-s * 0.9 * run, -s * 0.9 * run + 1.2 * run], [s * 0.9 * run, s * 0.9 * run + 1.2 * run]],
  };
}

export function drawStickman(ctx, p, state, t) {
  const po = pose(p, state, t);
  ctx.save();
  ctx.translate(p.x, p.y);
  // Squash on landing (+ve), stretch on jumping (-ve)
  const sq = p.squash;
  ctx.scale((1 + sq * 0.6) * p.facing, 1 - sq);
  ctx.rotate(po.lean);
  ctx.translate(0, po.bob);

  const hip = { x: 0, y: -18 };
  const shoulder = { x: 0, y: -31 };
  const head = { x: 1.5, y: -37 };
  const segs = [
    [hip.x, hip.y, shoulder.x, shoulder.y],
    limb(hip.x, hip.y, po.legs[0][0], 9.5, po.legs[0][1], 9),
    limb(hip.x, hip.y, po.legs[1][0], 9.5, po.legs[1][1], 9),
    limb(shoulder.x, shoulder.y, po.arms[0][0], 7.5, po.arms[0][1], 7.5),
    limb(shoulder.x, shoulder.y, po.arms[1][0], 7.5, po.arms[1][1], 7.5),
  ];
  const stroke = (width, colour) => {
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    for (const s of segs) {
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      for (let i = 2; i < s.length; i += 2) ctx.lineTo(s[i], s[i + 1]);
      ctx.stroke();
    }
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  stroke(8, HALO);      // white halo keeps the figure readable over black ink
  stroke(3.6, COLOUR);

  // Head
  ctx.beginPath();
  ctx.arc(head.x, head.y, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = HALO;
  ctx.fill();
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = COLOUR;
  ctx.stroke();
  // Eye (looks the way he's facing)
  ctx.beginPath();
  ctx.arc(head.x + 2.6, head.y - 0.8, 1.4, 0, Math.PI * 2);
  ctx.fillStyle = '#2a0a1a';
  ctx.fill();
  ctx.restore();
}
