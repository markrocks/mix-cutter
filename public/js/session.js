import { api } from './api.js';
import { Waveform } from './waveform.js';
import {
  $, $$, confirmModal, esc, fmtClock, icons, modal, parseClock, prettyDate, statusPill, toast, todayLocal,
} from './util.js';

const BUSY = ['queued', 'analyzing', 'cutting', 'uploading'];

export async function renderSession(root, id, ctx) {
  let s = await api.session(id);
  let wf = null;
  let audio = null;
  let segs = [];
  let selectedId = null;
  let edited = false;
  let saveTimer = null;
  let savePromise = null;
  let pollTimer = null;
  let stopAt = null;
  let rafId = null;
  let destroyed = false;
  const memo = {};

  root.innerHTML = `
    <div id="sHead"></div>
    <ol class="stepper" id="stepper"></ol>
    <div class="stack-lg">
      <div id="slotProgress"></div>
      <div id="slotBanner"></div>
      <div id="slotPublish"></div>
      <div id="slotEditor"></div>
    </div>`;

  const busy = () => BUSY.includes(s.status) || s.busy;
  const analyzed = () =>
    !['queued', 'analyzing'].includes(s.status) && !(s.status === 'error' && ['queued', 'analyzing'].includes(s.error?.stage));

  /** Only touch the DOM when a slot's HTML actually changes. */
  function put(slotId, html) {
    if (memo[slotId] === html) return false;
    memo[slotId] = html;
    $(`#${slotId}`, root).innerHTML = html;
    return true;
  }

  /* ---------------- polling ---------------- */
  async function refresh() {
    if (destroyed) return;
    try {
      s = await api.session(id);
      await ctx.refreshInfo();
    } catch (err) {
      toast(err.message, 'err');
    }
    apply();
  }

  function apply() {
    if (destroyed) return;
    renderHead();
    renderStepper();
    renderProgress();
    renderBanner();
    renderPublish();
    ensureEditor();
    clearTimeout(pollTimer);
    if (busy()) pollTimer = setTimeout(refresh, 1000);
  }

  /* ---------------- header ---------------- */
  function renderHead() {
    put('sHead', `
      <a class="back" href="#/">← New import</a>
      <div class="session-head">
        <div>
          <h1>${esc(s.band)}</h1>
          <div class="meta">
            <span>${esc(prettyDate(s.date))}</span>
            <span>${esc(s.source.originalName)}</span>
            ${s.source.duration ? `<span>${fmtClock(s.source.duration)} long</span>` : ''}
            <span>${s.mode === 'auto' ? 'Automatic mode' : 'Review mode'}</span>
          </div>
          ${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ''}
        </div>
        <div class="btn-row">
          ${statusPill(s.status)}
          <button class="btn sm" data-act="edit-details" ${busy() ? 'disabled' : ''}>Edit details</button>
        </div>
      </div>`);
  }

  function renderStepper() {
    const st = s.status;
    const errStage = st === 'error' ? s.error?.stage : null;
    const cutActive = ['queued', 'analyzing', 'review', 'cutting'].includes(st) || ['queued', 'analyzing', 'cutting'].includes(errStage);
    const pubActive = ['saved', 'uploading'].includes(st) || errStage === 'uploading';
    const cutSub = { queued: 'Waiting…', analyzing: 'Finding songs…', review: 'Review the cuts', cutting: 'Saving files…' }[st]
      || (s.output ? `${s.output.files.length} songs saved` : errStage && cutActive ? 'Needs attention' : '');
    const pubSub = st === 'done' ? 'Shared on SoundCloud' : st === 'uploading' ? 'Uploading…' : pubActive ? 'Ready to upload' : 'SoundCloud';
    put('stepper', `
      <li class="done">Import<small>${esc(s.source.originalName)}</small></li>
      <li class="${s.output ? 'done' : cutActive ? 'active' : ''}">Cut up songs<small>${esc(cutSub)}</small></li>
      <li class="${st === 'done' ? 'done' : pubActive ? 'active' : ''}">Publish<small>${esc(pubSub)}</small></li>`);
  }

  /* ---------------- progress / banners ---------------- */
  function renderProgress() {
    if (!busy()) return put('slotProgress', '');
    const pct = s.progress?.pct ?? 0;
    const title = { queued: 'Getting ready…', analyzing: 'Finding the songs…', cutting: 'Saving songs…', uploading: 'Uploading to SoundCloud…' }[s.status] || 'Working…';
    const modeSwitch = ['queued', 'analyzing'].includes(s.status)
      ? `<div class="btn-row subtle">When it's done:
          <button class="btn sm ${s.mode === 'review' ? 'primary' : ''}" data-act="mode" data-mode="review">Stop for review</button>
          <button class="btn sm ${s.mode === 'auto' ? 'primary' : ''}" data-act="mode" data-mode="auto">Save &amp; upload automatically</button>
        </div>`
      : '';
    const changed = put('slotProgress', `
      <div class="card card-pad stack">
        <div class="btn-row" style="justify-content:space-between"><h2>${title}</h2><span class="mono muted" data-pct>${pct}%</span></div>
        <div class="progress"><div data-bar style="width:${pct}%"></div></div>
        <p class="muted" data-msg>${esc(s.progress?.message || '')}</p>
        ${modeSwitch}
        <p class="subtle">You can leave this page. Mix Cutter keeps working in the background.</p>
      </div>`);
    void changed;
  }

  function renderBanner() {
    let html = '';
    if (s.status === 'error') {
      html = `<div class="banner err"><span class="grow"><strong>Something went wrong${s.error?.stage ? ` while ${stageWord(s.error.stage)}` : ''}.</strong> ${esc(s.error?.message || '')}</span>
        <button class="btn sm" data-act="retry">${icons.retry} Retry</button></div>`;
    } else if (s.notice) {
      html = `<div class="banner"><span class="grow">${esc(s.notice)}</span></div>`;
    } else if (s.status === 'review' && analyzed() && !s.segments.length && !segs.length) {
      html = `<div class="banner"><span class="grow"><strong>No songs detected.</strong> Try moving <em>Detection sensitivity</em> toward "More songs" below, or add songs by hand at the playhead.</span></div>`;
    } else if (s.output && s.segmentsEditedAt && s.segmentsEditedAt > s.output.savedAt && !busy()) {
      html = `<div class="banner"><span class="grow">You've changed the songs since they were saved. <strong>Save again</strong> to update the files${s.soundcloud ? ' (you will need to upload again)' : ''}.</span></div>`;
    }
    put('slotBanner', html);
  }

  /* ---------------- publish card ---------------- */
  function renderPublish() {
    if (!s.output) return put('slotPublish', '');
    const sc = ctx.info.soundcloud;
    const tracks = s.soundcloud?.tracks || [];
    const files = s.output.files;
    const rows = files.map((f) => {
      const t = tracks.find((x) => x.file === f.file);
      const state = !t ? '' : t.status === 'done'
        ? `<a class="state done" href="${esc(t.shareUrl || t.permalink_url)}" target="_blank" rel="noopener">On SoundCloud ↗</a>`
        : t.status === 'error' ? `<span class="state error" title="${esc(t.error || '')}">Failed</span>`
        : t.status === 'uploading' ? `<span class="state uploading">Uploading…</span>`
        : `<span class="state">Waiting</span>`;
      return `<div class="file-row"><span class="num">${String(f.n).padStart(2, '0')}</span>
        <span class="fname" title="${esc(f.file)}">${esc(f.label)} <span class="subtle">· starts ${fmtClock(f.start)}</span></span>
        <span class="mono subtle">${fmtClock(f.end - f.start)}</span>${state || '<span></span>'}</div>`;
    }).join('');

    let scHtml = '';
    const pl = s.soundcloud?.playlist;
    if (s.status === 'done' && pl) {
      const url = pl.shareUrl || pl.permalink_url;
      scHtml = `
        <div class="stack" style="gap:8px">
          <h3>Share with the band</h3>
          <div class="share-box">
            <input type="text" readonly value="${esc(url)}" data-share />
            <button class="btn sm" data-act="copy">${icons.copy} Copy</button>
            <a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">${icons.ext} Open</a>
          </div>
          <p class="subtle">This is a private playlist. Only people with the link can listen.${sc.dryRun ? ' <strong>(Dry run: nothing was really uploaded.)</strong>' : ''}</p>
        </div>`;
    } else if (s.status === 'uploading') {
      scHtml = '';
    } else if (sc.connected) {
      const failed = s.status === 'error' && s.error?.stage === 'uploading';
      scHtml = `
        <div class="btn-row" style="justify-content:space-between">
          <p class="subtle">Uploads ${files.length} private tracks and groups them into a private playlist, <strong>${esc(s.band)} - Practice ${esc(s.date)}</strong>.</p>
          <button class="btn primary" data-act="upload" ${busy() ? 'disabled' : ''}>${icons.upload} ${failed ? 'Resume upload' : `Upload ${files.length} song${files.length === 1 ? '' : 's'} to SoundCloud`}</button>
        </div>`;
    } else if (sc.configured) {
      scHtml = `<div class="btn-row" style="justify-content:space-between">
          <p class="subtle">Connect your SoundCloud account to publish these songs for the band.</p>
          <a class="btn primary" href="/auth/soundcloud">Connect SoundCloud</a></div>`;
    } else {
      scHtml = `<p class="subtle">To publish to SoundCloud, add your SoundCloud app credentials to <span class="mono">.env</span>. <a href="#/settings">See Settings</a>.</p>`;
    }

    put('slotPublish', `
      <div class="card card-pad publish">
        <div class="btn-row" style="justify-content:space-between;align-items:flex-start">
          <div class="stack" style="gap:4px;min-width:0">
            <h2>Saved to your computer</h2>
            <span class="subtle mono" style="overflow-wrap:anywhere">${esc(tilde(s.output.folder))}</span>
          </div>
          <button class="btn sm" data-act="reveal">${icons.folder} Show in Finder</button>
        </div>
        <div class="file-list">${rows}</div>
        ${scHtml}
      </div>`);
  }

  /* ---------------- editor ---------------- */
  async function ensureEditor() {
    if (!analyzed()) return;
    if (wf) return setLocked(busy());
    if (ensureEditor.loading) return;
    ensureEditor.loading = true;
    let peaks;
    try {
      peaks = await api.peaks(id);
    } catch (err) {
      ensureEditor.loading = false;
      return toast(`Could not load waveform: ${err.message}`, 'err');
    }
    if (destroyed) return;
    segs = structuredClone(s.segments);
    buildEditor(peaks);
    setLocked(busy());
  }

  function buildEditor(peaks) {
    const d = s.detection || ctx.info.detectionDefaults;
    $('#slotEditor', root).innerHTML = `
      <div class="card editor" id="editor">
        <div class="card-head">
          <div class="stack" style="gap:2px">
            <h2>Songs</h2>
            <span class="subtle">Drag a song's edges to adjust. Click to jump there. Double-click a song to zoom in. Scroll to zoom.</span>
          </div>
          <span class="subtle" data-summary></span>
        </div>
        <div class="wave-wrap">
          <canvas class="wave"></canvas>
          <canvas class="overview" title="Whole recording. Click to jump."></canvas>
        </div>
        <div class="transport">
          <button class="btn play-btn" data-act="play" title="Play / pause (space)">${icons.play}</button>
          <span class="time" data-time>0:00 / ${fmtClock(s.source.duration)}</span>
          <button class="btn sm" data-act="play-selected">${icons.playLine} Play selected song</button>
          <span class="spacer"></span>
          <button class="btn sm ghost icon-only" data-act="zoom-out" title="Zoom out">${icons.zoomOut}</button>
          <button class="btn sm ghost icon-only" data-act="zoom-in" title="Zoom in">${icons.zoomIn}</button>
          <button class="btn sm ghost" data-act="zoom-sel" title="Zoom to selected song">Selected</button>
          <button class="btn sm ghost" data-act="fit" title="Show the whole recording">${icons.fit} All</button>
        </div>

        <div class="lockable">
          <div class="songs-toolbar">
            <h3 data-count>Songs</h3>
            <div class="btn-row" style="gap:6px">
              <button class="btn sm" data-act="add" title="Add a song starting at the playhead">${icons.plus} Add at playhead</button>
              <button class="btn sm" data-act="split" title="Split the song under the playhead">${icons.split} Split</button>
              <button class="btn sm" data-act="merge" title="Join the selected song with the next one">${icons.merge} Merge with next</button>
            </div>
          </div>
          <div class="songs" id="songs"></div>

          <details class="detect">
            <summary>Detection settings</summary>
            <div class="detect-body">
              <label class="field">
                <span class="field-label">Detection sensitivity <span class="subtle" data-sens-val></span></span>
                <input type="range" min="-12" max="12" step="1" value="${d.sensitivity}" name="sensitivity" />
                <span class="range-labels"><span>Fewer songs (stricter)</span><span>More songs</span></span>
              </label>
              <label class="field">
                <span class="field-label">Shortest song (sec)</span>
                <input type="number" min="5" max="900" value="${d.minSongSec}" name="minSongSec" />
              </label>
              <label class="field">
                <span class="field-label">Join gaps under (sec)</span>
                <input type="number" min="0" max="120" value="${d.mergeGapSec}" name="mergeGapSec" />
              </label>
              <button class="btn" data-act="redetect">${icons.retry} Re-detect</button>
            </div>
          </details>

          <div class="editor-foot">
            <span class="dest" data-dest></span>
            <div class="btn-row">
              <button class="btn" data-act="save-upload">${icons.upload} Save &amp; upload</button>
              <button class="btn primary" data-act="save">${icons.folder} <span data-save-label>Save songs</span></button>
            </div>
          </div>
        </div>
      </div>
      <audio preload="auto" src="/api/sessions/${id}/preview"></audio>`;

    audio = $('audio', root);
    wf = new Waveform($('canvas.wave', root), $('canvas.overview', root), {
      peaks: peaks.peaks,
      peakRate: peaks.peakRate,
      duration: s.source.duration || peaks.duration,
      onSeek: (t) => seek(t),
      onSelect: (sid) => select(sid, false),
      onEditing: (seg) => updateRowTimes(seg),
      onChange: () => { edited = true; changed(); },
    });
    wf.setSegments(segs);

    const sens = $('[name=sensitivity]', root);
    const showSens = () => ($('[data-sens-val]', root).textContent = `(${sens.value > 0 ? '+' : ''}${sens.value})`);
    sens.addEventListener('input', showSens);
    showSens();

    audio.addEventListener('play', () => { setPlayIcon(true); wf.follow = true; tick(); });
    audio.addEventListener('pause', () => { setPlayIcon(false); wf.follow = false; cancelAnimationFrame(rafId); });
    audio.addEventListener('error', () => toast('Could not load the audio preview.', 'err'));

    const songsEl = $('#songs', root);
    songsEl.addEventListener('input', onSongInput);
    songsEl.addEventListener('change', onSongChange);
    songsEl.addEventListener('click', onSongClick);

    renderSongs();
  }

  function setLocked(locked) {
    const el = $('.lockable', root);
    if (el) el.inert = locked;
    if (wf) wf.locked = locked;
    const ed = $('#editor', root);
    if (ed) ed.style.opacity = locked ? '0.85' : '';
    updateFoot();
  }

  /* ---------- songs table ---------- */
  function renumber() {
    segs.sort((a, b) => a.start - b.start);
    let n = 0;
    for (const g of segs) {
      if (g.include) n++;
      g._n = g.include ? n : null;
      if (g.autoLabel && g.include) g.label = `Song ${n}`;
    }
  }

  function renderSongs() {
    renumber();
    const el = $('#songs', root);
    const conf = (c) => {
      if (c == null) return '<span class="conf" title="Added by hand"></span>';
      const on = Math.max(1, Math.round(c * 4));
      return `<span class="conf" title="Detection confidence ${Math.round(c * 100)}%">${[0, 1, 2, 3].map((i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;
    };
    el.innerHTML = segs.length
      ? `<div class="song-row song-head"><span></span><span>#</span><span>Name</span><span style="text-align:center">Start</span><span></span><span style="text-align:center">End</span><span style="text-align:right">Length</span><span></span><span></span></div>` +
        segs.map((g) => `
        <div class="song-row ${g.id === selectedId ? 'selected' : ''} ${g.include ? '' : 'excluded'}" data-id="${esc(g.id)}">
          <input type="checkbox" data-f="include" ${g.include ? 'checked' : ''} title="Include this song" />
          <span class="num">${g._n ? String(g._n).padStart(2, '0') : '–'}</span>
          <input type="text" data-f="label" value="${esc(g.label)}" maxlength="100" aria-label="Song name" />
          <span class="timegroup">
            <input type="text" class="time" data-f="start" value="${fmtClock(g.start, true)}" aria-label="Start time" />
            <span class="dash">–</span>
            <input type="text" class="time" data-f="end" value="${fmtClock(g.end, true)}" aria-label="End time" />
            <span class="dur" data-dur>${fmtClock(g.end - g.start)}</span>
          </span>
          ${conf(g.confidence)}
          <span class="actions">
            <button class="btn ghost sm icon-only" data-act="row-play" title="Play this song">${icons.playLine}</button>
            <button class="btn ghost sm icon-only danger" data-act="row-delete" title="Remove">${icons.x}</button>
          </span>
        </div>`).join('')
      : `<div class="empty">No songs yet. Move the playhead to where a song starts and press <strong>Add at playhead</strong>.</div>`;
    updateSummary();
    updateFoot();
    wf?.setSegments(segs);
  }

  function updateRowTimes(g) {
    const row = $(`.song-row[data-id="${CSS.escape(g.id)}"]`, root);
    if (!row) return;
    $('[data-f=start]', row).value = fmtClock(g.start, true);
    $('[data-f=end]', row).value = fmtClock(g.end, true);
    $('[data-dur]', row).textContent = fmtClock(g.end - g.start);
    updateSummary();
  }

  function updateSummary() {
    const inc = segs.filter((g) => g.include);
    const total = inc.reduce((a, g) => a + (g.end - g.start), 0);
    const el = $('[data-summary]', root);
    if (el) el.textContent = `${inc.length} song${inc.length === 1 ? '' : 's'} · ${fmtClock(total)} of music`;
    const c = $('[data-count]', root);
    if (c) c.textContent = `Songs (${inc.length}${segs.length !== inc.length ? ` of ${segs.length}` : ''})`;
  }

  function updateFoot() {
    if (!wf) return;
    const n = segs.filter((g) => g.include).length;
    const sc = ctx.info.soundcloud;
    const save = $('[data-act=save]', root);
    const saveUp = $('[data-act=save-upload]', root);
    $('[data-save-label]', root).textContent = s.output ? `Save again (${n})` : `Save ${n} song${n === 1 ? '' : 's'}`;
    save.disabled = !n || busy();
    saveUp.disabled = !n || busy() || !sc.connected;
    saveUp.title = sc.connected ? 'Save the files, then upload them to SoundCloud' : 'Connect SoundCloud in Settings first';
    const out = tilde(ctx.info.settings.outputDir);
    $('[data-dest]', root).innerHTML = s.output
      ? `Saving again replaces the files in <span class="mono">${esc(tilde(s.output.folder))}</span>`
      : `Saves MP3s to <span class="mono">${esc(out)}/${esc(s.band)}/${esc(s.date)} - ${esc(s.band)} Practice/</span>`;
  }

  const segById = (sid) => segs.find((g) => g.id === sid);

  function onSongInput(e) {
    const row = e.target.closest('.song-row');
    if (!row || e.target.dataset.f !== 'label') return;
    const g = segById(row.dataset.id);
    g.label = e.target.value;
    g.autoLabel = false;
    wf.draw();
  }

  function onSongChange(e) {
    const row = e.target.closest('.song-row');
    if (!row) return;
    const g = segById(row.dataset.id);
    const f = e.target.dataset.f;
    if (f === 'include') {
      g.include = e.target.checked;
      renderSongs();
    } else if (f === 'label') {
      g.label = e.target.value.trim() || `Song ${g._n || ''}`.trim();
      g.autoLabel = /^Song \d+$/.test(g.label);
      renderSongs();
    } else if (f === 'start' || f === 'end') {
      const t = parseClock(e.target.value);
      if (!Number.isFinite(t)) {
        toast('Use a time like 12:34 or 1:02:03.5', 'err');
        e.target.value = fmtClock(g[f], true);
        return;
      }
      setEdge(g, f, t);
      renderSongs();
    }
    edited = true;
    changed();
  }

  function setEdge(g, edge, t) {
    const i = segs.indexOf(g);
    const prevEnd = i > 0 ? segs[i - 1].end : 0;
    const nextStart = i < segs.length - 1 ? segs[i + 1].start : s.source.duration;
    if (edge === 'start') g.start = Math.max(prevEnd, Math.min(t, g.end - 1));
    else g.end = Math.min(nextStart, Math.max(t, g.start + 1));
  }

  function onSongClick(e) {
    const row = e.target.closest('.song-row');
    if (!row || row.classList.contains('song-head')) return;
    const g = segById(row.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'row-play') return playSeg(g);
    if (act === 'row-delete') {
      segs = segs.filter((x) => x !== g);
      if (selectedId === g.id) selectedId = null;
      renderSongs();
      edited = true;
      changed();
      return;
    }
    if (e.target.matches('input')) { if (selectedId !== g.id) select(g.id, false); return; }
    select(g.id, true);
  }

  function select(sid, seekTo) {
    selectedId = sid;
    wf.select(sid);
    $$('.song-row', root).forEach((r) => r.classList.toggle('selected', r.dataset.id === sid));
    const g = segById(sid);
    if (g && seekTo) {
      const [a, b] = wf.view;
      if (g.start < a || g.end > b) wf.zoomTo(g.start, g.end);
      seek(g.start);
    }
  }

  /* ---------- playback ---------- */
  function setPlayIcon(playing) {
    const b = $('[data-act=play]', root);
    if (b) b.innerHTML = playing ? icons.pause : icons.play;
  }
  function tick() {
    if (!audio || audio.paused) return;
    const t = audio.currentTime;
    if (stopAt != null && t >= stopAt) { audio.pause(); stopAt = null; }
    wf.setPlayhead(t);
    const el = $('[data-time]', root);
    if (el) el.textContent = `${fmtClock(t)} / ${fmtClock(s.source.duration)}`;
    rafId = requestAnimationFrame(tick);
  }
  function seek(t) {
    stopAt = null;
    if (audio) audio.currentTime = t;
    wf.setPlayhead(t);
    const el = $('[data-time]', root);
    if (el) el.textContent = `${fmtClock(t)} / ${fmtClock(s.source.duration)}`;
  }
  function playSeg(g) {
    select(g.id, false);
    seek(g.start);
    stopAt = g.end;
    audio.play().catch(() => {});
  }
  function togglePlay() {
    if (!audio) return;
    if (audio.paused) { stopAt = null; audio.play().catch((err) => toast(err.message, 'err')); }
    else audio.pause();
  }

  /* ---------- saving segments ---------- */
  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 500);
  }
  async function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (savePromise) await savePromise;
    if (!edited) return;
    const payload = segs.map(({ _n, ...g }) => g);
    savePromise = api.saveSegments(id, payload)
      .then((res) => { s = res; edited = false; renderBanner(); renderHead(); })
      .catch((err) => toast(`Couldn't save changes: ${err.message}`, 'err'))
      .finally(() => (savePromise = null));
    await savePromise;
  }

  /* ---------- actions ---------- */
  async function onAction(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || !root.contains(btn) || btn.disabled) return;
    const act = btn.dataset.act;
    const playT = audio ? audio.currentTime : 0;
    try {
      switch (act) {
        case 'play': return togglePlay();
        case 'play-selected': {
          const g = segById(selectedId) || segs.find((x) => playT >= x.start && playT <= x.end) || segs[0];
          if (g) playSeg(g); else toast('Select a song first.');
          return;
        }
        case 'zoom-in': return wf.zoomBy(0.5);
        case 'zoom-out': return wf.zoomBy(2);
        case 'fit': return wf.fit();
        case 'zoom-sel': {
          const g = segById(selectedId);
          return g ? wf.zoomTo(g.start, g.end) : toast('Select a song first.');
        }
        case 'add': {
          if (segs.some((g) => playT > g.start && playT < g.end)) return toast('The playhead is inside a song. Use Split, or move the playhead to a gap.', 'err');
          const next = segs.find((g) => g.start > playT);
          const end = Math.min(playT + 180, next ? next.start : s.source.duration);
          if (end - playT < 2) return toast('Not enough room here for a new song.', 'err');
          const g = { id: `m${Date.now().toString(36)}`, label: 'Song', autoLabel: true, include: true, start: Math.round(playT * 10) / 10, end: Math.round(end * 10) / 10, confidence: null };
          segs.push(g);
          renderSongs();
          select(g.id, false);
          edited = true;
          return changed();
        }
        case 'split': {
          const g = segs.find((x) => playT > x.start + 1 && playT < x.end - 1);
          if (!g) return toast('Move the playhead inside a song (at least 1 second from the edges) to split it.', 'err');
          const t = Math.round(playT * 10) / 10;
          const b = { ...g, id: `m${Date.now().toString(36)}`, start: t, autoLabel: true, label: 'Song' };
          g.end = t;
          segs.push(b);
          renderSongs();
          edited = true;
          return changed();
        }
        case 'merge': {
          renumber();
          const g = segById(selectedId);
          if (!g) return toast('Select the first of the two songs to merge.', 'err');
          const i = segs.indexOf(g);
          const nxt = segs[i + 1];
          if (!nxt) return toast('There is no next song to merge with.', 'err');
          g.end = nxt.end;
          segs.splice(i + 1, 1);
          renderSongs();
          edited = true;
          return changed();
        }
        case 'redetect': {
          if (edited || segs.some((g) => !g.autoLabel || g.confidence == null)) {
            const ok = await confirmModal('Re-detect songs?', 'This replaces the current song list, including any names and edits.', 'Re-detect');
            if (!ok) return;
          }
          const params = {
            sensitivity: Number($('[name=sensitivity]', root).value),
            minSongSec: Number($('[name=minSongSec]', root).value),
            mergeGapSec: Number($('[name=mergeGapSec]', root).value),
          };
          clearTimeout(saveTimer);
          edited = false;
          s = await api.detect(id, params);
          segs = structuredClone(s.segments);
          selectedId = null;
          renderSongs();
          renderBanner();
          return toast(`Found ${segs.length} song${segs.length === 1 ? '' : 's'}`);
        }
        case 'save':
        case 'save-upload': {
          await flushSave();
          if (audio && !audio.paused) audio.pause();
          s = await api.cut(id, act === 'save-upload');
          return apply();
        }
        case 'upload':
          s = await api.upload(id);
          return apply();
        case 'retry':
          s = await api.retry(id);
          return apply();
        case 'reveal':
          return api.reveal(id);
        case 'copy': {
          const input = $('[data-share]', root);
          await navigator.clipboard.writeText(input.value).catch(() => { input.select(); document.execCommand('copy'); });
          return toast('Link copied. Paste it in the band chat.');
        }
        case 'mode':
          s = await api.patchSession(id, { mode: btn.dataset.mode });
          return apply();
        case 'edit-details':
          return editDetails();
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function editDetails() {
    const bands = await api.bands();
    const dlg = modal(`
      <h2>Session details</h2>
      <label class="field"><span class="field-label">Band</span>
        <input type="text" name="band" value="${esc(s.band)}" list="bandOptions" maxlength="100" />
        <datalist id="bandOptions">${bands.map((b) => `<option value="${esc(b.name)}">`).join('')}</datalist>
      </label>
      <label class="field"><span class="field-label">Recording date</span>
        <input type="date" name="date" value="${esc(s.date)}" max="${todayLocal()}" /></label>
      <label class="field"><span class="field-label">Notes</span>
        <textarea name="notes" maxlength="5000">${esc(s.notes)}</textarea></label>
      ${s.output ? '<p class="subtle">Changes apply to the folder name and tags the next time you save.</p>' : ''}
      <div class="btn-row" style="justify-content:flex-end">
        <button class="btn" data-close>Cancel</button>
        <button class="btn primary" data-ok>Save</button>
      </div>`);
    $('[data-ok]', dlg).onclick = async () => {
      try {
        s = await api.patchSession(id, {
          band: $('[name=band]', dlg).value,
          date: $('[name=date]', dlg).value,
          notes: $('[name=notes]', dlg).value,
        });
        dlg.close();
        if ($('[name=band]', dlg).value.trim()) api.saveBand($('[name=band]', dlg).value.trim()).catch(() => {});
        apply();
        updateFoot();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  }

  function onKey(e) {
    if (!wf || e.target.closest('input, textarea, select, [contenteditable]') || $('#modal').open) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(Math.max(0, (audio?.currentTime || 0) - (e.shiftKey ? 30 : 5))); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(Math.min(s.source.duration, (audio?.currentTime || 0) + (e.shiftKey ? 30 : 5))); }
  }

  root.addEventListener('click', onAction);
  document.addEventListener('keydown', onKey);
  apply();

  return () => {
    destroyed = true;
    clearTimeout(pollTimer);
    if (saveTimer) flushSave();
    cancelAnimationFrame(rafId);
    audio?.pause();
    wf?.destroy();
    document.removeEventListener('keydown', onKey);
  };
}

const stageWord = (stage) =>
  ({ queued: 'starting', analyzing: 'analyzing the recording', cutting: 'saving the songs', uploading: 'uploading to SoundCloud' })[stage] || stage;

const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~');
