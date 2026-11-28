// The app shell: start screen, camera setup, scanning, class levels, Fix colours,
// controls and the game loop. Everything game-specific lives in js/games/.

import { computeHomography, warpImage } from './core/homography.js';
import { detectLevel, sampleColours, colourAt, DEFAULT_VISION, LEGACY_TYPES } from './core/vision.js';
import { COLOUR_INFO, COLOUR_IDS, buildCleanImage, drawOutlines } from './core/colours.js';
import { Effects, Sfx } from './core/effects.js';
import { drawHud } from './core/hud.js';
import { WebcamSource, ImageSource, listCameras, loadImageFile } from './core/camera.js';
import * as Library from './core/library.js';
import { readFiles, flattenPage, flattenPlain, rotateCanvas, shrink } from './core/importer.js';
import { findCornerMarks } from './core/markers.js';
import { TouchControls } from './core/touch.js';
import { Input, GAME_KEYS, padButtonsPressed } from './core/input.js';
import { GAMES, COMING_SOON, getGame } from './games/index.js';
import { Projector } from './core/projector.js';

// The game world is the flattened paper, in "paper pixels" (A-series ratio).
const WORLD_W = 1000;
const WORLD_H = 707;
const SCAN_INTERVAL_MS = 120;
const STORE_KEY = 'paper-platformer.calibration.v2';
const SETTINGS_KEY = 'paper-platformer.settings.v1';
const STEP_MS = 1000 / 60;
const LAST_GAME_KEY = 'paper-arcade.game';

const VERSION = '2026-11-28.1';
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
  gameDef: GAMES[0],       // the chosen game module (js/games/…)
  gameSettings: {},       // per game: { [gameId]: { settingId: value } }
  touchMode: 'auto',      // on-screen controls: auto | on | off
  zoom: 'auto',           // zoomed-in view while playing: auto (touch screens) | on | off
  cam: { x: 500, y: 350, lead: 0 },   // the zoomed view's centre, in paper pixels
  sawTouch: false,        // a finger has touched the screen this session
  currentLevelId: null,   // set while playing a saved level
  levelIds: [],           // the library order, for previous / next
  fixing: false,          // Fix colours mode
  fixUndo: [],            // number of samples added by each fix, for undo
  pendingFix: null,       // { x, y, samples } waiting for the teacher to choose a type
  det: null,              // latest detection result
  session: null,          // the game being played (null while building)
  start: { x: 80, y: 560 },
  effects: new Effects(),
  sfx: new Sfx(),
  paperImg: new ImageData(WORLD_W, WORLD_H),
  paperCanvas: Object.assign(document.createElement('canvas'), { width: WORLD_W, height: WORLD_H }),
  cleanCanvas: document.createElement('canvas'),
  lastScan: 0,
  projMode: false,        // projector mode: the game is projected onto the board
};
app.paperCtx = app.paperCanvas.getContext('2d');

// ---------------------------------------------------------------- settings
function loadSettings() {
  try {
    const st = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (!st) return;
    if (st.orient) app.orient = { ...app.orient, ...st.orient };
    // Older versions stored fixes by platformer meaning (e.g. 'solid'); convert them to colours.
    if (Array.isArray(st.samples)) app.vision.samples = st.samples.map((x) => ({ ...x, type: LEGACY_TYPES[x.type] || x.type }));
    if (st.colourMatch) app.vision.colourMatch = st.colourMatch;
    if (st.gameSettings && typeof st.gameSettings === 'object') app.gameSettings = st.gameSettings;
    else if (st.lives) app.gameSettings = { platformer: { lives: String(st.lives) } };
    if (['auto', 'on', 'off'].includes(st.touchMode)) app.touchMode = st.touchMode;
    if (['auto', 'on', 'off'].includes(st.zoom)) app.zoom = st.zoom;
  } catch { /* storage unavailable */ }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      orient: app.orient, samples: app.vision.samples, colourMatch: app.vision.colourMatch,
      gameSettings: app.gameSettings, touchMode: app.touchMode, zoom: app.zoom,
    }));
  } catch { /* storage unavailable */ }
}
loadSettings();

// ---------------------------------------------------------------- choosing a game
// Colours the current game uses, in the standard order.
const usedColours = () => COLOUR_IDS.filter((c) => app.gameDef.colours[c]);

function settingsFor(game) {
  const saved = app.gameSettings[game.id] || {};
  const out = {};
  for (const st of game.settings || []) out[st.id] = saved[st.id] ?? st.value;
  return out;
}

function chooseGame(id, { remember = true } = {}) {
  app.gameDef = getGame(id);
  if (remember) { try { localStorage.setItem(LAST_GAME_KEY, app.gameDef.id); } catch { /* ignore */ } }
  const g = app.gameDef;
  document.title = `${g.name} · Paper Arcade`;
  document.querySelectorAll('.game-card[data-game]').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.game === g.id)));
  $('game-tagline').textContent = g.tagline;
  // Colour key on the start screen
  $('legend').innerHTML = '';
  for (const c of usedColours()) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="chip ${c}"></span><b>${COLOUR_INFO[c].name}</b> <span></span>`;
    li.lastElementChild.textContent = g.colours[c].toLowerCase();
    $('legend').appendChild(li);
  }
  // Toolbar counts
  $('legend-mini').innerHTML = '';
  for (const c of usedColours()) {
    const li = document.createElement('li');
    li.title = `${COLOUR_INFO[c].name}: ${g.colours[c]}`;
    li.innerHTML = `<span class="chip ${c}"></span><span id="n-${c}">0</span>`;
    $('legend-mini').appendChild(li);
  }
  // Fix colours menu: every colour, labelled with what it means in this game
  $('fix-items').innerHTML = '';
  for (const c of COLOUR_IDS) {
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.dataset.type = c;
    b.innerHTML = `<span class="chip ${c}"></span><span></span>`;
    b.lastElementChild.textContent = g.colours[c] ? `${COLOUR_INFO[c].name}: ${g.colours[c]}` : `${COLOUR_INFO[c].name} (not used in this game)`;
    b.addEventListener('click', () => applyFix(c));
    $('fix-items').appendChild(b);
  }
  // Game options under Tune
  const box = $('game-settings');
  box.innerHTML = '';
  const current = settingsFor(g);
  for (const st of g.settings || []) {
    const label = document.createElement('label');
    label.className = 'slider';
    label.textContent = st.label + ' ';
    const sel = document.createElement('select');
    for (const [v, text] of st.options) {
      const o = document.createElement('option');
      o.value = v; o.textContent = text;
      sel.appendChild(o);
    }
    sel.value = current[st.id];
    sel.addEventListener('change', () => {
      app.gameSettings[g.id] = { ...(app.gameSettings[g.id] || {}), [st.id]: sel.value };
      saveSettings();
      if (app.session) setMode('play');   // restart with the new setting
    });
    label.appendChild(sel);
    box.appendChild(label);
  }
  $('lib-title').textContent = `Class levels: ${g.name}`;
  $('tb-a-lbl').textContent = g.buttons?.a || '';
  $('tb-b-lbl').textContent = g.buttons?.b || '';
  app.start = { ...g.defaultStart };
}

function renderGamePicker() {
  const box = $('game-picker');
  box.innerHTML = '';
  for (const g of GAMES) {
    const b = document.createElement('button');
    b.className = 'game-card';
    b.dataset.game = g.id;
    b.setAttribute('role', 'radio');
    b.innerHTML = `<span class="g-icon" aria-hidden="true">${g.icon}</span><span class="g-name"></span>`;
    b.querySelector('.g-name').textContent = g.name;
    b.addEventListener('click', () => chooseGame(g.id));
    box.appendChild(b);
  }
  for (const g of COMING_SOON) {
    const b = document.createElement('button');
    b.className = 'game-card';
    b.disabled = true;
    b.title = g.tagline;
    b.innerHTML = `<span class="g-icon" aria-hidden="true">${g.icon}</span><span class="g-name"></span><span class="g-soon">Coming soon</span>`;
    b.querySelector('.g-name').textContent = g.name;
    box.appendChild(b);
  }
}
renderGamePicker();
{
  // ?game=… in the link picks the game (handy for sharing); otherwise the last one used.
  let id = new URLSearchParams(location.search).get('game');
  if (!id) { try { id = localStorage.getItem(LAST_GAME_KEY); } catch { /* ignore */ } }
  chooseGame(id || GAMES[0].id, { remember: false });
}

// ---------------------------------------------------------------- screens
const isActive = (id) => $(id).classList.contains('active');
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  if (id === 'play') resizeGame();
  if (id === 'setup') { resizeSetup(); updateFreezeButtons(); }
  if (id === 'library') renderLibrary();
}
document.querySelectorAll('[data-goto]').forEach((b) =>
  b.addEventListener('click', () => { stopSource(); show(b.dataset.goto); }));

function stopSource() {
  if (app.source) app.source.stop();
  app.source = null;
}

// ---------------------------------------------------------------- start screen
// Phones: go full screen and stay landscape, so the screen doesn't spin round
// while the phone points down at the paper. (Android allows this; iPhones and
// iPads don't, so they get a tip to use rotation lock instead.)
const smallTouch = () => window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
function holdLandscape() {
  if (!smallTouch()) return;
  const full = document.fullscreenElement ? Promise.resolve()
    : document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  Promise.resolve(full)
    .then(() => (screen.orientation?.lock ? screen.orientation.lock('landscape') : Promise.reject()))
    .then(() => { $('rotate-tip').hidden = true; })
    .catch(() => { $('rotate-tip').hidden = false; });
}

$('btn-screen').addEventListener('click', async () => {
  holdLandscape();
  setProjMode(false);
  show('setup');
  $('step-camera').hidden = false;
  $('camera-select').closest('.field').hidden = false;
  $('btn-lock').hidden = false;
  await startWebcam();
});

$('btn-demo').addEventListener('click', () => {
  setProjMode(false);
  const demo = app.gameDef.makeDemo();
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
  setProjMode(false);
  app.source = new ImageSource(img);
  $('step-camera').hidden = false;
  $('camera-select').closest('.field').hidden = true;
  $('btn-lock').hidden = true;
  updateOrientButtons();
  setCorners([]);
  app.currentLevelId = null;
  show('setup');
  findMarks(true);
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
    updateFreezeButtons();
    status.textContent = '';
    await fillCameraList(deviceId);
    loadSavedCorners();
    resizeSetup();
    if (app.corners.length < 4 && !app.projMode) setTimeout(() => findMarks(true), 600);
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

// ---------------------------------------------------------------- holding the picture still
function updateFreezeButtons() {
  const cam = app.source?.kind === 'webcam';
  const frozen = !!app.source?.frozen;
  $('btn-freeze').hidden = !cam || app.projMode;
  $('btn-freeze').setAttribute('aria-pressed', String(frozen));
  $('btn-freeze').textContent = frozen ? '🎥 Back to live' : '📸 Hold picture';
  $('btn-snap').hidden = !cam || app.mode === 'play' || app.projMode;
  $('btn-snap').textContent = frozen ? '🎥 Live' : '📸 Snap';
}
$('btn-freeze').addEventListener('click', () => {
  if (!app.source?.freeze) return;
  if (app.source.frozen) app.source.unfreeze();
  else { app.source.freeze(); if (app.corners.length < 4) findMarks(true); }
  updateFreezeButtons();
});
// While building: snap a still picture of the drawing (and find the sheet's
// corners again, in case the phone moved), or go back to the live camera.
$('btn-snap').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (!app.source?.freeze) return;
  if (app.source.frozen) {
    app.source.unfreeze();
    toast('Live camera', 1200);
  } else {
    app.source.freeze();
    const pts = findCornerMarks(app.source.capture());
    if (pts) { setCorners(pts); useCorners(); }
    toast(pts ? 'Picture held ✓ (found the sheet corners)' : 'Picture held ✓', 1800);
  }
  scan(true);
  updateFreezeButtons();
});
// The camera picture changed shape (a phone turned): the corners no longer line up.
function cameraTurned() {
  app.source.sizeChanged = false;
  if (app.projMode) {
    const had = app.corners.length === 4;
    setCorners([]);
    resizeSetup();
    if (!had) return;   // the camera just started up: nothing to redo
    projStatus('The camera picture changed. Press Line up again.', 'warn');
    if (isActive('play')) toast('The camera picture changed. Press ⚙ Setup and Line up again.', 3500);
    return;
  }
  if (isActive('setup')) {
    setCorners([]);
    resizeSetup();
    findMarks(true);
  } else if (isActive('play')) {
    const pts = findCornerMarks(app.source.capture());
    if (pts) { setCorners(pts); useCorners(); scan(true); }
    else toast('The camera picture turned. Press ⚙ Setup to set the corners again.', 3500);
  }
}

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
  if (app.projMode) projStatus('The camera turned. Press Line up again.', 'warn');
  resizeSetup();
  updateOrientButtons();
  updateFreezeButtons();
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
  if (app.projMode) { $('btn-saved-corners').hidden = true; return; }
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
  if (app.source?.kind !== 'webcam' || app.projMode) return;
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
  app.currentLevelId = null;
  updateLevelNav();
  useCorners();
  show('play');
  setMode('build');
  scan(true);
});

// Map the paper onto the four corners.
function useCorners() {
  const paper = [{ x: 0, y: 0 }, { x: WORLD_W, y: 0 }, { x: WORLD_W, y: WORLD_H }, { x: 0, y: WORLD_H }];
  app.H = computeHomography(paper, app.corners);
  saveSetup();
}

// Look for the printed sheet's four corner squares and use them as the corners.
function findMarks(quiet = false) {
  if (!app.source) return false;
  const pts = findCornerMarks(app.source.capture());
  if (pts) {
    setCorners(pts);
    toast('Found the corner marks on the level sheet ✓');
    return true;
  }
  if (!quiet) toast('Couldn’t see all four corner squares. Check they’re in view, or click the corners instead.', 3500);
  return false;
}
$('btn-find-marks').addEventListener('click', () => findMarks(false));

// ---------------------------------------------------------------- scanning
function scan(force = false) {
  const now = performance.now();
  if (!force && now - app.lastScan < SCAN_INTERVAL_MS) return;
  app.lastScan = now;
  const frame = app.source.capture();
  warpImage(frame, app.H, WORLD_W, WORLD_H, app.paperImg);
  app.paperCtx.putImageData(app.paperImg, 0, 0);
  app.det = detectLevel(app.paperImg, app.vision);
  buildCleanImage(app.det, app.cleanCanvas, usedColours());
  for (const c of usedColours()) { const el = $('n-' + c); if (el) el.textContent = app.det.counts[c]; }
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
  $('hint-inline').textContent = play ? app.gameDef.playHint : app.gameDef.buildHint;
  $('win').hidden = true;
  $('play').classList.toggle('playing', play);
  input.clear();
  resizeGame();
  app.effects.clear();
  if (play) setFixing(false);
  if (play) {
    app.sfx.ensure();
    scan(true);                       // one last look, then freeze the level
    app.session = app.gameDef.create({
      det: app.det, start: { ...app.start }, settings: settingsFor(app.gameDef), W: WORLD_W, H: WORLD_H,
    });
    const warning = app.gameDef.checkLevel?.(app.det);
    if (warning) toast(warning, 3000);
    else if (touchOn() && !app.portraitTipShown && innerHeight > innerWidth && innerWidth < 700) {
      app.portraitTipShown = true;
      toast('Tip: turn sideways for a bigger view', 3000);
    }
  } else {
    app.session = null;
  }
  $('btn-zoom').hidden = !(play && app.session?.focus);
  updateFreezeButtons();
  resizeGame();   // the zoomed view needs the session
}

function restart() {
  if (!app.session) return;
  $('win').hidden = true;
  app.effects.clear();
  app.session.restart();
  updateCamera(true);
}

const blurAfter = (fn) => (e) => { e.currentTarget.blur(); fn(); };
$('btn-mode').addEventListener('click', blurAfter(() => setMode(app.mode === 'play' ? 'build' : 'play')));
$('btn-restart').addEventListener('click', blurAfter(restart));
$('btn-zoom').addEventListener('click', blurAfter(toggleZoom));
$('btn-again').addEventListener('click', blurAfter(restart));
$('btn-tobuild').addEventListener('click', blurAfter(() => setMode('build')));
$('btn-view').addEventListener('click', blurAfter(toggleView));
$('btn-sound').addEventListener('click', blurAfter(toggleSound));
$('btn-recal').addEventListener('click', blurAfter(() => {
  setMode('build');
  if (app.currentLevelId) { show('library'); return; }
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
  $('sound-icon').textContent = app.sfx.muted ? '🔇' : '🔊';
  $('btn-sound').setAttribute('aria-pressed', String(!app.sfx.muted));
}
if (!document.fullscreenEnabled) $('btn-full').hidden = true;
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (smallTouch()) holdLandscape();
  else document.documentElement.requestFullscreen?.();
}

$('sens').addEventListener('input', (e) => { app.vision.sensitivity = +e.target.value; scan(true); });
$('match').value = String(app.vision.colourMatch);
$('match').addEventListener('input', (e) => { app.vision.colourMatch = +e.target.value; saveSettings(); scan(true); });
$('gap').addEventListener('input', (e) => { app.vision.gapFill = +e.target.value; scan(true); });

// ---------------------------------------------------------------- fix colours
// Click anything the camera got wrong and say what it should be. The colours
// under the click become new examples for that type (or "ignore").
const fixLabel = (c) => (c === 'ignore' ? 'ignored'
  : app.gameDef.colours[c] ? `${COLOUR_INFO[c].name.toLowerCase()} (${app.gameDef.colours[c].toLowerCase()})` : COLOUR_INFO[c].name.toLowerCase());
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
  const current = colourAt(app.det, x, y, 12);
  app.pendingFix = { samples };
  $('fix-menu-title').textContent = current
    ? `The camera sees this as ${fixLabel(current)}. It should be…`
    : 'The camera is ignoring this. It should be…';
  document.querySelectorAll('#fix-menu [data-type]').forEach((b) =>
    b.classList.toggle('current', b.dataset.type === (current || 'ignore')));
  const menu = $('fix-menu');
  menu.hidden = false;
  const st = $('stage').getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.min(st.width - mw - 8, Math.max(8, clientX - st.left + 12))}px`;
  menu.style.top = `${Math.min(st.height - mh - 8, Math.max(8, clientY - st.top - 20))}px`;
  menu.querySelector(`[data-type="${current === 'black' ? 'blue' : 'black'}"]`)?.focus();
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
  toast(type === 'ignore' ? 'Got it: that colour will be ignored.' : `Got it: that colour is now ${fixLabel(type)}.`);
}
document.querySelectorAll('#fix-menu > [data-type]').forEach((b) =>
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

// ---------------------------------------------------------------- class levels

function fmtDate(t) {
  try { return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; }
}

async function renderLibrary() {
  const grid = $('lib-grid');
  let levels = [];
  try { levels = await Library.listLevels(app.gameDef.id); } catch (err) {
    grid.innerHTML = '';
    $('lib-empty').hidden = false;
    $('lib-empty').innerHTML = `<p><b>This browser won't let the game save levels.</b></p><p>${err.message || ''} Private/incognito windows often block saving.</p>`;
    return;
  }
  app.levelIds = levels.map((l) => l.id);
  $('lib-empty').hidden = levels.length > 0;
  $('btn-export').disabled = !levels.length;
  grid.innerHTML = '';
  for (const l of levels) {
    const li = document.createElement('li');
    li.className = 'lib-card';
    li.innerHTML = `
      <button class="thumb" aria-label="Play ${escapeHtml(l.name)}"><img alt="" src="${l.thumb}"></button>
      <div class="meta"><div class="name"></div><div class="date">${fmtDate(l.created)}</div></div>
      <div class="acts">
        <button class="primary play">▶ Play</button>
        <button class="secondary ren" title="Rename">✎</button>
        <button class="secondary del" title="Delete">🗑</button>
      </div>`;
    li.querySelector('.name').textContent = l.name;
    li.querySelector('.thumb').addEventListener('click', () => playLevel(l.id));
    li.querySelector('.play').addEventListener('click', () => playLevel(l.id));
    li.querySelector('.ren').addEventListener('click', async () => {
      const name = prompt('New name for this level:', l.name);
      if (name && name.trim()) { await Library.renameLevel(l.id, name.trim().slice(0, 80)); renderLibrary(); }
    });
    li.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(`Delete "${l.name}"? This can't be undone (unless it's in an exported library file).`)) return;
      await Library.deleteLevel(l.id);
      renderLibrary();
    });
    grid.appendChild(li);
  }
}
const escapeHtml = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function playLevel(id) {
  const level = await Library.getLevel(id);
  if (!level) return;
  if (level.game && level.game !== app.gameDef.id && GAMES.some((g) => g.id === level.game)) chooseGame(level.game);
  if (!app.levelIds.includes(id)) app.levelIds = (await Library.listLevels(app.gameDef.id)).map((l) => l.id);
  const img = await Library.loadImage(level.image);
  stopSource();
  app.source = new ImageSource(img);
  setCorners([{ x: 0, y: 0 }, { x: img.width, y: 0 }, { x: img.width, y: img.height }, { x: 0, y: img.height }]);
  const paper = [{ x: 0, y: 0 }, { x: WORLD_W, y: 0 }, { x: WORLD_W, y: WORLD_H }, { x: 0, y: WORLD_H }];
  app.H = computeHomography(paper, app.corners);
  app.start = level.start || { ...app.gameDef.defaultStart };
  app.currentLevelId = id;
  app.currentLevelName = level.name;
  updateLevelNav();
  show('play');
  setMode('build');
  scan(true);
  if (!level.start) {
    app.start = app.gameDef.guessStart(app.det);
    Library.updateStart(id, app.start).catch(() => {});
  }
  toast(level.name, 1800);
}

function stepLevel(dir) {
  const ids = app.levelIds;
  if (!ids.length || !app.currentLevelId) return;
  const i = ids.indexOf(app.currentLevelId);
  playLevel(ids[(i + dir + ids.length) % ids.length]);
}

function updateLevelNav() {
  const on = !!app.currentLevelId;
  $('level-nav').hidden = !on;
  $('btn-recal').textContent = on ? '📚 All levels' : '⚙ Setup';
  $('btn-levels').hidden = on;
  if (on) {
    const i = app.levelIds.indexOf(app.currentLevelId);
    $('level-name').textContent = `${app.currentLevelName || ''}  (${i + 1}/${app.levelIds.length})`;
    $('level-name').title = app.currentLevelName || '';
    $('btn-prev-level').disabled = $('btn-next-level').disabled = app.levelIds.length < 2;
  }
}

$('btn-library').addEventListener('click', () => { stopSource(); show('library'); });
$('btn-levels').addEventListener('click', blurAfter(() => { setMode('build'); stopSource(); app.currentLevelId = null; show('library'); }));
$('btn-prev-level').addEventListener('click', blurAfter(() => stepLevel(-1)));
$('btn-next-level').addEventListener('click', blurAfter(() => stepLevel(1)));
for (const id of ['scan-input', 'lib-file-input']) {
  document.querySelector(`label[for="${id}"]`).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(id).click(); }
  });
}

// --- Save level
$('btn-save').addEventListener('click', blurAfter(async () => {
  if (!app.source) return;
  if (app.mode === 'build') scan(true);
  const count = (await Library.listLevels(app.gameDef.id).catch(() => [])).length;
  $('save-name').value = app.currentLevelId ? (app.currentLevelName || '') : `Level ${count + 1}`;
  $('save-as-new').hidden = !app.currentLevelId;
  $('save-ok').textContent = app.currentLevelId ? 'Update' : 'Save';
  $('save-dialog').showModal();
  $('save-name').select();
}));
$('save-dialog').addEventListener('close', async () => {
  const how = $('save-dialog').returnValue;
  if (how !== 'save' && how !== 'new') return;
  const name = $('save-name').value.trim().slice(0, 80) || 'Untitled level';
  try {
    const level = await Library.saveLevel({
      id: how === 'save' ? app.currentLevelId : null,
      name, canvas: app.paperCanvas, start: app.start, game: app.gameDef.id,
    });
    if (app.currentLevelId) { app.currentLevelId = level.id; app.currentLevelName = level.name; }
    app.levelIds = (await Library.listLevels(app.gameDef.id)).map((l) => l.id);
    if (app.currentLevelId) updateLevelNav();
    toast(`Saved "${name}" to Class levels`);
  } catch (err) {
    toast('Could not save: ' + (err.message || 'storage blocked'), 4000);
  }
});

// --- Export / import library file
$('btn-export').addEventListener('click', async () => {
  const blob = await Library.exportLibrary();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `class-levels-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
$('lib-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { added, skipped } = await Library.importLibrary(file);
    toast(`Added ${added} level${added === 1 ? '' : 's'}${skipped ? ` (${skipped} already here)` : ''}`, 3000);
  } catch (err) {
    toast(err.message, 3500);
  }
  renderLibrary();
});

// --- Add scans (PDF or photos) with a review step
let importItems = [];
function drawThumb(item) {
  const c = item.el.querySelector('canvas');
  c.width = 300; c.height = 212;
  c.getContext('2d').drawImage(item.world, 0, 0, c.width, c.height);
}
function addImportItem(item) {
  const li = document.createElement('li');
  li.className = 'import-item';
  li.innerHTML = `
    <canvas></canvas>
    <input type="text" maxlength="80" aria-label="Level name">
    <span class="badge"></span>
    <div class="row">
      <button class="secondary rot" title="Turn the page">⟳ Turn</button>
      <label class="inc"><input type="checkbox" checked> Add</label>
    </div>`;
  item.el = li;
  li.querySelector('input[type="text"]').value = item.name;
  li.querySelector('input[type="text"]').addEventListener('input', (e) => { item.name = e.target.value; });
  li.querySelector('input[type="text"]').addEventListener('focus', (e) => e.target.select());
  const badge = li.querySelector('.badge');
  badge.textContent = item.marks ? 'Corner marks found ✓' : 'No corner marks: whole page used';
  badge.classList.toggle('warn', !item.marks);
  li.querySelector('.rot').addEventListener('click', () => {
    if (item.marks) item.world = rotateCanvas(item.world, 180);
    else { item.rot = (item.rot + 90) % 360; item.world = flattenPlain(rotateCanvas(item.source, item.rot)).canvas; }
    drawThumb(item);
  });
  li.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
    item.include = e.target.checked;
    li.classList.toggle('skip', !item.include);
    updateImportButton();
  });
  $('import-list').appendChild(li);
  drawThumb(item);
}
function updateImportButton() {
  const n = importItems.filter((i) => i.include).length;
  $('import-ok').disabled = !n;
  $('import-ok').textContent = `Add ${n} level${n === 1 ? '' : 's'}`;
}

$('scan-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  importItems = [];
  $('import-list').innerHTML = '';
  $('import-ok').disabled = true;
  $('import-status').textContent = 'Reading files…';
  $('import-dialog').showModal();
  const startCount = (await Library.listLevels(app.gameDef.id).catch(() => [])).length;
  try {
    await readFiles(files, async (canvas, label) => {
      const res = flattenPage(canvas);
      const item = {
        name: `Level ${startCount + importItems.length + 1}`,
        label, world: res.canvas, marks: res.marks, include: true,
        rot: canvas.height > canvas.width ? 90 : 0,
        source: res.marks ? null : shrink(canvas),
      };
      importItems.push(item);
      addImportItem(item);
      updateImportButton();
      await new Promise((r) => setTimeout(r, 0));   // keep the page responsive
    }, (msg) => { $('import-status').textContent = msg; });
    const found = importItems.filter((i) => i.marks).length;
    $('import-status').textContent = importItems.length
      ? `${importItems.length} page${importItems.length === 1 ? '' : 's'} read. ${found} cropped using the corner marks. Name each level (e.g. the student's name), turn any that are sideways, then add them.`
      : 'No pages found in those files.';
  } catch (err) {
    $('import-status').textContent = 'Could not read that file: ' + (err.message || err);
  }
});
$('import-cancel').addEventListener('click', () => { importItems = []; $('import-dialog').close(); });
$('import-ok').addEventListener('click', async () => {
  const items = importItems.filter((i) => i.include);
  $('import-ok').disabled = true;
  let n = 0;
  for (const it of items) {
    $('import-status').textContent = `Saving ${++n} of ${items.length}…`;
    await Library.saveLevel({ name: it.name.trim() || 'Untitled level', canvas: it.world, start: null, game: app.gameDef.id });
  }
  importItems = [];
  $('import-dialog').close();
  toast(`Added ${items.length} level${items.length === 1 ? '' : 's'} to Class levels`, 3000);
  renderLibrary();
});

// ---------------------------------------------------------------- input
function onKeyDown(e) {
  if (!isActive('play')) return;
  // Typing in a box (level names, etc.) must never control the game.
  const t = e.target;
  if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox')) return;
  if (document.querySelector('dialog[open]')) return;
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  input.keyDown(e.code);
  if (e.repeat) return;
  if (e.code === 'Enter') { e.preventDefault(); setMode(app.mode === 'play' ? 'build' : 'play'); }
  else if (e.code === 'Escape' && !$('fix-menu').hidden) hideFixMenu();
  else if (e.code === 'Escape' && app.fixing) setFixing(false);
  else if (e.code === 'Escape' && app.mode === 'play') setMode('build');
  else if (e.code === 'KeyR') restart();
  else if (e.code === 'KeyF' && e.view === window) toggleFullscreen();   // the projector window does its own
  else if (e.code === 'KeyC') toggleView();
  else if (e.code === 'KeyM') toggleSound();
  else if (e.code === 'KeyV' && app.mode === 'play' && !app.projMode) toggleZoom();
  else if (e.code === 'PageDown' && app.currentLevelId) { e.preventDefault(); stepLevel(1); }
  else if (e.code === 'PageUp' && app.currentLevelId) { e.preventDefault(); stepLevel(-1); }
}
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', (e) => input.keyUp(e.code));
window.addEventListener('blur', () => input.clear());

// ---------------------------------------------------------------- touch controls
const touch = new TouchControls({
  left: $('tz-left'), right: $('tz-right'), dpad: $('dpad'), thumb: $('dpad-thumb'), a: $('tb-a'), b: $('tb-b'),
});
const input = new Input(touch);
const padState = {};
const coarse = window.matchMedia('(pointer: coarse)');

function touchOn() {
  if (app.touchMode === 'on') return true;
  if (app.touchMode === 'off') return false;
  return coarse.matches || app.sawTouch;
}
function updateTouch() {
  const on = touchOn();
  if ($('play').classList.contains('touch-on') !== on) {
    $('play').classList.toggle('touch-on', on);
    touch.reset();
    if (isActive('play')) resizeGame();
  }
}
// Auto mode: the first touch on the game turns the on-screen controls on.
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' && !app.sawTouch) { app.sawTouch = true; updateTouch(); }
}, true);
coarse.addEventListener?.('change', updateTouch);
$('touch-mode').value = app.touchMode;
$('touch-mode').addEventListener('change', (e) => { app.touchMode = e.target.value; saveSettings(); updateTouch(); });
updateTouch();

// ---------------------------------------------------------------- menu (small screens)
function setMenu(open) {
  $('toolbar').classList.toggle('open', open);
  $('btn-menu').setAttribute('aria-expanded', String(open));
}
$('btn-menu').addEventListener('click', (e) => { e.stopPropagation(); setMenu(!$('toolbar').classList.contains('open')); });
// Using a tool closes the menu (except the Tune controls, which you adjust in place).
$('tools').addEventListener('click', (e) => {
  if (e.target.closest('.tune')) return;
  if (e.target.closest('button')) setMenu(false);
});
document.addEventListener('pointerdown', (e) => {
  if ($('toolbar').classList.contains('open') && !e.target.closest('#tools') && !e.target.closest('#btn-menu')) setMenu(false);
});

// ---------------------------------------------------------------- canvas
const gameCanvas = $('game-canvas');
const gameCtx = gameCanvas.getContext('2d');
let canvasScale = 1;

function resizeGame() {
  const stage = $('stage');
  const r = stage.getBoundingClientRect();
  let s = Math.min(r.width / WORLD_W, r.height / WORLD_H);
  let layout = '';
  if ($('play').classList.contains('touch-on') && app.mode === 'play') {
    // Size the controls to the screen, then fit the level beside them (landscape)
    // or above them (portrait), whichever leaves the level bigger.
    const short = Math.min(window.innerWidth, window.innerHeight);
    const dpadSize = Math.round(Math.max(120, Math.min(180, short * 0.3)));
    const btnSize = Math.round(dpadSize * 0.5);
    stage.style.setProperty('--dpad', `${dpadSize}px`);
    stage.style.setProperty('--btn', `${btnSize}px`);
    const side = dpadSize + 28;
    const sSide = Math.min((r.width - 2 * side) / WORLD_W, r.height / WORLD_H);
    const sBottom = Math.min(r.width / WORLD_W, (r.height - dpadSize - 32) / WORLD_H);
    if (sSide >= sBottom) { s = sSide; layout = 'touch-side'; } else { s = sBottom; layout = 'touch-bottom'; }
    s = Math.max(s, 0.1);
  }
  // Portrait: keep the level centred in the space above the controls.
  stage.style.paddingBottom = layout === 'touch-bottom' ? `${parseInt(stage.style.getPropertyValue('--dpad')) + 32}px` : '';
  stage.classList.toggle('touch-side', layout === 'touch-side');
  stage.classList.toggle('touch-bottom', layout === 'touch-bottom');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let w = WORLD_W * s, h = WORLD_H * s;
  app.zoomed = zoomActive();
  if (app.zoomed) {
    // Zoomed in: the view fills the whole stage, with the controls on top.
    w = Math.floor(r.width);
    h = Math.floor(r.height - (layout === 'touch-bottom' ? parseInt(stage.style.getPropertyValue('--dpad')) + 32 : 0));
    const fit = Math.min(w / WORLD_W, h / WORLD_H);
    app.zoomScale = Math.max(fit * ZOOM, w / WORLD_W, h / WORLD_H);
  }
  app.viewW = w;
  app.viewH = h;
  app.dpr = dpr;
  gameCanvas.style.width = `${w}px`;
  gameCanvas.style.height = `${h}px`;
  gameCanvas.width = Math.round(w * dpr);
  gameCanvas.height = Math.round(h * dpr);
  canvasScale = s * dpr;
  $('btn-zoom').setAttribute('aria-pressed', String(app.zoomed));
  if (app.zoomed) updateCamera(true);
}

// ---------------------------------------------------------------- zoomed view
// While playing, the view can zoom in and follow the character (not for the
// projector, where the picture has to line up with the paper).
const ZOOM = 2.2;   // how far in, compared with seeing the whole page
function zoomActive() {
  if (app.mode !== 'play' || !app.session?.focus || app.projMode) return false;
  return app.zoom === 'on' || (app.zoom === 'auto' && touchOn());
}
function toggleZoom() {
  app.zoom = app.zoomed ? 'off' : 'on';
  saveSettings();
  resizeGame();
  toast(app.zoomed ? 'Zoomed in 🔍' : 'Whole level', 1200);
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Follow the character, looking a little ahead of where they're running.
// Small hops don't move the view up and down; bigger climbs and falls do.
function updateCamera(snap = false) {
  const f = app.session?.focus?.();
  if (!f || !app.zoomed) return;
  const cam = app.cam;
  const visW = app.viewW / app.zoomScale, visH = app.viewH / app.zoomScale;
  const leadTarget = Math.abs(f.vx) > 0.5 ? Math.sign(f.vx) * visW * 0.14 : cam.lead;
  cam.lead = snap ? 0 : cam.lead + (leadTarget - cam.lead) * 0.04;
  const tx = f.x + cam.lead;
  const ty = f.y - visH * 0.06;
  if (snap) { cam.x = tx; cam.y = ty; }
  else {
    cam.x += (tx - cam.x) * 0.16;
    const dz = visH * 0.14, dy = ty - cam.y;
    if (Math.abs(dy) > dz) cam.y += (dy - Math.sign(dy) * dz) * 0.2;
  }
  cam.x = visW >= WORLD_W ? WORLD_W / 2 : clamp(cam.x, visW / 2, WORLD_W - visW / 2);
  cam.y = visH >= WORLD_H ? WORLD_H / 2 : clamp(cam.y, visH / 2, WORLD_H - visH / 2);
}
window.addEventListener('resize', () => { if (isActive('play')) resizeGame(); });
window.addEventListener('orientationchange', () => setTimeout(() => { if (isActive('play')) resizeGame(); }, 200));
document.addEventListener('fullscreenchange', () => setTimeout(resizeGame, 50));

// Click the paper (in build mode) to move the start flag.
gameCanvas.addEventListener('pointerdown', (e) => {
  if (app.mode !== 'build') return;
  const r = gameCanvas.getBoundingClientRect();
  if (app.fixing) {
    openFixMenu(((e.clientX - r.left) / r.width) * WORLD_W, ((e.clientY - r.top) / r.height) * WORLD_H, e.clientX, e.clientY);
    return;
  }
  if (!app.gameDef.usesStart) return;
  app.start = {
    x: Math.max(12, Math.min(WORLD_W - 12, ((e.clientX - r.left) / r.width) * WORLD_W)),
    y: Math.max(50, Math.min(WORLD_H - 4, ((e.clientY - r.top) / r.height) * WORLD_H)),
  };
  if (app.currentLevelId) Library.updateStart(app.currentLevelId, app.start).catch(() => {});
  else saveSetup();
});

// Hide the toolbar in fullscreen when the mouse is idle.
let idleTimer;
document.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
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
  const ses = app.session;
  if (!ses || ses.state !== kind) return;
  const card = ses.endCard();
  $('win-title').textContent = card.title;
  $('btn-again-label').textContent = card.retry;
  document.querySelector('.win-card').classList.toggle('over', !card.won);
  $('win-stats').textContent = card.stats;
  $('win').hidden = false;
}

// ---------------------------------------------------------------- drawing
function drawScene(now) {
  const ctx = gameCtx;
  const zoomed = app.zoomed && app.mode === 'play' && app.session;
  if (zoomed) {
    const d = app.dpr, z = app.zoomScale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    ctx.setTransform(d * z, 0, 0, d * z, d * (app.viewW / 2 - app.cam.x * z), d * (app.viewH / 2 - app.cam.y * z));
  } else {
    ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
  }
  ctx.imageSmoothingEnabled = true;
  // 1. The paper: the camera image, or a clean redraw of what was detected
  if (app.view === 'camera') {
    ctx.drawImage(app.paperCanvas, 0, 0, WORLD_W, WORLD_H);
  } else {
    ctx.fillStyle = '#fbfaf6';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.drawImage(app.cleanCanvas, 0, 0, WORLD_W, WORLD_H);
  }
  // Fix colours: tint everything the camera recognised, so mistakes stand out.
  if (app.fixing && app.view === 'camera') {
    ctx.globalAlpha = 0.6;
    ctx.drawImage(app.cleanCanvas, 0, 0, WORLD_W, WORLD_H);
    ctx.globalAlpha = 1;
  }
  // 2. The game
  if (app.mode === 'build' && app.det) {
    drawOutlines(ctx, app.det, usedColours());
    app.gameDef.drawBuild(ctx, { det: app.det, start: app.start, now });
  }
  if (app.mode === 'play' && app.session) app.session.draw(ctx, { det: app.det, now });
  app.effects.draw(ctx);
  if (zoomed) {
    // Status panel and mini-map stay put on the screen, at a readable size.
    const hs = app.dpr * clamp(app.viewH / 520, 0.6, 1);
    ctx.setTransform(hs, 0, 0, hs, 0, 0);
    drawHud(ctx, app.session.hud());
    drawMiniMap(ctx);
  } else if (app.mode === 'play' && app.session) drawHud(ctx, app.session.hud());
}

// A small picture of the whole level, so you can still see where the goal is.
function drawMiniMap(ctx) {
  const d = app.dpr;
  const w = Math.round(clamp(app.viewW * 0.2, 90, 170)), h = Math.round(w * WORLD_H / WORLD_W);
  const x = app.viewW - w - 10, y = 10;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(x, y, w, h);
  ctx.drawImage(app.view === 'camera' ? app.paperCanvas : app.cleanCanvas, x, y, w, h);
  ctx.globalAlpha = 1;
  const k = w / WORLD_W;
  const visW = app.viewW / app.zoomScale, visH = app.viewH / app.zoomScale;
  ctx.strokeStyle = 'rgba(25,195,255,0.95)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + (app.cam.x - visW / 2) * k, y + (app.cam.y - visH / 2) * k, Math.min(w, visW * k), Math.min(h, visH * k));
  const f = app.session.focus();
  ctx.fillStyle = '#e0157f';
  ctx.beginPath();
  ctx.arc(x + f.x * k, y + f.y * k, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

// ---------------------------------------------------------------- projector mode
// The game is projected onto the whiteboard, on top of the drawing. The main
// screen works as usual (setup, camera view, Fix colours); a second window,
// shown by the projector, draws only the moving parts on black, so the ink on
// the board stays the level.
const projector = new Projector({ worldW: WORLD_W, worldH: WORLD_H, onState: updateProjectorUI });

function setProjMode(on) {
  app.projMode = on;
  $('step-projector').hidden = !on;
  $('step-corners').hidden = on;
  $('camera-hint').textContent = on
    ? 'Point the camera at the whiteboard so it sees the whole projected picture. A slight angle is fine.'
    : 'Point the camera straight down at the paper or whiteboard. Even light, no lamp right above.';
  $('setup-canvas').setAttribute('aria-label', on
    ? 'Camera preview. The blue outline shows the part of the board the game uses.'
    : 'Camera preview. Click the four corners of the paper.');
  if (!on) projector.close();
  updateFreezeButtons();
  updateProjectorUI();
}
function projStatus(msg, kind = '') {
  const el = $('proj-status');
  el.className = 'status ' + kind;
  el.textContent = msg;
}
let lastProjSig = '';
function updateProjectorUI() {
  if (!app.projMode) return;
  const open = projector.open;
  $('btn-proj-open').textContent = open ? '📽️ Show projector window' : '📽️ Open projector window';
  $('btn-proj-lineup').disabled = !open || app.source?.kind !== 'webcam' || app.lining;
  // Tell the teacher once each time something changes that matters.
  const sig = `${open}|${projector.fullscreen}|${projector.stale}`;
  if (sig === lastProjSig) return;
  lastProjSig = sig;
  if (app.lining) return;
  if (!open) projStatus(projector.cal ? 'The projector window was closed. Open it again, then Line up.' : '');
  else if (projector.stale) {
    projStatus('The projector window changed size. Press Line up again.', 'warn');
    if (isActive('play')) toast('The projector window changed size. Press ⚙ Setup and Line up again.', 3500);
  } else if (!projector.cal) projStatus(projector.fullscreen
    ? 'Projector window is full screen ✓ Now press Line up.'
    : 'Projector window open. Drag it onto the projector, click it to fill the screen, then press Line up.');
}

$('btn-projector').addEventListener('click', async () => {
  setProjMode(true);
  show('setup');
  $('step-camera').hidden = false;
  $('camera-select').closest('.field').hidden = false;
  $('btn-lock').hidden = false;
  // A line-up from earlier still holds if nothing has moved since.
  if (!projector.cal || projector.stale || !projector.open) setCorners([]);
  await startWebcam();
  updateProjectorUI();
});

$('btn-proj-open').addEventListener('click', () => {
  if (!projector.openWindow()) projStatus('The browser blocked the projector window. Allow pop-ups for this site, then try again.', 'warn');
});

$('btn-proj-lineup').addEventListener('click', async () => {
  if (!projector.open || app.lining) return;
  if (app.source?.frozen) { app.source.unfreeze(); updateFreezeButtons(); }
  app.lining = true;
  setCorners([]);
  updateProjectorUI();
  const res = await projector.lineUp(() => app.source.capture(), (m) => projStatus(m));
  app.lining = false;
  lastProjSig = '';
  if (res.ok) {
    setCorners(res.corners);
    useCorners();
  }
  updateProjectorUI();
  projStatus(res.msg, res.ok ? 'ok' : 'warn');
});

// What the projector shows, in level coordinates.
function drawProjected(ctx, now) {
  const ses = app.mode === 'play' ? app.session : null;
  if (!ses) {
    // Building: just the edges of the play area, so nothing coloured is
    // projected onto the drawing while the camera is reading it.
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
    ctx.strokeStyle = '#bbb';
    ctx.lineWidth = 5;
    const k = 46;
    for (const [x, y, dx, dy] of [[0, 0, 1, 1], [WORLD_W, 0, -1, 1], [WORLD_W, WORLD_H, -1, -1], [0, WORLD_H, 1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * k, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * k);
      ctx.stroke();
    }
    return;
  }
  ses.draw(ctx, { det: app.det, now });
  app.effects.draw(ctx);
  drawHud(ctx, ses.hud());
  if (ses.state === 'won' || ses.state === 'over') {
    const card = ses.endCard();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#000';
    ctx.strokeText(card.title, WORLD_W / 2, WORLD_H / 2);
    ctx.fillStyle = card.won ? '#ffd23f' : '#ff5a5a';
    ctx.fillText(card.title, WORLD_W / 2, WORLD_H / 2);
    ctx.restore();
  }
}

// The projector window talks to this window through these.
window.paperArcade = {
  projectorReady(win, canvas) { projector.attach(win, canvas); },
  tick,
  keyDown(e) {
    if (e.code === 'KeyF' && !e.repeat) {
      const d = projector.win?.document;
      if (d) (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen?.())?.catch?.(() => {});
    }
    onKeyDown(e);
  },
  keyUp(e) { input.keyUp(e.code); },
  clearKeys() { input.clear(); },
};
window.addEventListener('pagehide', () => projector.close());

// ---------------------------------------------------------------- main loop
let last = performance.now();
let acc = 0;
// One step of everything. Runs from this window's animation frames and from the
// projector window's, so the game keeps going if either one is covered up.
function tick() {
  const now = performance.now();
  if (now - last < 4) return;
  const dt = Math.min(100, now - last);
  last = now;
  if (app.source?.sizeChanged) cameraTurned();
  if (isActive('setup')) drawSetup();
  if (isActive('play') && app.source) {
    if (app.mode === 'build') scan();
    const pad = padButtonsPressed(padState);
    if (pad.start) setMode(app.mode === 'play' ? 'build' : 'play');
    if (pad.restart) restart();
    acc += dt;
    while (acc >= STEP_MS) {
      acc -= STEP_MS;
      const inp = input.read();
      const ses = app.session;
      if (ses) {
        const before = ses.state;
        ses.update(inp, app.effects, app.sfx);
        const after = ses.state;
        if (before !== after && (after === 'won' || after === 'over')) setTimeout(() => showEnd(after), after === 'won' ? 900 : 1100);
        // A (or up) on the end screen = play again
        if (!$('win').hidden && (inp.aPressed || inp.upPressed)) restart();
      }
      app.effects.update();
      updateCamera();
    }
    drawScene(now);
  }
  if (app.projMode) projector.render((ctx) => drawProjected(ctx, now));
}
function frame() {
  tick();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
updateFixPanel();

// For debugging in the browser console.
window.gameApp = app;
window.gameProjector = projector;
