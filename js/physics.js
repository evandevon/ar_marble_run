// Turns detected outlines into static physics walls and simulates the marble.
// Uses Matter.js (loaded globally from lib/matter.min.js).

const { Engine, Bodies, Body, Composite } = window.Matter;

export const BALL_RADIUS = 13;
const WALL_THICKNESS = 6;
const MAX_SPEED = 22;       // px per step; keeps the marble from tunnelling through thin lines
const SUBSTEPS = 3;

export class MarbleWorld {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.engine = Engine.create({ positionIterations: 10, velocityIterations: 8 });
    this.engine.gravity.y = 1;
    this.walls = [];
    this.ball = null;
    this.trail = [];
    this.state = 'idle'; // idle | running | lost
    this.lostAt = 0;
  }

  // shapes: [{ points:[{x,y}] }] in world coordinates (closed outlines)
  setWalls(shapes) {
    Composite.remove(this.engine.world, this.walls);
    this.walls = [];
    const opts = { isStatic: true, friction: 0.05, restitution: 0.25, label: 'wall' };
    for (const shape of shapes) {
      const pts = shape.points;
      const n = pts.length;
      if (n === 1) {
        this.walls.push(Bodies.circle(pts[0].x, pts[0].y, WALL_THICKNESS, opts));
        continue;
      }
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if (n === 2 && i === 1) break;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.5) continue;
        const seg = Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len, WALL_THICKNESS, {
          ...opts,
          angle: Math.atan2(b.y - a.y, b.x - a.x),
        });
        this.walls.push(seg);
        // Round joints so the marble doesn't catch on corners between segments.
        this.walls.push(Bodies.circle(a.x, a.y, WALL_THICKNESS / 2, opts));
      }
    }
    Composite.add(this.engine.world, this.walls);
  }

  drop(x, y) {
    if (this.ball) Composite.remove(this.engine.world, this.ball);
    this.ball = Bodies.circle(x, y, BALL_RADIUS, {
      restitution: 0.35,
      friction: 0.02,
      frictionAir: 0.002,
      density: 0.004,
      label: 'ball',
    });
    Composite.add(this.engine.world, this.ball);
    this.trail = [];
    this.state = 'running';
  }

  clearBall() {
    if (this.ball) Composite.remove(this.engine.world, this.ball);
    this.ball = null;
    this.trail = [];
    this.state = 'idle';
  }

  step(dtMs) {
    if (!this.ball || this.state !== 'running') return;
    // Fixed timestep keeps the simulation stable and repeatable.
    const dt = 1000 / 60 / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) {
      Engine.update(this.engine, dt);
      const v = this.ball.velocity;
      const speed = Math.hypot(v.x, v.y);
      if (speed > MAX_SPEED) {
        Body.setVelocity(this.ball, { x: (v.x / speed) * MAX_SPEED, y: (v.y / speed) * MAX_SPEED });
      }
    }
    const p = this.ball.position;
    this.trail.push({ x: p.x, y: p.y });
    if (this.trail.length > 40) this.trail.shift();
    const m = 60;
    if (p.y > this.height + m || p.x < -m || p.x > this.width + m) {
      this.state = 'lost';
      this.lostAt = performance.now();
    }
  }
}
