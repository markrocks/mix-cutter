import { api, uploadRecording } from './api.js';
import { sessionRows } from './sessions.js';
import { $, esc, fmtBytes, icons, todayLocal, toast } from './util.js';

const ACCEPT = 'audio/*,video/*,.m4a,.mp3,.wav,.aif,.aiff,.flac,.ogg,.opus,.caf,.aac,.wma,.mov,.mp4';
const NEW = '__new__';

export async function renderImport(root, ctx) {
  const [bands, sessions] = await Promise.all([api.bands(), api.sessions()]);
  const { settings, soundcloud: sc } = ctx.info;
  const hasBands = bands.length > 0;

  root.innerHTML = `
    <div class="page-title">
      <h1>Import a practice recording</h1>
      <p class="muted">Drop in the whole recording. Mix Cutter finds each song, numbers it, saves the files, and can send them to SoundCloud for the band.</p>
    </div>
    <div class="home-grid">
      <form class="card card-pad stack-lg" id="importForm" novalidate>
        <label class="dropzone" id="dz">
          <input type="file" name="file" accept="${ACCEPT}" />
          <div class="dz-empty stack" style="justify-items:center;gap:10px">
            <span class="dz-icon">${icons.upload}</span>
            <strong>Drop a recording here, or click to choose</strong>
            <span class="subtle">MP3, M4A / Voice Memos, WAV, AIFF, FLAC, or even a phone video</span>
          </div>
          <div class="dz-file file-chip hidden">
            <span class="dz-icon">${icons.music}</span>
            <span><strong class="dz-name"></strong><br><span class="subtle dz-size"></span> · <span class="subtle" style="text-decoration:underline">change</span></span>
          </div>
        </label>

        <div class="grid-2">
          <div class="field stack" style="gap:6px">
            <span class="field-label">Band</span>
            <select name="bandSelect" class="${hasBands ? '' : 'hidden'}">
              ${bands.map((b) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join('')}
              <option value="${NEW}">+ Add a new band…</option>
            </select>
            <div class="new-band stack ${hasBands ? 'hidden' : ''}" style="gap:8px">
              <input type="text" name="bandNew" placeholder="Band name" autocomplete="off" maxlength="100" />
              <label class="check"><input type="checkbox" name="saveBand" checked /> Save to my bands list</label>
            </div>
          </div>
          <label class="field">
            <span class="field-label">Recording date</span>
            <input type="date" name="date" value="${todayLocal()}" max="${todayLocal()}" required />
          </label>
        </div>

        <label class="field">
          <span class="field-label">Notes <span class="subtle">(optional)</span></span>
          <textarea name="notes" placeholder="Who was there, what you worked on, new songs, gear notes…" maxlength="5000"></textarea>
        </label>

        <div class="field stack" style="gap:8px">
          <span class="field-label">After the songs are found</span>
          <div class="mode-picker">
            <label class="mode-option">
              <input type="radio" name="mode" value="review" ${settings.defaultMode !== 'auto' ? 'checked' : ''} />
              <strong>Stop so I can review</strong>
              <span>Check the cuts, rename songs, then save and upload when you're ready.</span>
            </label>
            <label class="mode-option">
              <input type="radio" name="mode" value="auto" ${settings.defaultMode === 'auto' ? 'checked' : ''} />
              <strong>Do everything automatically</strong>
              <span>Cut, save, and upload to SoundCloud without stopping.${sc.connected ? '' : ' <em>(Connect SoundCloud first, or it will stop after saving.)</em>'}</span>
            </label>
          </div>
        </div>

        <div class="upload-progress stack hidden" style="gap:8px">
          <div class="progress"><div></div></div>
          <span class="subtle up-msg">Uploading…</span>
        </div>

        <button class="btn primary lg block" type="submit">Import &amp; find songs</button>
      </form>

      <aside class="card">
        <div class="card-head"><h2>Recent sessions</h2><a class="btn ghost sm" href="#/sessions">See all</a></div>
        ${sessionRows(sessions.slice(0, 6))}
      </aside>
    </div>`;

  const form = $('#importForm', root);
  const dz = $('#dz', root);
  const fileInput = form.file;
  const select = form.bandSelect;
  const newBand = $('.new-band', root);

  const showFile = () => {
    const f = fileInput.files[0];
    dz.classList.toggle('has-file', Boolean(f));
    $('.dz-empty', dz).classList.toggle('hidden', Boolean(f));
    $('.dz-file', dz).classList.toggle('hidden', !f);
    if (f) {
      $('.dz-name', dz).textContent = f.name;
      $('.dz-size', dz).textContent = fmtBytes(f.size);
    }
  };
  fileInput.addEventListener('change', showFile);
  for (const ev of ['dragenter', 'dragover']) dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) dz.addEventListener(ev, () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      showFile();
    }
  });

  select.addEventListener('change', () => {
    const isNew = select.value === NEW;
    newBand.classList.toggle('hidden', !isNew);
    if (isNew) form.bandNew.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    const usingNew = !hasBands || select.value === NEW;
    const band = (usingNew ? form.bandNew.value : select.value).trim();
    const date = form.date.value;
    if (!file) return toast('Choose a recording to import first.', 'err');
    if (!band) { form.bandNew.focus(); return toast('Enter the band name.', 'err'); }
    if (!date) return toast('Pick the recording date.', 'err');

    const fd = new FormData();
    fd.append('band', band);
    fd.append('date', date);
    fd.append('notes', form.notes.value);
    fd.append('mode', form.mode.value);
    fd.append('saveBand', usingNew ? String(form.saveBand.checked) : 'true');
    fd.append('file', file); // file last so fields arrive first

    const prog = $('.upload-progress', root);
    const bar = $('.progress > div', prog);
    const msg = $('.up-msg', prog);
    const submit = form.querySelector('[type=submit]');
    prog.classList.remove('hidden');
    submit.disabled = true;
    form.querySelectorAll('input,select,textarea').forEach((el) => (el.disabled = true));
    try {
      const s = await uploadRecording(fd, (p) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        msg.textContent = p < 1 ? `Sending to Mix Cutter… ${Math.round(p * 100)}% of ${fmtBytes(file.size)}` : 'Starting analysis…';
      });
      toast('Recording imported. Finding songs…');
      location.hash = `#/session/${s.id}`;
    } catch (err) {
      toast(err.message, 'err');
      prog.classList.add('hidden');
      submit.disabled = false;
      form.querySelectorAll('input,select,textarea').forEach((el) => (el.disabled = false));
    }
  });
}
