/**
 * The three-step pipeline: analyze -> (review) -> cut & save -> upload.
 * Each step runs in the background and reports progress on the session.
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractFeatures, probe } from './analyze.js';
import { cutSession } from './cutter.js';
import { detectSongs } from './segment.js';
import * as sc from './soundcloud.js';
import { featuresFile, getSession, getSettings, previewFile, readJson, sessionDir, updateSession, writeJson } from './store.js';
import { fmtClock } from './util.js';

const running = new Set();

export const isBusy = (id) => running.has(id);
export const anyBusy = () => running.size > 0;

/**
 * Run one background step with a per-session lock. The status is set
 * synchronously so the HTTP response (and the UI's polling) sees it at once.
 */
function guard(id, status, message, fn) {
  if (running.has(id)) throw Object.assign(new Error('This session is already working on something.'), { status: 409 });
  running.add(id);
  setProgress(id, status, 0, message);
  let next = null;
  Promise.resolve()
    .then(fn)
    .then((n) => (next = typeof n === 'function' ? n : null))
    .catch((err) => {
      console.error(`[${id}]`, err);
      updateSession(id, (s) => {
        s.error = { stage: s.status, message: friendly(err.message) };
        s.status = 'error';
        s.progress = null;
      });
    })
    .finally(() => {
      running.delete(id);
      // A step may hand back the next step (auto mode); start it once our lock is released.
      if (next) {
        try { next(); } catch (err) { console.error(`[${id}]`, err); }
      }
    });
}

const setProgress = (id, status, pct, message) =>
  updateSession(id, (s) => {
    s.status = status;
    s.error = null;
    s.progress = { pct: Math.round(pct * 100), message };
  });

/** Strip internal file paths and ffmpeg noise from error messages shown to users. */
function friendly(msg) {
  return String(msg)
    .replace(/\/[^\s:'"]+\/(source\.[a-z0-9]+)/gi, '$1')
    .replace(/\[[a-z0-9_]+ @ 0x[0-9a-f]+\]\s*/gi, '')
    .replace(/\s*\n\s*/g, ' ')
    .slice(0, 400);
}

export const sourcePath = (s) => path.join(sessionDir(s.id), s.source.file);

/* ---------------- Step 2a: analyze ---------------- */

export function startAnalysis(id) {
  guard(id, 'analyzing', 'Reading file…', async () => {
    const s = getSession(id);
    let info;
    try {
      info = await probe(sourcePath(s));
    } catch (err) {
      throw new Error(`This file couldn't be read as audio. It may be damaged or in an unsupported format. (${err.message})`);
    }
    updateSession(id, (x) => Object.assign(x.source, info));

    setProgress(id, 'analyzing', 0.02, 'Listening for songs…');
    const features = await extractFeatures(sourcePath(s), {
      duration: info.duration,
      previewPath: previewFile(id),
      onProgress: (p) => setProgress(id, 'analyzing', p, `Listening for songs… ${fmtClock(p * info.duration)} of ${fmtClock(info.duration)}`),
    });
    writeJson(featuresFile(id), features);

    const params = s.detection || getSettings().detection;
    const { segments, threshold } = detectSongs(features, params);
    updateSession(id, (x) => {
      x.source.duration = features.duration || info.duration;
      x.detection = { ...params, threshold };
      x.segments = labelSegments(segments);
      x.status = 'review';
      x.progress = null;
    });

    if (getSession(id).mode === 'auto') {
      if (!getSession(id).segments.length) {
        updateSession(id, (x) => (x.notice = 'No songs were detected, so automatic mode stopped here for you to review.'));
        return;
      }
      return () => startCut(id, { upload: true });
    }
  });
}

/** Re-run detection with new parameters (fast: reuses saved features). */
export function redetect(id, params) {
  const features = readJson(featuresFile(id), null);
  if (!features) throw new Error('Analysis data missing. Re-run analysis.');
  const { segments, threshold } = detectSongs(features, params);
  return updateSession(id, (s) => {
    s.detection = { ...params, threshold };
    s.segments = labelSegments(segments);
    s.segmentsEditedAt = new Date().toISOString();
    s.notice = null;
  });
}

let segCounter = 0;
export const segId = () => `g${Date.now().toString(36)}${(segCounter++).toString(36)}`;

export function labelSegments(segments) {
  return segments.map((seg, i) => ({
    id: segId(),
    label: `Song ${i + 1}`,
    autoLabel: true,
    include: true,
    ...seg,
  }));
}

/* ---------------- Step 2b: cut & save ---------------- */

export function startCut(id, { upload = false } = {}) {
  guard(id, 'cutting', 'Preparing…', async () => {
    const s = getSession(id);
    const output = await cutSession(s, sourcePath(s), {
      outputDir: getSettings().outputDir,
      onProgress: (p, msg) => setProgress(id, 'cutting', p, msg),
    });
    updateSession(id, (x) => {
      x.output = output;
      x.status = 'saved';
      x.progress = null;
      // New cut = previous uploads are stale.
      x.soundcloud = null;
    });

    if (upload) {
      if (!sc.status().connected) {
        updateSession(id, (x) => (x.notice = 'Files saved. Connect SoundCloud to upload them.'));
        return;
      }
      return () => startUpload(id);
    }
  });
}

/* ---------------- Step 3: upload ---------------- */

export function startUpload(id) {
  guard(id, 'uploading', 'Starting upload…', async () => {
    const s = getSession(id);
    if (!s.output?.files?.length) throw new Error('Save the songs before uploading.');
    const folder = s.output.folder;
    const prior = s.soundcloud?.tracks || [];
    const tracks = s.output.files.map((f) => {
      const done = prior.find((t) => t.file === f.file && t.status === 'done');
      if (done) {
        // Repair links saved by older versions (token appended after ?utm_ params).
        done.shareUrl = sc.cleanShareUrl(done.shareUrl);
        done.permalink_url = sc.cleanShareUrl(done.permalink_url);
        return done;
      }
      return { file: f.file, n: f.n, label: f.label, status: 'pending' };
    });
    updateSession(id, (x) => {
      x.soundcloud = { ...(x.soundcloud || {}), tracks, playlist: x.soundcloud?.playlist || null };
      x.notice = null;
    });

    const total = tracks.length;
    for (let i = 0; i < total; i++) {
      const t = tracks[i];
      if (t.status === 'done') continue;
      const f = s.output.files[i];
      setProgress(id, 'uploading', i / (total + 1), `Uploading ${i + 1} of ${total}: ${f.label}`);
      if (!fs.existsSync(path.join(folder, f.file))) throw new Error(`File not found: ${f.file}`);
      updateSession(id, () => (t.status = 'uploading'));
      try {
        const res = await sc.uploadTrack({
          file: path.join(folder, f.file),
          title: `${f.label} - ${s.band} practice ${s.date}`,
          description: [
            `${s.band} practice, ${s.date}. Starts at ${fmtClock(f.start)} in the recording.`,
            s.notes,
          ].filter(Boolean).join('\n\n'),
          tags: `"${s.band}" practice rehearsal`,
          sharing: 'private',
        });
        updateSession(id, () => Object.assign(t, { status: 'done', error: null, ...res }));
      } catch (err) {
        updateSession(id, () => Object.assign(t, { status: 'error', error: err.message }));
        throw err;
      }
    }

    setProgress(id, 'uploading', total / (total + 1), 'Creating playlist…');
    const playlist = await sc.createPlaylist({
      title: `${s.band} - Practice ${s.date}`,
      description: s.notes || `${s.band} practice session, ${s.date}`,
      trackUrns: tracks.map((t) => sc.trackUrn(t)),
      sharing: 'private',
    });
    updateSession(id, (x) => {
      x.soundcloud.playlist = playlist;
      x.soundcloud.uploadedAt = new Date().toISOString();
      x.status = 'done';
      x.progress = null;
    });
  });
}

/** Retry whatever failed last. */
export function retry(id) {
  const s = getSession(id);
  const stage = s.error?.stage;
  if (stage === 'uploading') return startUpload(id);
  if (stage === 'cutting') return startCut(id, { upload: s.mode === 'auto' });
  return startAnalysis(id);
}
