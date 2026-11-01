import { fmtClock } from './util.js';

const RULER = 22; // px reserved for the time ruler
const EDGE_HIT = 8; // px tolerance for grabbing a song edge
const MIN_SPAN = 4; // seconds: maximum zoom
const MIN_SONG = 1; // seconds

/**
 * Canvas waveform with song regions you can select, resize by dragging
 * their edges, zoom (wheel / pinch-ish buttons), and pan (drag background).
 * An optional overview canvas shows the whole recording and the visible window.
 */
export class Waveform {
  constructor(canvas, overview, { peaks, peakRate, duration, onSeek, onSelect, onChange, onEditing }) {
    this.c = canvas;
    this.o = overview;
    this.peaks = peaks;
    this.rate = peakRate;
    this.duration = duration;
    this.segments = [];
    this.selectedId = null;
    this.playhead = 0;
    this.hoverX = null;
    this.view = [0, duration];
    Object.assign(this, { onSeek, onSelect, onChange, onEditing });
    this._bind();
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(canvas);
  }

  destroy() { this._ro.disconnect(); }

  /* ---------- public API ---------- */
  setSegments(segs) { this.segments = segs; this.draw(); }
  select(id) { this.selectedId = id; this.draw(); }
  setPlayhead(t) {
    this.playhead = t;
    // Keep the playhead in view while playing (page-turn style).
    const [a, b] = this.view;
    if (this.follow && (t < a || t > b)) {
      const span = b - a;
      this._setView(t - span * 0.05, t + span * 0.95);
    }
    this.draw();
  }
  fit() { this._setView(0, this.duration); }
  zoomTo(a, b) {
    const pad = Math.max(2, (b - a) * 0.08);
    this._setView(a - pad, b + pad);
  }
  zoomBy(factor, centerT) {
    const [a, b] = this.view;
    const c = centerT ?? (this.playhead >= a && this.playhead <= b ? this.playhead : (a + b) / 2);
    const span = Math.min(this.duration, Math.max(MIN_SPAN, (b - a) * factor));
    const ratio = (c - a) / (b - a);
    this._setView(c - span * ratio, c - span * ratio + span);
  }

  /* ---------- geometry ---------- */
  get w() { return this.c.clientWidth; }
  get h() { return this.c.clientHeight; }
  t2x(t) { const [a, b] = this.view; return ((t - a) / (b - a)) * this.w; }
  x2t(x) { const [a, b] = this.view; return a + (x / this.w) * (b - a); }

  _setView(a, b) {
    let span = Math.min(this.duration, Math.max(MIN_SPAN, b - a));
    a = Math.max(0, Math.min(a, this.duration - span));
    this.view = [a, a + span];
    this.draw();
  }

  _hitEdge(x) {
    // Prefer the selected song's edges when edges are close together.
    const order = [...this.segments].sort((s1, s2) => (s2.id === this.selectedId) - (s1.id === this.selectedId));
    let best = null;
    for (const s of order) {
      for (const edge of ['start', 'end']) {
        const d = Math.abs(this.t2x(s[edge]) - x);
        if (d <= EDGE_HIT && (!best || d < best.d)) best = { seg: s, edge, d };
      }
    }
    return best;
  }
  _segAt(t) { return this.segments.find((s) => t >= s.start && t <= s.end); }

  /* ---------- interaction ---------- */
  _bind() {
    const c = this.c;
    const pos = (e) => e.clientX - c.getBoundingClientRect().left;
    let drag = null;

    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      const x = pos(e);
      const hit = this.locked ? null : this._hitEdge(x);
      if (hit) {
        drag = { kind: 'edge', ...hit, moved: false };
        this.selectedId = hit.seg.id;
        this.onSelect?.(hit.seg.id, false);
      } else {
        drag = { kind: 'pan', x0: x, view0: [...this.view], moved: false };
        c.style.cursor = 'grabbing';
      }
    });

    c.addEventListener('pointermove', (e) => {
      const x = pos(e);
      this.hoverX = x;
      if (!drag) {
        c.style.cursor = !this.locked && this._hitEdge(x) ? 'ew-resize' : 'grab';
        this.draw();
        return;
      }
      if (drag.kind === 'edge') {
        drag.moved = true;
        const s = drag.seg;
        const sorted = [...this.segments].sort((p, q) => p.start - q.start);
        const i = sorted.indexOf(s);
        const prevEnd = i > 0 ? sorted[i - 1].end : 0;
        const nextStart = i < sorted.length - 1 ? sorted[i + 1].start : this.duration;
        let t = Math.round(this.x2t(x) * 10) / 10;
        if (drag.edge === 'start') s.start = Math.max(prevEnd, Math.min(t, s.end - MIN_SONG));
        else s.end = Math.min(nextStart, Math.max(t, s.start + MIN_SONG));
        this.onEditing?.(s);
        this.draw();
      } else {
        const dx = x - drag.x0;
        if (Math.abs(dx) > 3) drag.moved = true;
        const [a, b] = drag.view0;
        const dt = (dx / this.w) * (b - a);
        this._setView(a - dt, b - dt);
      }
    });

    const end = (e) => {
      if (!drag) return;
      const x = pos(e);
      if (drag.kind === 'edge' && drag.moved) this.onChange?.(drag.seg);
      if (drag.kind === 'pan' && !drag.moved) {
        const t = Math.max(0, Math.min(this.duration, this.x2t(x)));
        const seg = this._segAt(t);
        if (seg) { this.selectedId = seg.id; this.onSelect?.(seg.id, false); }
        this.onSeek?.(t);
      }
      drag = null;
      c.style.cursor = 'grab';
      this.draw();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', () => { drag = null; });
    c.addEventListener('pointerleave', () => { this.hoverX = null; this.draw(); });

    c.addEventListener('dblclick', (e) => {
      const seg = this._segAt(this.x2t(pos(e)));
      if (seg) this.zoomTo(seg.start, seg.end);
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [a, b] = this.view;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const dt = (e.deltaX / this.w) * (b - a);
        this._setView(a + dt, b + dt);
      } else {
        this.zoomBy(Math.exp(e.deltaY * 0.0025), this.x2t(pos(e)));
      }
    }, { passive: false });

    // Overview: click/drag to move the visible window.
    if (this.o) {
      let down = false;
      const jump = (e) => {
        const x = e.clientX - this.o.getBoundingClientRect().left;
        const t = (x / this.o.clientWidth) * this.duration;
        const span = this.view[1] - this.view[0];
        this._setView(t - span / 2, t + span / 2);
      };
      this.o.addEventListener('pointerdown', (e) => { down = true; this.o.setPointerCapture(e.pointerId); jump(e); });
      this.o.addEventListener('pointermove', (e) => down && jump(e));
      this.o.addEventListener('pointerup', () => (down = false));
    }
  }

  /* ---------- drawing ---------- */
  _colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return {
      wave: v('--wave'), waveIn: v('--wave-in'), ink: v('--ink'), ink3: v('--ink-3'),
      line: v('--line'), accent: v('--accent'), surface2: v('--surface-2'), bg: v('--surface'),
    };
  }

  _prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  /** Max peak per pixel column for a time window. */
  _columns(w, a, b) {
    const cols = new Float32Array(Math.ceil(w));
    const per = (b - a) / w;
    for (let x = 0; x < cols.length; x++) {
      const t0 = a + x * per;
      const i0 = Math.floor(t0 * this.rate);
      const i1 = Math.max(i0 + 1, Math.ceil((t0 + per) * this.rate));
      let m = 0;
      for (let i = i0; i < i1 && i < this.peaks.length; i++) if (this.peaks[i] > m) m = this.peaks[i];
      cols[x] = Math.pow(m, 0.75);
    }
    return cols;
  }

  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); this._drawOverview(); });
  }

  _draw() {
    const { ctx, w, h } = this._prep(this.c);
    if (!w) return;
    const col = this._colors();
    const [a, b] = this.view;
    const waveTop = RULER + 4;
    const waveH = h - waveTop - 2;
    const mid = waveTop + waveH / 2;

    // Song regions (background)
    for (const s of this.segments) {
      const x0 = this.t2x(s.start), x1 = this.t2x(s.end);
      if (x1 < 0 || x0 > w) continue;
      const sel = s.id === this.selectedId;
      ctx.fillStyle = s.include ? hexA(col.accent, sel ? 0.2 : 0.09) : hexA(col.ink3, 0.08);
      ctx.fillRect(x0, waveTop, x1 - x0, waveH);
    }

    // Waveform
    const cols = this._columns(w, a, b);
    const inSong = (t) => this.segments.some((s) => s.include && t >= s.start && t <= s.end);
    const per = (b - a) / w;
    for (let x = 0; x < cols.length; x++) {
      const v = cols[x] * (waveH / 2 - 2);
      ctx.fillStyle = inSong(a + (x + 0.5) * per) ? col.waveIn : col.wave;
      ctx.fillRect(x, mid - v, 1, Math.max(1, v * 2));
    }

    // Song edges + labels
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'top';
    const sorted = [...this.segments].sort((p, q) => p.start - q.start);
    let n = 0;
    for (const s of sorted) {
      if (s.include) n++;
      const x0 = this.t2x(s.start), x1 = this.t2x(s.end);
      if (x1 < 0 || x0 > w) continue;
      const sel = s.id === this.selectedId;
      const edgeColor = s.include ? col.accent : col.ink3;
      ctx.fillStyle = edgeColor;
      ctx.fillRect(x0 - (sel ? 1 : 0.5), waveTop, sel ? 2 : 1, waveH);
      ctx.fillRect(x1 - (sel ? 1 : 0.5), waveTop, sel ? 2 : 1, waveH);
      if (sel) {
        for (const x of [x0, x1]) roundRect(ctx, x - 4, mid - 14, 8, 28, 3, edgeColor);
      }
      // label tab
      const text = s.include ? `${n}  ${s.label}` : `${s.label} (skipped)`;
      const room = x1 - Math.max(0, x0) - 10;
      if (room > 18) {
        const tx = Math.max(0, x0) + 5;
        const label = truncate(ctx, text, room);
        const tw = ctx.measureText(label).width + 10;
        roundRect(ctx, tx - 2, waveTop + 4, tw, 17, 4, s.include ? col.accent : col.ink3);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, tx + 3, waveTop + 7);
      }
    }

    // Ruler
    ctx.fillStyle = col.line;
    ctx.fillRect(0, RULER, w, 1);
    const step = niceStep((b - a) / Math.max(1, w / 90));
    ctx.fillStyle = col.ink3;
    ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'alphabetic';
    for (let t = Math.ceil(a / step) * step; t <= b; t += step) {
      const x = this.t2x(t);
      ctx.fillRect(x, RULER - 5, 1, 5);
      ctx.fillText(fmtClock(t), x + 3, RULER - 7);
    }

    // Hover + playhead
    if (this.hoverX != null) {
      ctx.fillStyle = hexA(col.ink, 0.25);
      ctx.fillRect(this.hoverX, waveTop, 1, waveH);
    }
    const px = this.t2x(this.playhead);
    if (px >= 0 && px <= w) {
      ctx.fillStyle = col.ink;
      ctx.fillRect(px - 1, RULER - 2, 2, h - RULER + 2);
      ctx.beginPath();
      ctx.moveTo(px - 5, RULER - 7); ctx.lineTo(px + 5, RULER - 7); ctx.lineTo(px, RULER - 1);
      ctx.fill();
    }
  }

  _drawOverview() {
    if (!this.o) return;
    const { ctx, w, h } = this._prep(this.o);
    if (!w) return;
    const col = this._colors();
    ctx.fillStyle = col.surface2;
    ctx.fillRect(0, 0, w, h);
    const sx = (t) => (t / this.duration) * w;
    for (const s of this.segments) {
      ctx.fillStyle = s.include ? hexA(col.accent, 0.35) : hexA(col.ink3, 0.2);
      ctx.fillRect(sx(s.start), 0, Math.max(1, sx(s.end) - sx(s.start)), h);
    }
    const cols = this._columns(w, 0, this.duration);
    ctx.fillStyle = hexA(col.ink, 0.35);
    for (let x = 0; x < cols.length; x++) {
      const v = cols[x] * (h / 2 - 3);
      ctx.fillRect(x, h / 2 - v, 1, Math.max(1, v * 2));
    }
    const [a, b] = this.view;
    if (b - a < this.duration - 0.01) {
      ctx.strokeStyle = col.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx(a) + 0.75, 0.75, Math.max(3, sx(b) - sx(a)) - 1.5, h - 1.5);
    }
    ctx.fillStyle = col.ink;
    ctx.fillRect(sx(this.playhead), 0, 1, h);
  }
}

function niceStep(raw) {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  return steps.find((s) => s >= raw) || 7200;
}

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  ctx.fill();
}

function truncate(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Apply alpha to a #rrggbb or rgb() colour string. */
function hexA(color, alpha) {
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const m = color.match(/\d+(\.\d+)?/g);
  return m ? `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})` : color;
}
