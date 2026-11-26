import { computeHomography, warpImage } from './homography.js';
import { detectShapes, DEFAULT_VISION } from './vision.js';
import { MarbleWorld, BALL_RADIUS } from './physics.js';
import { WebcamSource, ImageSource, listCameras, loadImageFile, makeDemoDrawing } from './camera.js';
import { drawScene } from './render.js';

// The game world is the flattened paper, in "paper pixels" (A-series ratio).
const WORLD_W = 1000;
const WORLD_H = 707;
const SCAN_INTERVAL_MS = 120;
const STORE_KEY = 'ar-marble-run.calibration.v1';

const $ = (id) => document.getElementById(id);

const app = {
  source: null,
  corners: [],            // paper corners in source (camera) pixels, ordered TL, TR, BR, BL
  H: null,                // paper -> camera homography
  mode: 'build',          // build | run
  view: 'camera',         // camera | clean
  vision: { ...DEFAULT_VISION },
  shapes: [],
  drop: { x: 90, y: 60 },
  world: new MarbleWorld(WORLD_W, WORLD_H),
  paperImg: new ImageData(WORLD_W, WORLD_H),
  paperCanvas: Object.assign(document.createElement('canvas'), { width: WORLD_W, height: WORLD_H }),
  lastScan: 0,
  stillSince: 0,
  loopRunning: false,
};
app.paperCtx = app.paperCanvas.getContext('2d');

// ---------------------------------------------------------------- screens
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id === 'play') resizeGame();
  if (id === 'setup') resizeSetup();
}
document.querySelectorAll('[data-goto]').forEach((b) =>
  b.addEventListener('click', () => { stopSource(); show(b.dataset.goto); }));

function stopSource() {
  if (app.source) app.source.stop();
  app.source = null;
}

// ---------------------------------------------------------------- start screen
$('btn-screen').addEventListener('click', async () => {
  show('setup');
  $('step-camera').hidden = false;
  await startWebcam();
});

$('btn-demo').addEventListener('click', () => {
  const demo = makeDemoDrawing();
  app.source = new ImageSource(demo.canvas);
  $('step-camera').hidden = true;
  setCorners(demo.corners);
  show('setup');
});

$('photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = await loadImageFile(file);
  app.source = new ImageSource(img);
  $('step-camera').hidden = true;
  setCorners([]);
  show('setup');
  e.target.value = '';
});

// ---------------------------------------------------------------- camera
async function startWebcam(deviceId) {
  const status = $('lock-status');
  status.className = 'status';
  status.textContent = 'Starting camera…';
  try {
    if (!app.source || app.source.kind !== 'webcam') {
      stopSource();
      app.source = new WebcamSource($('video'));
    }
    await app.source.start(deviceId);
    status.textContent = '';
    await fillCameraList(deviceId);
    loadSavedCorners();
    resizeSetup();
  } catch (err) {
    status.className = 'status warn';
    status.textContent = err.name === 'NotAllowedError'
      ? 'Camera permission was blocked. Allow the camera in the address bar, then reload.'
      : 'Could not start the camera: ' + err.message;
  }
}

async function fillCameraList(selectedId) {
  const sel = $('camera-select');
  const cams = await listCameras();
  const current = selectedId || app.source.stream?.getVideoTracks()[0]?.getSettings().deviceId;
  sel.innerHTML = '';
  cams.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = c.deviceId;
    o.textContent = c.label || `Camera ${i + 1}`;
    if (c.deviceId === current) o.selected = true;
    sel.appendChild(o);
  });
}
$('camera-select').addEventListener('change', (e) => startWebcam(e.target.value));

$('btn-lock').addEventListener('click', async () => {
  const status = $('lock-status');
  const res = await app.source.lockColours();
  status.className = 'status ' + (res.ok ? 'ok' : 'warn');
  status.textContent = res.msg;
});

// ---------------------------------------------------------------- corners
function orderCorners(pts) {
  // Sort around the centre, then start from the top-left-most point.
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let tl = 0;
  sorted.forEach((p, i) => { if (p.x + p.y < sorted[tl].x + sorted[tl].y) tl = i; });
  return [...sorted.slice(tl), ...sorted.slice(0, tl)];
}

function setCorners(pts) {
  app.corners = pts.length === 4 ? orderCorners(pts) : pts;
  $('corner-count').textContent = `${app.corners.length} of 4 corners`;
  $('btn-play').disabled = app.corners.length !== 4;
}

function loadSavedCorners() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    const ok = saved && saved.w === app.source.width && saved.h === app.source.height && saved.corners?.length === 4;
    $('btn-saved-corners').hidden = !ok;
    if (ok && app.corners.length === 0) setCorners(saved.corners);
  } catch { /* storage unavailable */ }
}
function saveCorners() {
  if (app.source.kind !== 'webcam') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ w: app.source.width, h: app.source.height, corners: app.corners }));
  } catch { /* storage unavailable */ }
}

$('btn-reset-corners').addEventListener('click', () => setCorners([]));
$('btn-saved-corners').addEventListener('click', () => {
  try { setCorners(JSON.parse(localStorage.getItem(STORE_KEY)).corners); } catch { /* ignore */ }
});

// Setup canvas: click to add a corner, drag to move one.
const setupCanvas = $('setup-canvas');
const setupCtx = setupCanvas.getContext('2d');
let dragging = -1;

function resizeSetup() {
  if (!app.source) return;
  setupCanvas.width = app.source.width;
  setupCanvas.height = app.source.height;
}
function setupPoint(e) {
  const r = setupCanvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * setupCanvas.width,
    y: ((e.clientY - r.top) / r.height) * setupCanvas.height,
    scale: setupCanvas.width / r.width,
  };
}
setupCanvas.addEventListener('pointerdown', (e) => {
  if (!app.source) return;
  const p = setupPoint(e);
  const hit = app.corners.findIndex((c) => Math.hypot(c.x - p.x, c.y - p.y) < 22 * p.scale);
  if (hit >= 0) {
    dragging = hit;
    setupCanvas.setPointerCapture(e.pointerId);
  } else if (app.corners.length < 4) {
    setCorners([...app.corners, { x: p.x, y: p.y }]);
  }
});
setupCanvas.addEventListener('pointermove', (e) => {
  if (dragging < 0) return;
  const p = setupPoint(e);
  app.corners[dragging] = { x: p.x, y: p.y };
});
setupCanvas.addEventListener('pointerup', () => {
  if (dragging >= 0 && app.corners.length === 4) setCorners(app.corners);
  dragging = -1;
});

function drawSetup() {
  if (!app.source) return;
  const ctx = setupCtx;
  ctx.drawImage(app.source.element, 0, 0, setupCanvas.width, setupCanvas.height);
  const scale = setupCanvas.width / (setupCanvas.getBoundingClientRect().width || 1);
  const cs = app.corners;
  if (cs.length >= 2) {
    ctx.beginPath();
    cs.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    if (cs.length === 4) ctx.closePath();
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = '#19c3ff';
    ctx.stroke();
    if (cs.length === 4) { ctx.fillStyle = 'rgba(25,195,255,0.12)'; ctx.fill(); }
  }
  const labels = ['TL', 'TR', 'BR', 'BL'];
  cs.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 12 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#19c3ff';
    ctx.fill();
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    if (cs.length === 4) {
      ctx.fillStyle = '#032636';
      ctx.font = `bold ${10 * scale}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], c.x, c.y);
    }
  });
}

$('btn-play').addEventListener('click', () => {
  setCorners(app.corners);
  saveCorners();
  const paper = [{ x: 0, y: 0 }, { x: WORLD_W, y: 0 }, { x: WORLD_W, y: WORLD_H }, { x: 0, y: WORLD_H }];
  app.H = computeHomography(paper, app.corners);
  setMode('build');
  show('play');
  scan(true);
});

// ---------------------------------------------------------------- scanning
function scan(force = false) {
  const now = performance.now();
  if (!force && now - app.lastScan < SCAN_INTERVAL_MS) return;
  app.lastScan = now;
  const frame = app.source.capture();
  warpImage(frame, app.H, WORLD_W, WORLD_H, app.paperImg);
  app.paperCtx.putImageData(app.paperImg, 0, 0);
  app.shapes = detectShapes(app.paperImg, app.vision).shapes;
  $('shape-count').textContent = `${app.shapes.length} shape${app.shapes.length === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------- play controls
function setMode(mode) {
  app.mode = mode;
  const run = mode === 'run';
  $('btn-run').textContent = run ? '■ Stop' : '▶ Run';
  $('btn-run').classList.toggle('stop', run);
  $('btn-redrop').hidden = !run;
  $('mode-pill').textContent = run ? 'RUNNING' : 'BUILD';
  $('mode-pill').classList.toggle('running', run);
  if (run) {
    scan(true);                       // one last look, then freeze the layout
    app.world.setWalls(app.shapes);
    dropBall();
  } else {
    app.world.clearBall();
    toast('Build mode: draw, then press Run');
  }
}
function dropBall() {
  app.world.drop(app.drop.x, app.drop.y);
  app.stillSince = 0;
}

$('btn-run').addEventListener('click', () => setMode(app.mode === 'run' ? 'build' : 'run'));
$('btn-redrop').addEventListener('click', dropBall);
$('btn-view').addEventListener('click', toggleView);
$('btn-recal').addEventListener('click', () => {
  setMode('build');
  show('setup');
  if (app.source?.kind === 'webcam') loadSavedCorners();
});
$('btn-full').addEventListener('click', toggleFullscreen);

function toggleView() {
  app.view = app.view === 'camera' ? 'clean' : 'camera';
  $('btn-view').textContent = 'View: ' + (app.view === 'camera' ? 'Camera' : 'Clean');
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

$('sens').addEventListener('input', (e) => { app.vision.sensitivity = +e.target.value; scan(true); });
$('gap').addEventListener('input', (e) => { app.vision.gapFill = +e.target.value; scan(true); });

document.addEventListener('keydown', (e) => {
  if (!$('play').classList.contains('active')) return;
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'Space') { e.preventDefault(); $('btn-run').click(); }
  else if (e.key === 'r' || e.key === 'R') { if (app.mode === 'run') dropBall(); }
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 'c' || e.key === 'C') toggleView();
});

// Click the paper to move the drop point.
const gameCanvas = $('game-canvas');
const gameCtx = gameCanvas.getContext('2d');
let layout = { x: 0, y: 0, s: 1 };

function resizeGame() {
  const stage = $('stage');
  const r = stage.getBoundingClientRect();
  const s = Math.min(r.width / WORLD_W, r.height / WORLD_H);
  const dpr = window.devicePixelRatio || 1;
  gameCanvas.style.width = `${WORLD_W * s}px`;
  gameCanvas.style.height = `${WORLD_H * s}px`;
  gameCanvas.width = Math.round(WORLD_W * s * dpr);
  gameCanvas.height = Math.round(WORLD_H * s * dpr);
  layout = { s: s * dpr };
}
window.addEventListener('resize', () => { if ($('play').classList.contains('active')) resizeGame(); });
document.addEventListener('fullscreenchange', () => setTimeout(resizeGame, 50));

gameCanvas.addEventListener('pointerdown', (e) => {
  const r = gameCanvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * WORLD_W;
  const y = ((e.clientY - r.top) / r.height) * WORLD_H;
  app.drop = {
    x: Math.max(BALL_RADIUS, Math.min(WORLD_W - BALL_RADIUS, x)),
    y: Math.max(BALL_RADIUS, Math.min(WORLD_H - BALL_RADIUS, y)),
  };
  if (app.mode === 'run') dropBall();
});

// Hide the toolbar in fullscreen when the mouse is idle.
let idleTimer;
document.addEventListener('pointermove', () => {
  $('toolbar').classList.remove('hidden');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (document.fullscreenElement) $('toolbar').classList.add('hidden');
  }, 3000);
});

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  const dt = now - last;
  last = now;
  if ($('setup').classList.contains('active')) drawSetup();
  if ($('play').classList.contains('active') && app.source) {
    if (app.mode === 'build') scan();
    else {
      const prevState = app.world.state;
      app.world.step(dt);
      if (app.world.state === 'lost' && prevState === 'running') toast('The marble left the paper! Press R to drop again.', 3500);
      // Notice when the marble comes to rest.
      const b = app.world.ball;
      if (b && app.world.state === 'running') {
        const speed = Math.hypot(b.velocity.x, b.velocity.y);
        if (speed < 0.08) {
          if (!app.stillSince) app.stillSince = now;
          else if (now - app.stillSince > 2500) { toast('The marble stopped.', 2500); app.stillSince = Infinity; }
        } else if (app.stillSince !== Infinity) app.stillSince = 0;
      }
    }
    drawScene(gameCtx, layout.s, {
      world: app.world,
      shapes: app.shapes,
      paper: app.paperCanvas,
      view: app.view,
      mode: app.mode,
      drop: app.drop,
      now,
      W: WORLD_W,
      H: WORLD_H,
    });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Expose for debugging in the browser console.
window.marbleApp = app;
