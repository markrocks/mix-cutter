/**
 * Song detection: pure functions over per-second features.
 *
 * Idea: in a practice-room recording, a full band playing is (a) much louder
 * than talking and (b) *sustained*: it rarely drops to the noise floor
 * between 50 ms frames. Speech is choppy: syllables, pauses, breaths.
 *
 * Per second we have:
 *   loud[i] - mean energy in dBFS
 *   ler[i]  - "low energy ratio": fraction of 50 ms frames well below the
 *             second's mean level (high for speech, low for music)
 *
 * We smooth both, combine them into one "music level", pick a threshold
 * automatically (Otsu's method on the level histogram), then turn the
 * above-threshold seconds into song regions, bridge short gaps (a quiet
 * breakdown inside a song), and drop anything too short to be a song.
 */

export const DEFAULT_DETECTION = {
  sensitivity: 0, // dB. Positive = more permissive (quieter passages count as music)
  minSongSec: 45, // anything shorter is discarded
  mergeGapSec: 8, // gaps shorter than this inside a song are bridged
  padStartSec: 1.5, // include the count-in
  padEndSec: 2.5, // let the last chord ring out
  smoothSec: 5, // smoothing window for the level curve
};

const LER_WEIGHT_DB = 20; // dB of level adjustment per unit of LER deviation
const LER_PIVOT = 0.3;

export function detectSongs(features, params = {}) {
  const p = { ...DEFAULT_DETECTION, ...params };
  const { loud, ler, duration } = features;
  const n = loud.length;
  if (!n) return { segments: [], threshold: null };

  const win = Math.max(1, Math.round(p.smoothSec)) | 1; // odd
  const loudS = medianFilter(loud, win);
  const lerS = meanFilter(ler, win);

  // Combined level: penalize choppy (speech-like) seconds, boost sustained ones.
  const level = new Float64Array(n);
  for (let i = 0; i < n; i++) level[i] = loudS[i] - LER_WEIGHT_DB * (lerS[i] - LER_PIVOT);

  // Ignore deep silence when choosing the threshold, or Otsu would just
  // separate "silence" from "everything else".
  const sorted = Array.from(level).sort((a, b) => a - b);
  const top = quantile(sorted, 0.98);
  const floor = Math.max(quantile(sorted, 0.02), top - 40);
  const considered = sorted.filter((v) => v >= floor);
  const base = otsu(considered.length >= 10 ? considered : sorted);
  const threshold = base - p.sensitivity;

  const isMusic = new Uint8Array(n);
  for (let i = 0; i < n; i++) isMusic[i] = level[i] > threshold ? 1 : 0;

  // Runs of music seconds -> [start, end)
  let runs = [];
  for (let i = 0; i < n; ) {
    if (!isMusic[i]) { i++; continue; }
    let j = i;
    while (j < n && isMusic[j]) j++;
    runs.push({ start: i, end: j });
    i = j;
  }

  // Bridge short gaps.
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < p.mergeGapSec) last.end = r.end;
    else merged.push({ ...r });
  }
  runs = merged.filter((r) => r.end - r.start >= p.minSongSec);

  // Confidence: how far above threshold, on average.
  const segments = runs.map((r) => {
    let acc = 0;
    for (let i = r.start; i < r.end; i++) acc += clamp((level[i] - threshold) / 8, 0, 1);
    return {
      start: Math.max(0, r.start - p.padStartSec),
      end: Math.min(duration ?? n, r.end + p.padEndSec),
      confidence: Math.round((acc / (r.end - r.start)) * 100) / 100,
    };
  });

  // Padding must not make neighbours overlap: split the difference.
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1];
    const b = segments[i];
    if (a.end > b.start) {
      const mid = (runs[i - 1].end + runs[i].start) / 2;
      a.end = mid;
      b.start = mid;
    }
  }

  for (const s of segments) {
    s.start = round1(s.start);
    s.end = round1(s.end);
  }
  return { segments, threshold: round1(threshold) };
}

/* ---------------- helpers ---------------- */

export function otsu(values, bins = 128) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) return lo;
  const hist = new Float64Array(bins);
  const w = (hi - lo) / bins;
  for (const v of values) hist[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestIdx = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; bestIdx = i; }
  }
  return lo + (bestIdx + 1) * w;
}

export function medianFilter(arr, win) {
  const half = win >> 1;
  const out = new Float64Array(arr.length);
  const buf = [];
  for (let i = 0; i < arr.length; i++) {
    buf.length = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(arr.length - 1, i + half); k++) buf.push(arr[k]);
    buf.sort((a, b) => a - b);
    out[i] = buf[buf.length >> 1];
  }
  return out;
}

export function meanFilter(arr, win) {
  const half = win >> 1;
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(arr.length - 1, i + half); k++) { s += arr[k]; c++; }
    out[i] = s / c;
  }
  return out;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
