// Class level library, stored in the browser on this computer (IndexedDB).
// Each level is the flattened drawing (a JPEG of the paper) plus its start flag,
// so it replays with the real drawing visible and the current colour settings.

const DB_NAME = 'paper-platformer';
const STORE = 'levels';
const THUMB_W = 320;

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage was blocked'));
  }));
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function canvasToDataURL(canvas, w, quality = 0.85) {
  if (!w || canvas.width <= w) return canvas.toDataURL('image/jpeg', quality);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round((canvas.height / canvas.width) * w);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

// Save a flattened paper canvas (world size) as a new level, or update one.
export async function saveLevel({ id, name, canvas, start }) {
  const existing = id ? await getLevel(id) : null;
  const level = {
    id: existing ? existing.id : newId(),
    name: name || 'Untitled level',
    created: existing ? existing.created : Date.now(),
    updated: Date.now(),
    start: start ? { x: Math.round(start.x), y: Math.round(start.y) } : null,
    image: canvasToDataURL(canvas),
    thumb: canvasToDataURL(canvas, THUMB_W, 0.75),
  };
  await tx('readwrite', (s) => s.put(level));
  return level;
}

export const getLevel = (id) => tx('readonly', (s) => reqP(s.get(id)));

export async function listLevels() {
  const all = await tx('readonly', (s) => reqP(s.getAll()));
  return all.sort((a, b) => a.created - b.created);
}

export async function renameLevel(id, name) {
  const l = await getLevel(id);
  if (!l) return;
  l.name = name;
  l.updated = Date.now();
  await tx('readwrite', (s) => s.put(l));
}

export async function updateStart(id, start) {
  const l = await getLevel(id);
  if (!l) return;
  l.start = { x: Math.round(start.x), y: Math.round(start.y) };
  await tx('readwrite', (s) => s.put(l));
}

export const deleteLevel = (id) => tx('readwrite', (s) => s.delete(id));

// ---- export / import as a single file (to share via Drive, Classroom, USB…)

export async function exportLibrary() {
  const levels = await listLevels();
  const data = { app: 'paper-platformer', kind: 'level-library', version: 1, exported: new Date().toISOString(), levels };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function importLibrary(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not a level library.'); }
  if (!data || data.app !== 'paper-platformer' || !Array.isArray(data.levels)) throw new Error('That file is not a level library.');
  const have = new Set((await listLevels()).map((l) => l.id));
  let added = 0, skipped = 0;
  await tx('readwrite', (s) => {
    for (const l of data.levels) {
      if (!l || typeof l.image !== 'string' || !l.image.startsWith('data:image/')) { skipped++; continue; }
      if (have.has(l.id)) { skipped++; continue; }
      s.put({
        id: typeof l.id === 'string' ? l.id : newId(),
        name: String(l.name || 'Untitled level').slice(0, 80),
        created: Number(l.created) || Date.now(),
        updated: Date.now(),
        start: l.start && Number.isFinite(l.start.x) ? { x: l.start.x, y: l.start.y } : null,
        image: l.image,
        thumb: typeof l.thumb === 'string' && l.thumb.startsWith('data:image/') ? l.thumb : l.image,
      });
      added++;
    }
  });
  return { added, skipped };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}
