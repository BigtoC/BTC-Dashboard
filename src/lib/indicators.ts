// Pure technical-indicator math. Ported 1:1 from the original dashboard so the
// numeric output is identical regardless of data source.
import type { Candle } from './types';

export const closes = (ks: Candle[]): number[] => ks.map((k) => k.c);

export function clamp(x: number, a = -1, b = 1): number {
  return Math.max(a, Math.min(b, x));
}

export function emaSeries(a: number[], p: number): number[] | null {
  if (a.length < p) return null;
  const k = 2 / (p + 1);
  let e = a.slice(0, p).reduce((x, y) => x + y, 0) / p;
  const out = [e];
  for (let i = p; i < a.length; i++) {
    e = a[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

export function emaLast(a: number[], p: number): number | null {
  const s = emaSeries(a, p);
  return s ? s[s.length - 1] : null;
}

export function rsi(a: number[], p = 14): number | null {
  if (a.length < p + 1) return null;
  let g = 0;
  let l = 0;
  for (let i = a.length - p; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    if (d >= 0) g += d;
    else l -= d;
  }
  if (l === 0) return 100;
  const rs = g / p / (l / p);
  return 100 - 100 / (1 + rs);
}

export interface Macd {
  line: number;
  signal: number;
  hist: number;
  histPrev: number;
}

export function macd(a: number[]): Macd | null {
  const f = emaSeries(a, 12);
  const s = emaSeries(a, 26);
  if (!f || !s) return null;
  const off = f.length - s.length;
  const line = s.map((v, i) => f[i + off] - v);
  const sig = emaSeries(line, 9);
  if (!sig) return null;
  const o2 = line.length - sig.length;
  const hist = sig.map((v, i) => line[i + o2] - v);
  return {
    line: line[line.length - 1],
    signal: sig[sig.length - 1],
    hist: hist[hist.length - 1],
    histPrev: hist[hist.length - 2],
  };
}

export interface Boll {
  ma: number;
  up: number;
  dn: number;
  width: number;
}

export function boll(a: number[], p = 20, m = 2): Boll | null {
  if (a.length < p) return null;
  const sl = a.slice(-p);
  const ma = sl.reduce((x, y) => x + y, 0) / p;
  const sd = Math.sqrt(sl.reduce((x, y) => x + (y - ma) ** 2, 0) / p);
  return { ma, up: ma + m * sd, dn: ma - m * sd, width: (4 * sd) / ma };
}

export function atr(ks: Candle[], p = 14): number | null {
  if (ks.length < p + 1) return null;
  let s = 0;
  for (let i = ks.length - p; i < ks.length; i++) {
    const h = ks[i].h;
    const l = ks[i].l;
    const pc = ks[i - 1].c;
    s += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return s / p;
}

export function stoch(ks: Candle[], p = 14): number | null {
  if (ks.length < p) return null;
  const sl = ks.slice(-p);
  const hi = Math.max(...sl.map((k) => k.h));
  const lo = Math.min(...sl.map((k) => k.l));
  const c = ks[ks.length - 1].c;
  return hi === lo ? 50 : ((c - lo) / (hi - lo)) * 100;
}

export interface Adx {
  adx: number;
  pdi: number;
  ndi: number;
}

export function adx(ks: Candle[], p = 14): Adx | null {
  if (ks.length < p * 2) return null;
  const tr: number[] = [];
  const pdm: number[] = [];
  const ndm: number[] = [];
  for (let i = 1; i < ks.length; i++) {
    const up = ks[i].h - ks[i - 1].h;
    const dn = ks[i - 1].l - ks[i].l;
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(ks[i].h - ks[i].l, Math.abs(ks[i].h - ks[i - 1].c), Math.abs(ks[i].l - ks[i - 1].c)));
  }
  const sm = (arr: number[]): number[] => {
    let s = arr.slice(0, p).reduce((x, y) => x + y, 0);
    const o = [s];
    for (let i = p; i < arr.length; i++) {
      s = s - s / p + arr[i];
      o.push(s);
    }
    return o;
  };
  const trs = sm(tr);
  const pds = sm(pdm);
  const nds = sm(ndm);
  const dx: number[] = [];
  for (let i = 0; i < trs.length; i++) {
    const pdi = (100 * pds[i]) / trs[i];
    const ndi = (100 * nds[i]) / trs[i];
    dx.push((100 * Math.abs(pdi - ndi)) / (pdi + ndi || 1));
  }
  if (dx.length < p) return null;
  const a = dx.slice(-p).reduce((x, y) => x + y, 0) / p;
  const lastP = (100 * pds[pds.length - 1]) / trs[trs.length - 1];
  const lastN = (100 * nds[nds.length - 1]) / trs[trs.length - 1];
  return { adx: a, pdi: lastP, ndi: lastN };
}

export function obvSlope(ks: Candle[], p = 20): number | null {
  if (ks.length < p + 1) return null;
  let obv = 0;
  const arr = [0];
  for (let i = 1; i < ks.length; i++) {
    obv += ks[i].c > ks[i - 1].c ? ks[i].v : ks[i].c < ks[i - 1].c ? -ks[i].v : 0;
    arr.push(obv);
  }
  const recent = arr.slice(-p);
  const rng = Math.max(...arr.slice(-p * 3).map(Math.abs)) || 1;
  return (recent[recent.length - 1] - recent[0]) / rng;
}

export function vwap(ks: Candle[], p = 30): number | null {
  if (ks.length < p) return null;
  let pv = 0;
  let vv = 0;
  for (const k of ks.slice(-p)) {
    const tp = (k.h + k.l + k.c) / 3;
    pv += tp * k.v;
    vv += k.v;
  }
  return vv ? pv / vv : null;
}
