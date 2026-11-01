export const pad2 = (n) => String(n).padStart(2, '0');

/** 754.25 -> "12:34" (or "12:34.2" with tenths) / "1:02:34" */
export function fmtClock(sec, tenths = false) {
  if (!Number.isFinite(sec)) return '–';
  const neg = sec < 0;
  sec = Math.abs(sec);
  const total = tenths ? Math.round(sec * 10) / 10 : Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sStr = tenths ? s.toFixed(1).padStart(4, '0') : pad2(Math.floor(s));
  return (neg ? '-' : '') + (h ? `${h}:${pad2(m)}:${sStr}` : `${m}:${sStr}`);
}

/** "1:02:03.5" | "12:34" | "95" -> seconds, or NaN */
export function parseClock(str) {
  const parts = String(str).trim().split(':');
  if (!parts.length || parts.length > 3) return NaN;
  let total = 0;
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return NaN;
    total = total * 60 + Number(p);
  }
  return total;
}

export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function prettyDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3200);
}

export function modal(html, onMount) {
  const dlg = $('#modal');
  dlg.querySelector('.modal-body').innerHTML = html;
  dlg.showModal();
  dlg.onclick = (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  };
  onMount?.(dlg);
  return dlg;
}

export function confirmModal(title, body, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    const dlg = modal(`
      <h2>${esc(title)}</h2>
      <p class="muted">${esc(body)}</p>
      <div class="btn-row" style="justify-content:flex-end">
        <button class="btn" data-close>Cancel</button>
        <button class="btn ${danger ? 'primary' : 'primary'}" data-ok>${esc(okLabel)}</button>
      </div>`);
    let ok = false;
    dlg.querySelector('[data-ok]').onclick = () => { ok = true; dlg.close(); };
    dlg.addEventListener('close', () => resolve(ok), { once: true });
  });
}

export const STATUS = {
  queued: { label: 'Queued', cls: 'busy' },
  analyzing: { label: 'Finding songs', cls: 'busy' },
  review: { label: 'Ready to review', cls: 'review' },
  cutting: { label: 'Saving files', cls: 'busy' },
  saved: { label: 'Saved', cls: 'ok' },
  uploading: { label: 'Uploading', cls: 'busy' },
  done: { label: 'Published', cls: 'ok' },
  error: { label: 'Needs attention', cls: 'err' },
};
export const statusPill = (status) => {
  const s = STATUS[status] || { label: status, cls: '' };
  return `<span class="pill ${s.cls}">${esc(s.label)}</span>`;
};

export const icons = {
  play: '<svg viewBox="0 0 24 24" class="ico"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" class="ico"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
  playLine: '<svg viewBox="0 0 24 24" class="ico"><path d="M8 5.5v13l10-6.5z"/></svg>',
  x: '<svg viewBox="0 0 24 24" class="ico"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  upload: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  folder: '<svg viewBox="0 0 24 24" class="ico"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M5 12h14"/></svg>',
  split: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4"/></svg>',
  merge: '<svg viewBox="0 0 24 24" class="ico"><path d="M4 12h16M9 7l-5 5 5 5M15 7l5 5-5 5"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24" class="ico"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24" class="ico"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8 11h6"/></svg>',
  fit: '<svg viewBox="0 0 24 24" class="ico"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/></svg>',
  music: '<svg viewBox="0 0 24 24" class="ico"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" class="ico"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/></svg>',
  ext: '<svg viewBox="0 0 24 24" class="ico"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  retry: '<svg viewBox="0 0 24 24" class="ico"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" class="ico"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};
