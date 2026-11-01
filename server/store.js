import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, SESSIONS_DIR, DEFAULT_OUTPUT_DIR } from './config.js';
import { DEFAULT_DETECTION } from './segment.js';
import { isValidId } from './util.js';

const BANDS_FILE = path.join(DATA_DIR, 'bands.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/* ---------------- Bands ---------------- */

export function listBands() {
  return readJson(BANDS_FILE, []).sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || ''));
}

export function saveBand(name) {
  const clean = String(name || '').trim().slice(0, 100);
  if (!clean) return listBands();
  const bands = readJson(BANDS_FILE, []);
  const existing = bands.find((b) => b.name.toLowerCase() === clean.toLowerCase());
  const now = new Date().toISOString();
  if (existing) existing.lastUsed = now;
  else bands.push({ name: clean, lastUsed: now });
  writeJson(BANDS_FILE, bands);
  return listBands();
}

export function touchBand(name) {
  const bands = readJson(BANDS_FILE, []);
  const b = bands.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (b) {
    b.lastUsed = new Date().toISOString();
    writeJson(BANDS_FILE, bands);
  }
}

export function deleteBand(name) {
  const bands = readJson(BANDS_FILE, []).filter((b) => b.name !== name);
  writeJson(BANDS_FILE, bands);
  return listBands();
}

/* ---------------- Settings ---------------- */

const DEFAULT_SETTINGS = {
  outputDir: DEFAULT_OUTPUT_DIR,
  defaultMode: 'review',
  detection: DEFAULT_DETECTION,
};

export function getSettings() {
  const saved = readJson(SETTINGS_FILE, {});
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    detection: { ...DEFAULT_DETECTION, ...(saved.detection || {}) },
  };
}

export function updateSettings(patch) {
  const current = getSettings();
  const next = { ...current };
  if (typeof patch.outputDir === 'string' && patch.outputDir.trim()) {
    next.outputDir = patch.outputDir.trim().replace(/^~(?=\/|$)/, process.env.HOME || '~');
  }
  if (patch.defaultMode === 'auto' || patch.defaultMode === 'review') next.defaultMode = patch.defaultMode;
  if (patch.detection && typeof patch.detection === 'object') {
    next.detection = sanitizeDetection({ ...current.detection, ...patch.detection });
  }
  writeJson(SETTINGS_FILE, next);
  return next;
}

export function sanitizeDetection(d) {
  const num = (v, lo, hi, def) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  return {
    sensitivity: num(d.sensitivity, -12, 12, DEFAULT_DETECTION.sensitivity),
    minSongSec: num(d.minSongSec, 5, 900, DEFAULT_DETECTION.minSongSec),
    mergeGapSec: num(d.mergeGapSec, 0, 120, DEFAULT_DETECTION.mergeGapSec),
    padStartSec: num(d.padStartSec, 0, 30, DEFAULT_DETECTION.padStartSec),
    padEndSec: num(d.padEndSec, 0, 30, DEFAULT_DETECTION.padEndSec),
    smoothSec: num(d.smoothSec, 1, 31, DEFAULT_DETECTION.smoothSec),
  };
}

/* ---------------- Sessions ---------------- */

const cache = new Map();

export const sessionDir = (id) => {
  if (!isValidId(id)) throw new Error('Invalid session id');
  return path.join(SESSIONS_DIR, id);
};
const sessionFile = (id) => path.join(sessionDir(id), 'session.json');
export const featuresFile = (id) => path.join(sessionDir(id), 'features.json');
export const previewFile = (id) => path.join(sessionDir(id), 'preview.mp3');

export function loadAllSessions() {
  for (const id of fs.readdirSync(SESSIONS_DIR)) {
    if (!isValidId(id)) continue;
    const s = readJson(path.join(SESSIONS_DIR, id, 'session.json'), null);
    if (!s) continue;
    // Anything that was mid-flight when the server stopped is now interrupted.
    if (['queued', 'analyzing', 'cutting', 'uploading'].includes(s.status)) {
      s.error = { stage: s.status, message: 'Interrupted because the app was restarted. Press Retry.' };
      s.status = 'error';
      s.progress = null;
      writeJson(path.join(SESSIONS_DIR, id, 'session.json'), s);
    }
    cache.set(id, s);
  }
}

export function getSession(id) {
  if (!isValidId(id)) return null;
  return cache.get(id) || null;
}

export function listSessions() {
  return [...cache.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((s) => ({
      id: s.id,
      band: s.band,
      date: s.date,
      status: s.status,
      createdAt: s.createdAt,
      songCount: (s.segments || []).filter((x) => x.include).length,
      duration: s.source?.duration || 0,
      originalName: s.source?.originalName,
      playlistUrl: s.soundcloud?.playlist?.shareUrl || null,
    }));
}

export function createSession(session) {
  fs.mkdirSync(sessionDir(session.id), { recursive: true });
  cache.set(session.id, session);
  persist(session.id);
  return session;
}

/** Mutate a session via callback, then persist. Returns the updated session. */
export function updateSession(id, fn) {
  const s = cache.get(id);
  if (!s) throw new Error(`Session ${id} not found`);
  fn(s);
  s.updatedAt = new Date().toISOString();
  persist(id);
  return s;
}

function persist(id) {
  writeJson(sessionFile(id), cache.get(id));
}

export function deleteSession(id) {
  const dir = sessionDir(id);
  cache.delete(id);
  fs.rmSync(dir, { recursive: true, force: true });
}
