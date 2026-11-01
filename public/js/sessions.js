import { api } from './api.js';
import { $, confirmModal, esc, fmtClock, icons, prettyDate, statusPill, timeAgo, toast } from './util.js';

export function sessionRows(list, { deletable = false } = {}) {
  if (!list.length) {
    return `<div class="empty">No sessions yet. Your imported practices will show up here.</div>`;
  }
  return `<div class="session-list">${list
    .map(
      (s) => `
      <a class="session-item" href="#/session/${esc(s.id)}">
        <span class="si-title">${esc(s.band)} <span class="muted" style="font-weight:500">· ${esc(prettyDate(s.date))}</span></span>
        <span class="btn-row" style="gap:6px">${statusPill(s.status)}${
          deletable ? `<button class="btn ghost sm icon-only" data-del="${esc(s.id)}" title="Delete session">${icons.trash}</button>` : ''
        }</span>
        <span class="si-meta">${s.songCount ? `${s.songCount} song${s.songCount === 1 ? '' : 's'} · ` : ''}${
          s.duration ? `${fmtClock(s.duration)} recording · ` : ''
        }${esc(s.originalName || '')} · imported ${esc(timeAgo(s.createdAt))}</span>
      </a>`,
    )
    .join('')}</div>`;
}

export async function renderSessions(root) {
  const draw = async () => {
    const list = await api.sessions();
    root.innerHTML = `
      <div class="page-title">
        <h1>Sessions</h1>
        <p class="muted">Every practice you've imported. Deleting a session removes Mix Cutter's working copy only. Saved song folders and SoundCloud uploads are kept.</p>
      </div>
      <div class="card">${sessionRows(list, { deletable: true })}</div>`;
  };
  await draw();
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    e.preventDefault();
    const ok = await confirmModal('Delete this session?', 'The original upload and analysis are removed from Mix Cutter. Saved songs in your Music folder and on SoundCloud are not touched.', 'Delete');
    if (!ok) return;
    try {
      await api.deleteSession(btn.dataset.del);
      toast('Session deleted');
      await draw();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}
