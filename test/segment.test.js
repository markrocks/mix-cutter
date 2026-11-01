import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSongs, otsu } from '../server/segment.js';

/** Build per-second features from a [{kind, sec}] script. */
function features(script) {
  const loud = [];
  const ler = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const { kind, sec } of script) {
    for (let i = 0; i < sec; i++) {
      if (kind === 'song') { loud.push(-14 + rnd() * 3); ler.push(0.05 + rnd() * 0.1); }
      else if (kind === 'quiet') { loud.push(-30 + rnd() * 2); ler.push(0.1); }
      else if (kind === 'silence') { loud.push(-90); ler.push(0); }
      else { loud.push(-32 + rnd() * 6); ler.push(0.35 + rnd() * 0.25); }
    }
  }
  return { loud, ler, duration: loud.length };
}

test('finds songs between talking', () => {
  const f = features([
    { kind: 'talk', sec: 30 }, { kind: 'song', sec: 180 }, { kind: 'talk', sec: 60 },
    { kind: 'song', sec: 240 }, { kind: 'talk', sec: 20 },
  ]);
  const { segments } = detectSongs(f);
  assert.equal(segments.length, 2);
  assert.ok(Math.abs(segments[0].start - 28.5) <= 3, `start ${segments[0].start}`);
  assert.ok(Math.abs(segments[0].end - 212.5) <= 3, `end ${segments[0].end}`);
  assert.ok(Math.abs(segments[1].start - 268.5) <= 3);
});

test('bridges a short breakdown inside a song', () => {
  const f = features([
    { kind: 'talk', sec: 20 }, { kind: 'song', sec: 90 }, { kind: 'quiet', sec: 4 },
    { kind: 'song', sec: 90 }, { kind: 'talk', sec: 20 },
  ]);
  assert.equal(detectSongs(f).segments.length, 1);
});

test('drops short noodling below the minimum song length', () => {
  const f = features([
    { kind: 'talk', sec: 40 }, { kind: 'song', sec: 15 }, { kind: 'talk', sec: 40 },
    { kind: 'song', sec: 120 }, { kind: 'talk', sec: 30 },
  ]);
  const { segments } = detectSongs(f, { minSongSec: 45 });
  assert.equal(segments.length, 1);
  assert.ok(segments[0].start > 90);
});

test('deep silence does not confuse the threshold', () => {
  const f = features([
    { kind: 'silence', sec: 120 }, { kind: 'talk', sec: 30 }, { kind: 'song', sec: 150 },
    { kind: 'talk', sec: 30 }, { kind: 'silence', sec: 200 },
  ]);
  assert.equal(detectSongs(f).segments.length, 1);
});

test('segments never overlap after padding', () => {
  const f = features([
    { kind: 'song', sec: 100 }, { kind: 'talk', sec: 9 }, { kind: 'song', sec: 100 },
  ]);
  const { segments } = detectSongs(f, { mergeGapSec: 2, padStartSec: 5, padEndSec: 5 });
  assert.equal(segments.length, 2);
  assert.ok(segments[0].end <= segments[1].start);
});

test('otsu splits a bimodal distribution', () => {
  const vals = [...Array(100).fill(-30), ...Array(100).fill(-10)];
  const t = otsu(vals);
  assert.ok(t > -30 && t < -10);
});
