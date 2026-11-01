import os from 'node:os';
import crypto from 'node:crypto';

export const pad2 = (n) => String(n).padStart(2, '0');

/** 754.2 -> "12:34" or "1:02:34" */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}

/** Filename-safe timestamp: 754 -> "12m34s", 3754 -> "1h02m34s" */
export function fmtStamp(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}h${pad2(m)}m${pad2(r)}s` : `${m}m${pad2(r)}s`;
}

/** Make a string safe for use as a file or folder name on macOS/Windows. */
export function safeName(str, fallback = 'Untitled') {
  const cleaned = String(str ?? '')
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

export function newId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

export const isValidId = (id) => typeof id === 'string' && /^[a-z0-9-]{6,64}$/i.test(id);

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // Prefer typical home-network ranges first.
  return out.sort((a, b) => score(b) - score(a));
  function score(ip) {
    if (ip.startsWith('192.168.')) return 3;
    if (ip.startsWith('10.')) return 2;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
    return 0;
  }
}

export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
