import { api } from './api.js';
import { renderImport } from './import.js';
import { renderSession } from './session.js';
import { renderSessions } from './sessions.js';
import { renderSettings } from './settings.js';
import { $, $$, esc, modal, toast } from './util.js';

const ctx = {
  info: null,
  async refreshInfo() {
    ctx.info = await api.info();
    updateScPill();
    return ctx.info;
  },
};

function updateScPill() {
  const sc = ctx.info?.soundcloud;
  const pill = $('#scPill');
  if (!sc || !pill) return;
  pill.classList.toggle('connected', sc.connected && !sc.dryRun);
  pill.classList.toggle('dry', Boolean(sc.dryRun));
  const label = sc.dryRun ? 'SoundCloud (dry run)' : sc.connected ? `SoundCloud · ${sc.username || 'connected'}` : 'Connect SoundCloud';
  $('.sc-label', pill).textContent = label;
  pill.title = label;
}

let cleanup = null;
let routeToken = 0;

async function route() {
  const token = ++routeToken;
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = null;

  const hash = location.hash.slice(1) || '/';
  const [pathPart, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const parts = pathPart.split('/').filter(Boolean);
  const name = parts[0] || 'home';

  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));

  // Each view gets a fresh element so its event listeners die with it.
  const view = $('#view');
  const root = document.createElement('div');
  view.replaceChildren(root);
  window.scrollTo(0, 0);

  try {
    if (!ctx.info) await ctx.refreshInfo();
    let result;
    if (name === 'home') result = await renderImport(root, ctx);
    else if (name === 'sessions') result = await renderSessions(root, ctx);
    else if (name === 'session' && parts[1]) result = await renderSession(root, parts[1], ctx);
    else if (name === 'settings') result = await renderSettings(root, ctx, params);
    else root.innerHTML = `<div class="empty">Page not found. <a href="#/">Go home</a></div>`;
    if (token !== routeToken) { result?.(); return; }
    cleanup = typeof result === 'function' ? result : null;
  } catch (err) {
    if (token !== routeToken) return;
    root.innerHTML = `<div class="card card-pad stack"><h2>Something went wrong</h2><p class="muted">${esc(err.message)}</p><div><a class="btn" href="#/">Back to start</a></div></div>`;
  }
}

$('#phoneBtn').addEventListener('click', async () => {
  const info = await ctx.refreshInfo();
  const url = info.lanUrls[0];
  if (!url) {
    modal(`
      <h2>Upload from your phone</h2>
      <p class="muted">Phone uploads aren't available right now. Make sure this computer is on Wi-Fi and Mix Cutter runs with <span class="mono">HOST=0.0.0.0</span> (the default).</p>
      <div class="btn-row" style="justify-content:flex-end"><button class="btn" data-close>Close</button></div>`);
    return;
  }
  const svg = await fetch(`/api/qr?url=${encodeURIComponent(url)}`).then((r) => r.text());
  modal(`
    <h2>Upload from your phone</h2>
    <p class="muted">Scan with your phone's camera. Your phone must be on the <strong>same Wi-Fi</strong> as this computer. Recordings go straight to this desktop.</p>
    <div class="qr">${svg}</div>
    <p style="text-align:center"><span class="mono">${esc(url)}</span></p>
    ${info.lanUrls.length > 1 ? `<p class="subtle">Other addresses: ${info.lanUrls.slice(1).map((u) => `<span class="mono">${esc(u)}</span>`).join(', ')}</p>` : ''}
    <div class="btn-row" style="justify-content:flex-end"><button class="btn" data-close>Done</button></div>`);
});

window.addEventListener('hashchange', route);
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || String(e.reason), 'err'));
route();
