import { computeHomography, warpImage } from './homography.js';
import { detectLevel, sampleColours, typeAt, DEFAULT_VISION } from './vision.js';
import { Level, Game } from './platformer.js';
import { Effects, Sfx } from './effects.js';
import { WebcamSource, ImageSource, listCameras, loadImageFile, makeDemoDrawing } from './camera.js';
import { drawScene, buildCleanImage } from './render.js';

// The game world is the flattened paper, in "paper pixels" (A-series ratio).
const WORLD_W = 1000;
const WORLD_H = 707;
const SCAN_INTERVAL_MS = 120;
const STORE_KEY = 'paper-platformer.calibration.v2';
const SETTINGS_KEY = 'paper-platformer.settings.v1';
const STEP_MS = 1000 / 60;

const VERSION = '2026-11-26.9';
const $ = (id) => document.getElementById(id);
document.getElementById('version').textContent = `Version ${VERSION}`;

const app = {
  source: null,
  corners: [],            // drawing-area corners in camera pixels, ordered TL, TR, BR, BL
  H: null,                // paper -> camera homography
  mode: 'build',          // build | play
  view: 'camera',         // camera | clean
  vision: { ...DEFAULT_VISION, samples: [] },
  orient: { rotate: 0, flipH: false, flipV: false },
  maxLives: 3,
  fixing: false,          // Fix colours mode
  fixUndo: [],            // number of samples added by each fix, for undo
  pendingFix: null,       // { x, y, samples } waiting for the teacher to choose a type
  det: null,              // latest detection result
  game: null,
  start: { x: 80, y: 560 },
  effects: new Effects(),
  sfx: new Sfx(),
  paperImg: new ImageData(WORLD_W, WORLD_H),
  paperCanvas: Object.assign(document.createElement('canvas'), { width: WORLD_W, height: WORLD_H }),
  cleanCanvas: document.createElement('canvas'),
  lastScan: 0,
};
app.paperCtx = app.paperCanvas.getContext('2d');

// ---------------------------------------------------------------- settings
function loadSettings() {
  try {
    const st = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!st) return;
    if (st.orient) app.orient = { ...app.orient, ...st.orient };
    if (Array.isArray(st.samples)) app.vision.samples = st.samples;
    if (st.colourMatch) app.vision.colourMatch = st.colourMatch;
    if (st.lives) app.maxLives = st.lives === 'Infinity' ? Infinity : +st.lives;
  } catch { /* storage unavailable */ }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      orient: app.orient, samples: app.vision.samples, colourMatch: app.vision.colourMatch, lives: String(app.maxLives),
    }));
  } catch { /* storage unavailable */ }
}
loadSettings();

// ---------------------------------------------------------------- screens
const isActive = (id) => $(id).classList.contains('active');
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
  $('camera-select').closest('.field').hidden = false;
  $('btn-lock').hidden = false;
  await startWebcam();
});

$('btn-demo').addEventListener('click', () => {
  const demo = makeDemoDrawing();
  app.source = new ImageSource(demo.canvas);
  app.start = demo.start;
  updateOrientButtons();
  $('step-camera').hidden = true;
  setCorners(demo.corners);
  show('setup');
});

$('photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = await loadImageFile(file);
  app.source = new ImageSource(img);
  $('step-camera').hidden = false;
  $('camera-select').closest('.field').hidden = true;
  $('btn-lock').hidden = true;
  updateOrientButtons();
  setCorners([]);
  show('setup');
  e.target.value = '';
});
document.querySelector('label[for="photo-input"]').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('photo-input').click(); }
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
    app.source.setOrientation(app.orient);
    updateOrientButtons();
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

// ---------------------------------------------------------------- orientation
function updateOrientButtons() {
  const o = app.source?.orient || app.orient;
  $('btn-fliph').setAttribute('aria-pressed', String(!!o.flipH));
  $('btn-flipv').setAttribute('aria-pressed', String(!!o.flipV));
  $('btn-rotate').textContent = `⟳ Rotate${o.rotate ? ` (${o.rotate}°)` : ''}`;
}
function changeOrientation(change) {
  if (!app.source) return;
  const o = { ...app.source.orient };
  if (change === 'rotate') o.rotate = (o.rotate + 90) % 360;
  if (change === 'flipH') o.flipH = !o.flipH;
  if (change === 'flipV') o.flipV = !o.flipV;
  app.source.setOrientation(o);
  if (app.source.kind === 'webcam') { app.orient = o; saveSettings(); }
  setCorners([]);            // the old corners no longer line up
  loadSavedCorners();
  resizeSetup();
  updateOrientButtons();
}
$('btn-rotate').addEventListener('click', () => changeOrientation('rotate'));
$('btn-fliph').addEventListener('click', () => changeOrientation('flipH'));
$('btn-flipv').addEventListener('click', () => changeOrientation('flipV'));

// ---------------------------------------------------------------- corners
function orderCorners(pts) {
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
    const ok = saved && app.source.kind === 'webcam' && saved.w === app.source.width && saved.h === app.source.height
      && saved.corners?.length === 4 && JSON.stringify(saved.orient) === JSON.stringify(app.source.orient);
    $('btn-saved-corners').hidden = !ok;
    if (ok && app.corners.length === 0) {
      setCorners(saved.corners);
      if (saved.start) app.start = saved.start;
    }
  } catch { /* storage unavailable */ }
}
function saveSetup() {
  if (app.source?.kind !== 'webcam') return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      w: app.source.width, h: app.source.height, orient: app.source.orient, corners: app.corners, start: app.start,
    }));
  } catch { /* storage unavailable */ }
}

$('btn-reset-corners').addEventListener('click', () => setCorners([]));
$('btn-saved-corners').addEventListener('click', () => {
  try { setCorners(JSON.parse(localStorage.getItem(STORE_KEY)).corners); } catch { /* ignore */ }
});

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
  if (setupCanvas.width !== app.source.width || setupCanvas.height !== app.source.height) resizeSetup();
  ctx.drawImage(app.source.draw(), 0, 0, setupCanvas.width, setupCanvas.height);
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
  saveSetup();
  const paper = [{ x: 0, y: 0 }, { x: WORLD_W, y: 0 }, { x: WORLD_W, y: WORLD_H }, { x: 0, y: WORLD_H }];
  app.H = computeHomography(paper, app.corners);
  show('play');
  setMode('build');
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
  app.det = detectLevel(app.paperImg, app.vision);
  buildCleanImage(app.det, app.cleanCanvas);
  for (const t of ['solid', 'bouncy', 'hazard', 'goal', 'coin']) $('n-' + t).textContent = app.det.counts[t];
}

// ---------------------------------------------------------------- modes
function setMode(mode) {
  app.mode = mode;
  const play = mode === 'play';
  $('btn-mode').textContent = play ? '✎ Build' : '▶ Play';
  $('btn-mode').classList.toggle('stop', play);
  $('btn-restart').hidden = !play;
  $('mode-pill').textContent = play ? 'PLAYING' : 'BUILD';
  $('mode-pill').classList.toggle('running', play);
  $('hint-inline').textContent = play
    ? '← → to run · Space or ↑ to jump · R to restart'
    : 'Draw, then press Play. Click the paper to move the start flag.';
  $('win').hidden = true;
  app.effects.clear();
  if (play) setFixing(false);
  if (play) {
    app.sfx.ensure();
    scan(true);                       // one last look, then freeze the level
    app.game = new Game(new Level(app.det, WORLD_W, WORLD_H), app.start, app.maxLives);
    app.game.events.push({ type: 'spawn', x: app.game.player.x, y: app.game.player.y });
    if (!app.det.counts.goal) toast('No green goal yet. Draw one to win!', 3000);
  } else {
    app.game = null;
  }
}

function restart() {
  if (!app.game) return;
  $('win').hidden = true;
  app.effects.clear();
  app.game.restart();
}

const blurAfter = (fn) => (e) => { e.currentTarget.blur(); fn(); };
$('btn-mode').addEventListener('click', blurAfter(() => setMode(app.mode === 'play' ? 'build' : 'play')));
$('btn-restart').addEventListener('click', blurAfter(restart));
$('btn-again').addEventListener('click', blurAfter(restart));
$('btn-tobuild').addEventListener('click', blurAfter(() => setMode('build')));
$('btn-view').addEventListener('click', blurAfter(toggleView));
$('btn-sound').addEventListener('click', blurAfter(toggleSound));
$('btn-recal').addEventListener('click', blurAfter(() => {
  setMode('build');
  show('setup');
  if (app.source?.kind === 'webcam') loadSavedCorners();
}));
$('btn-full').addEventListener('click', blurAfter(toggleFullscreen));

function toggleView() {
  app.view = app.view === 'camera' ? 'clean' : 'camera';
  $('btn-view').textContent = 'View: ' + (app.view === 'camera' ? 'Camera' : 'Clean');
}
function toggleSound() {
  app.sfx.muted = !app.sfx.muted;
  $('btn-sound').textContent = app.sfx.muted ? '🔇' : '🔊';
  $('btn-sound').setAttribute('aria-pressed', String(!app.sfx.muted));
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
}

$('sens').addEventListener('input', (e) => { app.vision.sensitivity = +e.target.value; scan(true); });
$('match').value = String(app.vision.colourMatch);
$('match').addEventListener('input', (e) => { app.vision.colourMatch = +e.target.value; saveSettings(); scan(true); });
$('gap').addEventListener('input', (e) => { app.vision.gapFill = +e.target.value; scan(true); });

$('lives').value = String(app.maxLives);
$('lives').addEventListener('change', (e) => {
  app.maxLives = e.target.value === 'Infinity' ? Infinity : +e.target.value;
  saveSettings();
  if (app.game) { app.game.maxLives = app.maxLives; restart(); }
});

// ---------------------------------------------------------------- fix colours
// Click anything the camera got wrong and say what it should be. The colours
// under the click become new examples for that type (or "ignore").
const TYPE_LABEL = { solid: 'Ground', bouncy: 'Bouncy', hazard: 'Danger', goal: 'Goal', coin: 'Coin', ignore: 'Ignore' };
const MAX_SAMPLES = 150;

function setFixing(on) {
  app.fixing = on;
  if (on && app.mode === 'play') setMode('build');
  $('btn-fix').setAttribute('aria-pressed', String(on));
  $('fix-panel').hidden = !on;
  gameCanvas.classList.toggle('fixing', on);
  if (!on) hideFixMenu();
  updateFixPanel();
}
function updateFixPanel() {
  const n = app.fixUndo.length, total = app.vision.samples.length;
  $('fix-count').textContent = total
    ? `${total} colour example${total === 1 ? '' : 's'} saved on this computer${n ? ` (${n} fix${n === 1 ? '' : 'es'} this session)` : ''}.`
    : 'No fixes yet. Using the standard marker colours.';
  $('btn-fix-undo').disabled = !n;
  $('btn-fix-reset').disabled = !total;
}
function hideFixMenu() {
  $('fix-menu').hidden = true;
  app.pendingFix = null;
}
function openFixMenu(x, y, clientX, clientY) {
  const samples = sampleColours(app.det, x, y, 12);
  if (!samples) {
    toast('That looks like blank paper. Click right on the marker line.', 3000);
    return;
  }
  const current = typeAt(app.det, x, y, 12);
  app.pendingFix = { samples };
  $('fix-menu-title').textContent = current
    ? `The camera thinks this is ${TYPE_LABEL[current]}. It should be…`
    : 'The camera is ignoring this. It should be…';
  document.querySelectorAll('#fix-menu [data-type]').forEach((b) =>
    b.classList.toggle('current', b.dataset.type === (current || 'ignore')));
  const menu = $('fix-menu');
  menu.hidden = false;
  const st = $('stage').getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.min(st.width - mw - 8, Math.max(8, clientX - st.left + 12))}px`;
  menu.style.top = `${Math.min(st.height - mh - 8, Math.max(8, clientY - st.top - 20))}px`;
  menu.querySelector(`[data-type="${current === 'solid' ? 'bouncy' : 'solid'}"]`)?.focus();
}
function applyFix(type) {
  const fix = app.pendingFix;
  hideFixMenu();
  if (!fix || type === 'cancel') return;
  app.vision.samples.push(...fix.samples.map((c) => ({ ...c, type })));
  app.fixUndo.push(fix.samples.length);
  // Keep the newest examples if the list grows very long.
  if (app.vision.samples.length > MAX_SAMPLES) app.vision.samples.splice(0, app.vision.samples.length - MAX_SAMPLES);
  saveSettings();
  scan(true);
  updateFixPanel();
  toast(type === 'ignore' ? 'Got it: that colour will be ignored.' : `Got it: that colour is now ${TYPE_LABEL[type]}.`);
}
document.querySelectorAll('#fix-menu [data-type]').forEach((b) =>
  b.addEventListener('click', () => applyFix(b.dataset.type)));
$('btn-fix').addEventListener('click', blurAfter(() => setFixing(!app.fixing)));
$('btn-fix-done').addEventListener('click', () => setFixing(false));
$('btn-fix-undo').addEventListener('click', () => {
  const n = app.fixUndo.pop();
  if (!n) return;
  app.vision.samples.splice(app.vision.samples.length - n, n);
  saveSettings();
  scan(true);
  updateFixPanel();
  toast('Undone');
});
$('btn-fix-reset').addEventListener('click', () => {
  if (!confirm('Forget all colour fixes on this computer and go back to the standard marker colours?')) return;
  app.vision.samples = [];
  app.fixUndo = [];
  saveSettings();
  scan(true);
  updateFixPanel();
  toast('Back to the standard marker colours');
});

// ---------------------------------------------------------------- input
const keys = new Set();
let jumpQueued = false;
const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
const GAME_KEYS = [...JUMP_KEYS, 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'KeyA', 'KeyD'];

document.addEventListener('keydown', (e) => {
  if (!isActive('play')) return;
  if (e.target.tagName === 'SELECT') return;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  if (!keys.has(e.code) && JUMP_KEYS.includes(e.code)) jumpQueued = true;
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'Enter') { e.preventDefault(); setMode(app.mode === 'play' ? 'build' : 'play'); }
  else if (e.code === 'Escape' && !$('fix-menu').hidden) hideFixMenu();
  else if (e.code === 'Escape' && app.fixing) setFixing(false);
  else if (e.code === 'Escape' && app.mode === 'play') setMode('build');
  else if (e.code === 'KeyR') restart();
  else if (e.code === 'KeyF') toggleFullscreen();
  else if (e.code === 'KeyC') toggleView();
  else if (e.code === 'KeyM') toggleSound();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// Gamepads: left stick / d-pad to move, A (or B) to jump, Start to switch modes.
let padJumpWas = false, padStartWas = false, padRestartWas = false;
function readInput() {
  let left = keys.has('ArrowLeft') || keys.has('KeyA');
  let right = keys.has('ArrowRight') || keys.has('KeyD');
  let jumpHeld = JUMP_KEYS.some((k) => keys.has(k));
  let jumpPressed = jumpQueued;
  jumpQueued = false;
  for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
    if (!pad) continue;
    const ax = pad.axes[0] || 0;
    const btn = (i) => pad.buttons[i]?.pressed;
    if (ax < -0.35 || btn(14)) left = true;
    if (ax > 0.35 || btn(15)) right = true;
    const j = btn(0) || btn(1) || btn(12);
    if (j) jumpHeld = true;
    if (j && !padJumpWas) jumpPressed = true;
    padJumpWas = j;
    const st = btn(9);
    if (st && !padStartWas) setMode(app.mode === 'play' ? 'build' : 'play');
    padStartWas = st;
    const rs = btn(3) || btn(8);
    if (rs && !padRestartWas) restart();
    padRestartWas = rs;
  }
  return { left, right, jumpHeld, jumpPressed };
}

// ---------------------------------------------------------------- canvas
const gameCanvas = $('game-canvas');
const gameCtx = gameCanvas.getContext('2d');
let canvasScale = 1;

function resizeGame() {
  const r = $('stage').getBoundingClientRect();
  const s = Math.min(r.width / WORLD_W, r.height / WORLD_H);
  const dpr = window.devicePixelRatio || 1;
  gameCanvas.style.width = `${WORLD_W * s}px`;
  gameCanvas.style.height = `${WORLD_H * s}px`;
  gameCanvas.width = Math.round(WORLD_W * s * dpr);
  gameCanvas.height = Math.round(WORLD_H * s * dpr);
  canvasScale = s * dpr;
}
window.addEventListener('resize', () => { if (isActive('play')) resizeGame(); });
document.addEventListener('fullscreenchange', () => setTimeout(resizeGame, 50));

// Click the paper (in build mode) to move the start flag.
gameCanvas.addEventListener('pointerdown', (e) => {
  if (app.mode !== 'build') return;
  const r = gameCanvas.getBoundingClientRect();
  if (app.fixing) {
    openFixMenu(((e.clientX - r.left) / r.width) * WORLD_W, ((e.clientY - r.top) / r.height) * WORLD_H, e.clientX, e.clientY);
    return;
  }
  app.start = {
    x: Math.max(12, Math.min(WORLD_W - 12, ((e.clientX - r.left) / r.width) * WORLD_W)),
    y: Math.max(50, Math.min(WORLD_H - 4, ((e.clientY - r.top) / r.height) * WORLD_H)),
  };
  saveSetup();
});

// Hide the toolbar in fullscreen when the mouse is idle.
let idleTimer;
document.addEventListener('pointermove', () => {
  $('toolbar').classList.remove('hidden');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (document.fullscreenElement) $('toolbar').classList.add('hidden'); }, 3000);
});

let toastTimer;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function showEnd(kind) {
  const g = app.game;
  if (!g || g.state !== kind) return;
  const won = kind === 'won';
  const parts = [];
  if (won) parts.push(`Time ${g.seconds.toFixed(1)}s`);
  if (g.coinsTotal) parts.push(`Coins ${g.coinsTaken}/${g.coinsTotal}`);
  if (won) {
    if (Number.isFinite(g.maxLives)) parts.push(g.deaths ? `${g.lives} ${g.lives === 1 ? 'life' : 'lives'} left` : 'No lives lost!');
    else parts.push(g.deaths ? `${g.deaths} ${g.deaths === 1 ? 'fall' : 'falls'}` : 'First try!');
  } else {
    parts.push('Can you find a safer way?');
  }
  $('win-title').textContent = won ? 'Level complete! 🎉' : 'Out of lives!';
  $('btn-again-label').textContent = won ? 'Play again' : 'Try again';
  document.querySelector('.win-card').classList.toggle('over', !won);
  $('win-stats').textContent = parts.join(' · ');
  $('win').hidden = false;
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(100, now - last);
  last = now;
  if (isActive('setup')) drawSetup();
  if (isActive('play') && app.source) {
    if (app.mode === 'build') scan();
    acc += dt;
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      const input = readInput();
      if (app.game) {
        const before = app.game.state;
        app.game.update(input);
        for (const e of app.game.events) app.effects.handle(e, app.sfx);
        app.game.events.length = 0;
        const after = app.game.state;
        if (before !== after && (after === 'won' || after === 'over')) setTimeout(() => showEnd(after), after === 'won' ? 900 : 1100);
        // Jump on the end screen = play again
        if (!$('win').hidden && input.jumpPressed) restart();
      }
      app.effects.update();
    }
    drawScene(gameCtx, canvasScale, {
      W: WORLD_W, H: WORLD_H,
      paper: app.paperCanvas, clean: app.cleanCanvas,
      view: app.view, mode: app.mode, det: app.det, fixing: app.fixing,
      game: app.game, start: app.start, effects: app.effects, now,
    });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateFixPanel();

// For debugging in the browser console.
window.gameApp = app;
