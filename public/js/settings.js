import { api } from './api.js';
import { $, confirmModal, esc, toast } from './util.js';

export async function renderSettings(root, ctx, params) {
  if (params.get('sc') === 'connected') toast('SoundCloud connected');
  if (params.get('sc_error')) toast(`SoundCloud: ${params.get('sc_error')}`, 'err');
  if (params.has('sc') || params.has('sc_error')) history.replaceState(null, '', '#/settings');

  const draw = async () => {
    await ctx.refreshInfo();
    const { settings, soundcloud: sc, detectionDefaults } = ctx.info;
    const bands = await api.bands();
    const d = settings.detection;

    let scBody;
    if (sc.dryRun) {
      scBody = `<p class="muted"><strong>Dry-run mode is on</strong> (<span class="mono">SOUNDCLOUD_DRY_RUN=1</span>). Uploads are simulated so you can test the whole flow. Nothing is sent to SoundCloud.</p>`;
    } else if (!sc.configured) {
      scBody = `
        <p class="muted">Add your SoundCloud app credentials to <span class="mono">.env</span> in the Mix Cutter folder, then restart the app:</p>
        <pre class="code">SOUNDCLOUD_CLIENT_ID=your-client-id
SOUNDCLOUD_CLIENT_SECRET=your-client-secret
SOUNDCLOUD_REDIRECT_URI=${esc(sc.redirectUri || `${location.origin}/auth/soundcloud/callback`)}</pre>
        <p class="subtle">The redirect URI must match the one registered on your SoundCloud app exactly.</p>`;
    } else if (!sc.connected) {
      scBody = `
        <p class="muted">Sign in once and Mix Cutter can upload practice songs to your account as private tracks.</p>
        <div><a class="btn primary" href="/auth/soundcloud">Connect SoundCloud</a></div>
        <p class="subtle">Redirect URI in use: <span class="mono">${esc(sc.redirectUri)}</span>. It must match your SoundCloud app's settings. Connect from this computer, not a phone.</p>`;
    } else {
      scBody = `
        <div class="btn-row" style="justify-content:space-between">
          <p>Connected as <strong>${sc.permalinkUrl ? `<a href="${esc(sc.permalinkUrl)}" target="_blank" rel="noopener">${esc(sc.username || 'your account')}</a>` : esc(sc.username || 'your account')}</strong></p>
          <button class="btn sm danger" data-act="disconnect">Disconnect</button>
        </div>
        <p class="subtle">Free SoundCloud accounts have an upload time limit. Long practices may need a Pro plan.</p>`;
    }

    root.innerHTML = `
      <div class="page-title"><h1>Settings</h1></div>
      <div class="settings-grid">
        <section class="card card-pad stack">
          <h2>SoundCloud</h2>
          ${scBody}
        </section>

        <section class="card card-pad stack">
          <h2>Saving</h2>
          <label class="field">
            <span class="field-label">Save song folders in</span>
            <input type="text" name="outputDir" value="${esc(settings.outputDir)}" />
            <span class="subtle">Each practice gets its own folder: <span class="mono">&lt;Band&gt;/&lt;Date&gt; - &lt;Band&gt; Practice/</span>. Songs are saved as 320 kbps MP3s with tags.</span>
          </label>
          <div class="field stack" style="gap:8px">
            <span class="field-label">Default mode for new imports</span>
            <div class="btn-row">
              <label class="check"><input type="radio" name="defaultMode" value="review" ${settings.defaultMode !== 'auto' ? 'checked' : ''}/> Stop for review</label>
              <label class="check"><input type="radio" name="defaultMode" value="auto" ${settings.defaultMode === 'auto' ? 'checked' : ''}/> Fully automatic</label>
            </div>
          </div>
        </section>

        <section class="card card-pad stack">
          <h2>Song detection defaults</h2>
          <p class="subtle">These are the starting values for new imports. You can also tweak them for each session on its review screen.</p>
          <div class="grid-2">
            <label class="field"><span class="field-label">Sensitivity (−12 … +12)</span>
              <input type="number" name="sensitivity" min="-12" max="12" value="${d.sensitivity}" /></label>
            <label class="field"><span class="field-label">Shortest song (sec)</span>
              <input type="number" name="minSongSec" min="5" max="900" value="${d.minSongSec}" /></label>
            <label class="field"><span class="field-label">Join gaps under (sec)</span>
              <input type="number" name="mergeGapSec" min="0" max="120" value="${d.mergeGapSec}" /></label>
            <label class="field"><span class="field-label">Extra lead-in / tail (sec)</span>
              <span class="btn-row" style="flex-wrap:nowrap">
                <input type="number" name="padStartSec" min="0" max="30" step="0.5" value="${d.padStartSec}" />
                <input type="number" name="padEndSec" min="0" max="30" step="0.5" value="${d.padEndSec}" />
              </span></label>
          </div>
          <div class="btn-row">
            <button class="btn primary" data-act="save-settings">Save settings</button>
            <button class="btn ghost" data-act="reset-detection">Reset detection to defaults</button>
          </div>
        </section>

        <section class="card card-pad stack">
          <h2>Saved bands</h2>
          <div class="band-list">
            ${bands.length ? bands.map((b) => `<span class="band-chip">${esc(b.name)}<button data-del-band="${esc(b.name)}" title="Remove">×</button></span>`).join('') : '<span class="subtle">No saved bands yet.</span>'}
          </div>
          <form class="btn-row" data-add-band style="flex-wrap:nowrap">
            <input type="text" name="newBand" placeholder="Add a band" maxlength="100" />
            <button class="btn" type="submit">Add</button>
          </form>
        </section>
      </div>`;

    root.dataset.defaults = JSON.stringify(detectionDefaults);
  };

  await draw();

  root.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del-band]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (del) {
        await api.deleteBand(del.dataset.delBand);
        await draw();
      } else if (act === 'disconnect') {
        if (await confirmModal('Disconnect SoundCloud?', 'Mix Cutter will forget your SoundCloud sign-in. Tracks already uploaded stay on SoundCloud.', 'Disconnect')) {
          await api.disconnectSoundCloud();
          await draw();
        }
      } else if (act === 'save-settings') {
        const num = (n) => Number($(`[name=${n}]`, root).value);
        await api.saveSettings({
          outputDir: $('[name=outputDir]', root).value,
          defaultMode: $('[name=defaultMode]:checked', root)?.value,
          detection: {
            sensitivity: num('sensitivity'), minSongSec: num('minSongSec'), mergeGapSec: num('mergeGapSec'),
            padStartSec: num('padStartSec'), padEndSec: num('padEndSec'),
          },
        });
        toast('Settings saved');
        await draw();
      } else if (act === 'reset-detection') {
        await api.saveSettings({ detection: JSON.parse(root.dataset.defaults) });
        toast('Detection settings reset');
        await draw();
      }
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  root.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-add-band]')) return;
    e.preventDefault();
    const name = e.target.newBand.value.trim();
    if (!name) return;
    try {
      await api.saveBand(name);
      await draw();
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}
