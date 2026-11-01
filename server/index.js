import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { HOST, PORT, PUBLIC_DIR, UPLOAD_DIR, soundcloud as scConfig } from './config.js';
import * as store from './store.js';
import * as pipeline from './pipeline.js';
import * as sc from './soundcloud.js';
import { DEFAULT_DETECTION } from './segment.js';
import { isIsoDate, lanAddresses, newId } from './util.js';

store.loadAllSessions();

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({ dest: UPLOAD_DIR });

const fail = (status, message) => Object.assign(new Error(message), { status });

function mustSession(req) {
  const s = store.getSession(req.params.id);
  if (!s) throw fail(404, 'Session not found');
  return s;
}

/** What the browser is allowed to see (everything except internal paths). */
const publicSession = (s) => ({ ...s, busy: pipeline.isBusy(s.id) });

/* ---------------- info / settings ---------------- */

app.get('/api/info', (req, res) => {
  res.json({
    port: PORT,
    lanUrls: HOST === '0.0.0.0' ? lanAddresses().map((ip) => `http://${ip}:${PORT}`) : [],
    settings: store.getSettings(),
    detectionDefaults: DEFAULT_DETECTION,
    soundcloud: sc.status(),
  });
});

app.get('/api/qr', async (req, res) => {
  const url = String(req.query.url || '');
  if (!/^https?:\/\//.test(url) || url.length > 300) throw fail(400, 'Bad url');
  res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 }));
});

app.get('/api/settings', (req, res) => res.json(store.getSettings()));
app.put('/api/settings', (req, res) => res.json(store.updateSettings(req.body || {})));

/* ---------------- bands ---------------- */

app.get('/api/bands', (req, res) => res.json(store.listBands()));
app.post('/api/bands', (req, res) => {
  if (!String(req.body?.name || '').trim()) throw fail(400, 'Band name is required');
  res.json(store.saveBand(req.body.name));
});
app.delete('/api/bands/:name', (req, res) => res.json(store.deleteBand(req.params.name)));

/* ---------------- sessions ---------------- */

app.get('/api/sessions', (req, res) => res.json(store.listSessions()));

app.post('/api/sessions', upload.single('file'), (req, res) => {
  const file = req.file;
  const cleanup = () => file && fs.rmSync(file.path, { force: true });
  const band = String(req.body.band || '').trim();
  const date = String(req.body.date || '');
  if (!file) throw fail(400, 'Please choose an audio file.');
  if (!band) { cleanup(); throw fail(400, 'Please enter a band name.'); }
  if (!isIsoDate(date)) { cleanup(); throw fail(400, 'Please pick a valid date.'); }

  if (req.body.saveBand !== 'false') store.saveBand(band);
  else store.touchBand(band);

  const id = newId();
  const ext = (path.extname(file.originalname) || '.audio').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const session = {
    id,
    createdAt: new Date().toISOString(),
    band,
    date,
    notes: String(req.body.notes || '').slice(0, 5000),
    mode: req.body.mode === 'auto' ? 'auto' : 'review',
    source: { originalName: file.originalname, file: `source${ext}`, size: file.size },
    status: 'queued',
    progress: { pct: 0, message: 'Queued' },
    detection: store.getSettings().detection,
    segments: [],
    output: null,
    soundcloud: null,
  };
  store.createSession(session);
  fs.renameSync(file.path, path.join(store.sessionDir(id), session.source.file));
  pipeline.startAnalysis(id);
  res.status(201).json(publicSession(store.getSession(id)));
});

app.get('/api/sessions/:id', (req, res) => res.json(publicSession(mustSession(req))));

app.get('/api/sessions/:id/peaks', (req, res) => {
  mustSession(req);
  const f = store.readJson(store.featuresFile(req.params.id), null);
  if (!f) throw fail(404, 'Not analyzed yet');
  res.json({ peakRate: f.peakRate, peaks: f.peaks, duration: f.duration });
});

app.get('/api/sessions/:id/preview', (req, res) => {
  mustSession(req);
  res.sendFile(store.previewFile(req.params.id), { headers: { 'cache-control': 'no-cache' } });
});

app.put('/api/sessions/:id/segments', (req, res) => {
  const s = mustSession(req);
  if (pipeline.isBusy(s.id)) throw fail(409, 'Busy, please wait.');
  const incoming = Array.isArray(req.body?.segments) ? req.body.segments : null;
  if (!incoming) throw fail(400, 'segments[] required');
  const dur = s.source.duration || Infinity;
  const segments = incoming
    .map((g) => ({
      id: String(g.id || pipeline.segId()).slice(0, 40),
      label: String(g.label || '').trim().slice(0, 100) || 'Untitled',
      autoLabel: Boolean(g.autoLabel),
      include: g.include !== false,
      start: Math.max(0, Number(g.start) || 0),
      end: Math.min(dur, Number(g.end) || 0),
      confidence: typeof g.confidence === 'number' ? g.confidence : null,
    }))
    .filter((g) => g.end - g.start >= 0.5)
    .sort((a, b) => a.start - b.start);
  res.json(publicSession(store.updateSession(s.id, (x) => {
    x.segments = segments;
    x.segmentsEditedAt = new Date().toISOString();
    x.notice = null;
  })));
});

app.post('/api/sessions/:id/detect', (req, res) => {
  const s = mustSession(req);
  if (pipeline.isBusy(s.id)) throw fail(409, 'Busy, please wait.');
  const params = store.sanitizeDetection({ ...s.detection, ...(req.body || {}) });
  res.json(publicSession(pipeline.redetect(s.id, params)));
});

app.patch('/api/sessions/:id', (req, res) => {
  const s = mustSession(req);
  const b = req.body || {};
  res.json(publicSession(store.updateSession(s.id, (x) => {
    if (typeof b.band === 'string' && b.band.trim()) x.band = b.band.trim().slice(0, 100);
    if (isIsoDate(b.date)) x.date = b.date;
    if (typeof b.notes === 'string') x.notes = b.notes.slice(0, 5000);
    if (b.mode === 'auto' || b.mode === 'review') x.mode = b.mode;
  })));
});

app.post('/api/sessions/:id/cut', (req, res) => {
  const s = mustSession(req);
  if (!s.segments.some((g) => g.include)) throw fail(400, 'Select at least one song to save.');
  pipeline.startCut(s.id, { upload: Boolean(req.body?.upload) });
  res.json(publicSession(store.getSession(s.id)));
});

app.post('/api/sessions/:id/upload', (req, res) => {
  const s = mustSession(req);
  if (!sc.status().connected) throw fail(400, 'Connect SoundCloud first.');
  pipeline.startUpload(s.id);
  res.json(publicSession(store.getSession(s.id)));
});

app.post('/api/sessions/:id/retry', (req, res) => {
  const s = mustSession(req);
  pipeline.retry(s.id);
  res.json(publicSession(store.getSession(s.id)));
});

app.post('/api/sessions/:id/reveal', (req, res) => {
  const s = mustSession(req);
  const folder = s.output?.folder;
  if (!folder || !fs.existsSync(folder)) throw fail(404, 'Output folder not found');
  if (process.platform === 'darwin') execFile('open', [folder]);
  else if (process.platform === 'win32') execFile('explorer', [folder]);
  else execFile('xdg-open', [folder]);
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', (req, res) => {
  const s = mustSession(req);
  if (pipeline.isBusy(s.id)) throw fail(409, 'Busy, please wait.');
  store.deleteSession(s.id);
  res.json({ ok: true });
});

/* ---------------- SoundCloud OAuth ---------------- */

app.get('/auth/soundcloud', (req, res) => {
  try {
    res.redirect(sc.authorizeUrl());
  } catch (err) {
    res.redirect(`/#/settings?sc_error=${encodeURIComponent(err.message)}`);
  }
});

app.get('/auth/soundcloud/callback', async (req, res) => {
  const back = String(req.query.state || '');
  if (req.query.error) return res.redirect(`/#/settings?sc_error=${encodeURIComponent(req.query.error_description || req.query.error)}`);
  try {
    await sc.handleCallback({ code: String(req.query.code || ''), state: back });
    res.redirect('/#/settings?sc=connected');
  } catch (err) {
    res.redirect(`/#/settings?sc_error=${encodeURIComponent(err.message)}`);
  }
});

app.post('/api/soundcloud/disconnect', (req, res) => {
  sc.disconnect();
  res.json(sc.status());
});

/* ---------------- app lifecycle ---------------- */

const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

// Lets the desktop launcher's background server be stopped from Settings.
app.post('/api/shutdown', (req, res) => {
  if (!isLocal(req)) throw fail(403, 'Mix Cutter can only be stopped from the computer it runs on.');
  if (pipeline.anyBusy() && !req.body?.force) throw fail(409, 'Mix Cutter is still working on a session. Wait for it to finish, or stop anyway.');
  res.json({ ok: true });
  console.log('Stopping (requested from Settings)');
  setTimeout(() => process.exit(0), 200);
});

/* ---------------- errors ---------------- */

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  Mix Cutter is running`);
  console.log(`  Desktop:  http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') for (const ip of lanAddresses()) console.log(`  Phone:    http://${ip}:${PORT}`);
  if (scConfig.dryRun) console.log('  SoundCloud: DRY RUN (uploads are simulated)');
  else if (!sc.isConfigured()) console.log('  SoundCloud: not configured (add credentials to .env)');
  console.log('');
});
