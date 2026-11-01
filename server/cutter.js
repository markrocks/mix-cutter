import fs from 'node:fs';
import path from 'node:path';
import { FFMPEG } from './config.js';
import { run } from './analyze.js';
import { fmtClock, fmtStamp, pad2, safeName } from './util.js';

export function folderFor(session, outputDir) {
  const band = safeName(session.band, 'Unknown Band');
  return path.join(outputDir, band, safeName(`${session.date} - ${band} Practice`));
}

function uniqueFolder(base) {
  if (!fs.existsSync(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not find a free folder name');
}

export function songFileName(n, label, start) {
  return `${pad2(n)} - ${safeName(label, `Song ${n}`)} (${fmtStamp(start)}).mp3`;
}

/**
 * Cut every included segment out of the source into a 320k MP3 with tags.
 * Re-cutting a session reuses its folder and replaces the files it wrote before.
 */
export async function cutSession(session, sourcePath, { outputDir, onProgress }) {
  const songs = session.segments.filter((s) => s.include).sort((a, b) => a.start - b.start);
  if (!songs.length) throw new Error('There are no songs selected to save.');

  let folder = session.output?.folder;
  if (folder && fs.existsSync(folder)) {
    for (const f of session.output.files || []) fs.rmSync(path.join(folder, f.file), { force: true });
  } else {
    folder = uniqueFolder(folderFor(session, outputDir));
  }
  fs.mkdirSync(folder, { recursive: true });

  const album = `${session.band} - Practice ${session.date}`;
  const files = [];
  for (let i = 0; i < songs.length; i++) {
    const seg = songs[i];
    const n = i + 1;
    const dur = Math.max(0.5, seg.end - seg.start);
    const file = songFileName(n, seg.label, seg.start);
    const fadeOut = Math.min(1.5, dur / 4);
    const comment = [`Recorded ${session.date} at ${fmtClock(seg.start)}`, session.notes].filter(Boolean).join(' | ');
    onProgress?.(i / songs.length, `Saving ${file}`);
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-ss', seg.start.toFixed(3),
      '-i', sourcePath,
      '-t', dur.toFixed(3),
      '-map', '0:a:0',
      '-af', `afade=t=in:st=0:d=0.25,afade=t=out:st=${(dur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`,
      '-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '44100',
      '-id3v2_version', '3',
      '-metadata', `title=${seg.label}`,
      '-metadata', `artist=${session.band}`,
      '-metadata', `album_artist=${session.band}`,
      '-metadata', `album=${album}`,
      '-metadata', `track=${n}/${songs.length}`,
      '-metadata', `date=${session.date.slice(0, 4)}`,
      '-metadata', `comment=${comment}`,
      path.join(folder, file),
    ]);
    files.push({ segmentId: seg.id, n, label: seg.label, file, start: seg.start, end: seg.end });
  }

  fs.writeFileSync(path.join(folder, 'Session Info.txt'), sessionInfo(session, files));
  onProgress?.(1, 'Saved');
  return { folder, files, savedAt: new Date().toISOString() };
}

function sessionInfo(session, files) {
  const lines = [
    `Band:      ${session.band}`,
    `Date:      ${session.date}`,
    `Recording: ${session.source.originalName} (${fmtClock(session.source.duration)})`,
  ];
  if (session.notes) lines.push('', 'Notes:', session.notes);
  lines.push('', 'Songs:');
  for (const f of files) {
    lines.push(`  ${pad2(f.n)}. ${f.label.padEnd(28)} ${fmtClock(f.start)} - ${fmtClock(f.end)}  (${fmtClock(f.end - f.start)})`);
  }
  lines.push('', `Created by Mix Cutter on ${new Date().toLocaleString()}`);
  return lines.join('\n') + '\n';
}
