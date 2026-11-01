import { spawn } from 'node:child_process';
import { FFMPEG, FFPROBE } from './config.js';

const SR = 8000; // analysis sample rate (energy only, so 8 kHz is plenty)
const FRAME = 400; // 50 ms frames
const FRAMES_PER_SEC = SR / FRAME; // 20
const PEAK_RATE = 10; // waveform peaks per second (100 ms buckets)
const FRAMES_PER_PEAK = FRAMES_PER_SEC / PEAK_RATE; // 2

export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim().slice(-500)}`)),
    );
  });
}

export async function probe(file) {
  const json = await run(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'format=duration,format_name:stream=codec_name,sample_rate,channels,duration',
    '-of', 'json',
    file,
  ]);
  const info = JSON.parse(json);
  const stream = info.streams?.[0];
  if (!stream) throw new Error('No audio track found in this file.');
  const duration = Number(info.format?.duration || stream.duration || 0);
  return {
    duration,
    codec: stream.codec_name,
    sampleRate: Number(stream.sample_rate) || null,
    channels: stream.channels || null,
    container: info.format?.format_name,
  };
}

/**
 * Decode the file once with ffmpeg and, in the same pass:
 *   - stream mono 8 kHz float PCM to us for feature extraction
 *   - write a lightweight MP3 preview the browser can always play and seek
 */
export function extractFeatures(file, { duration, previewPath, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', file,
      '-map', '0:a:0', '-ac', '1', '-ar', String(SR), '-f', 'f32le', 'pipe:1',
    ];
    if (previewPath) {
      // Review-only preview: mono 22 kHz, fastest LAME preset (~5x faster than 128k stereo).
      // Final songs are always cut from the original file at full quality.
      args.push('-map', '0:a:0', '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '64k', '-compression_level', '9', previewPath);
    }
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const frameEnergy = []; // mean square per 50 ms frame
    const framePeak = [];
    let acc = 0, peak = 0, inFrame = 0;
    let remainder = Buffer.alloc(0);
    let samples = 0;
    const totalSamples = duration ? duration * SR : 0;
    let lastReport = 0;
    let stderr = '';

    p.stdout.on('data', (chunk) => {
      const buf = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
      const usable = buf.length - (buf.length % 4);
      // Copy into an aligned Float32Array (stdout chunks can start at odd offsets).
      const f32 = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable));
      for (let k = 0; k < f32.length; k++) {
        const v = f32[k];
        acc += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        if (++inFrame === FRAME) {
          frameEnergy.push(acc / FRAME);
          framePeak.push(peak);
          acc = 0; peak = 0; inFrame = 0;
        }
      }
      samples += usable / 4;
      remainder = buf.subarray(usable);
      if (onProgress && totalSamples && samples - lastReport > SR * 30) {
        lastReport = samples;
        onProgress(Math.min(0.99, samples / totalSamples));
      }
    });
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed (${code}): ${stderr.trim().slice(-500)}`));
      if (inFrame > 0) { frameEnergy.push(acc / inFrame); framePeak.push(peak); }
      resolve(summarize(frameEnergy, framePeak, samples / SR));
    });
  });
}

/** Turn 50 ms frames into per-second features and 100 ms waveform peaks. */
export function summarize(frameEnergy, framePeak, duration) {
  const loud = [];
  const ler = [];
  for (let i = 0; i < frameEnergy.length; i += FRAMES_PER_SEC) {
    const slice = frameEnergy.slice(i, i + FRAMES_PER_SEC);
    const meanE = slice.reduce((a, b) => a + b, 0) / slice.length;
    loud.push(Math.round(10 * Math.log10(meanE + 1e-10) * 10) / 10);
    // Low-energy ratio on RMS: fraction of frames with RMS < 50% of the mean RMS.
    const rms = slice.map(Math.sqrt);
    const meanR = rms.reduce((a, b) => a + b, 0) / rms.length;
    const low = rms.filter((r) => r < 0.5 * meanR).length;
    ler.push(Math.round((low / rms.length) * 100) / 100);
  }
  const peaks = [];
  for (let i = 0; i < framePeak.length; i += FRAMES_PER_PEAK) {
    let m = 0;
    for (let k = i; k < Math.min(i + FRAMES_PER_PEAK, framePeak.length); k++) if (framePeak[k] > m) m = framePeak[k];
    peaks.push(Math.round(Math.min(1, m) * 1000) / 1000);
  }
  return { duration, featureRate: 1, loud, ler, peakRate: PEAK_RATE, peaks };
}
