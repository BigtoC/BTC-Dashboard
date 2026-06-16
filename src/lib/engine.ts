// Prediction engine: factor builders + composite scoring.
//
// Ported 1:1 from the original dashboard. The numeric logic is unchanged; the
// only difference is that every human-readable string is produced via `t()`
// so the CN/EN toggle works. `scoreTF` is byte-for-byte equivalent to the
// original weighted-composite algorithm.
import type { Candle, Category, Factor, GlobalData, OptionsSummary, DeribitOption, TFResult, TF, CatScore } from './types';
import { clamp, closes, emaLast, rsi, macd, boll, atr, stoch, adx, obvSlope, vwap } from './indicators';
import { CAT_ORDER, WEIGHTS } from './constants';
import { t } from './i18n';

// ── Deribit options aggregation ──────────────────────────────────────────
export function parseExpiry(s: string): number | null {
  const m = s.match(/^(\d+)([A-Z]{3})(\d{2})$/);
  if (!m) return null;
  const mons: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  return Date.UTC(2000 + +m[3], mons[m[2]], +m[1], 8, 0, 0);
}

export function computeOptions(arr: DeribitOption[]): OptionsSummary | null {
  if (!arr || !arr.length) return null;
  const now = Date.now();
  let priceSum = 0;
  let pn = 0;
  const opts: { strike: number; type: string; dte: number; exp: number; oi: number; iv: number }[] = [];
  for (const o of arr) {
    const p = (o.instrument_name || '').split('-');
    if (p.length < 4) continue;
    const strike = +p[2];
    const type = p[3];
    const exp = parseExpiry(p[1]);
    if (!exp || !strike) continue;
    const dte = (exp - now) / 86400000;
    if (dte <= 0) continue;
    if (o.underlying_price) {
      priceSum += o.underlying_price;
      pn++;
    }
    opts.push({ strike, type, dte, exp, oi: +(o.open_interest || 0), iv: +(o.mark_iv || 0) });
  }
  if (!opts.length || !pn) return null;
  const price = priceSum / pn;
  let putOI = 0;
  let callOI = 0;
  opts.forEach((o) => {
    if (o.type === 'P') putOI += o.oi;
    else callOI += o.oi;
  });
  const pc = callOI > 0 ? putOI / callOI : null;
  let pIV = 0;
  let pW = 0;
  let cIV = 0;
  let cW = 0;
  opts.forEach((o) => {
    if (o.dte > 60 || !o.iv) return;
    const mny = o.strike / price;
    if (o.type === 'P' && mny >= 0.85 && mny <= 0.97) {
      pIV += o.iv * (o.oi + 0.01);
      pW += o.oi + 0.01;
    }
    if (o.type === 'C' && mny >= 1.03 && mny <= 1.15) {
      cIV += o.iv * (o.oi + 0.01);
      cW += o.oi + 0.01;
    }
  });
  const skew = pW && cW ? pIV / pW - cIV / cW : null;
  let aIV = 0;
  let aW = 0;
  opts.forEach((o) => {
    if (o.dte < 1 || o.dte > 45 || !o.iv) return;
    if (Math.abs(o.strike / price - 1) < 0.03) {
      aIV += o.iv;
      aW++;
    }
  });
  const atmIV = aW ? aIV / aW : null;
  const nextExp = Math.min(...opts.map((o) => o.exp));
  const near = opts.filter((o) => o.exp === nextExp);
  const strikes = [...new Set(near.map((o) => o.strike))].sort((a, b) => a - b);
  let maxPain: number | null = null;
  let best = Infinity;
  for (const S of strikes) {
    let pay = 0;
    near.forEach((o) => {
      pay += o.type === 'C' ? o.oi * Math.max(0, S - o.strike) : o.oi * Math.max(0, o.strike - S);
    });
    if (pay < best) {
      best = pay;
      maxPain = S;
    }
  }
  return { price, pc, skew, atmIV, maxPain, mpDte: (nextExp - now) / 86400000 };
}

// ── Factor constructor ─────────────────────────────────────────────────────
export function F(
  id: string,
  name: string,
  category: Category,
  score: number,
  confidence: number,
  value: string,
  note: string,
  available = true,
): Factor {
  return { id, name, category, score: clamp(score), confidence: clamp(confidence, 0, 1), value, note, available };
}

// ── Per-timeframe factor groups ─────────────────────────────────────────────
export function technicalFactors(ks: Candle[]): Factor[] {
  const c = closes(ks);
  const price = c[c.length - 1];
  const out: Factor[] = [];
  const e21 = emaLast(c, 21);
  const e50 = emaLast(c, 50);
  const e200 = emaLast(c, 200);
  if (e21 && e50) {
    let sc = 0;
    sc += price > e21 ? 0.4 : -0.4;
    sc += e21 > e50 ? 0.3 : -0.3;
    if (e200) sc += price > e200 ? 0.3 : -0.3;
    const algn =
      price > e21 && e21 > e50 && (!e200 || e50 > e200)
        ? t('f.ema.bull')
        : price < e21 && e21 < e50
          ? t('f.ema.bear')
          : t('f.ema.mix');
    out.push(F('ema', t('f.ema.name'), 'technicals', sc, 0.8, algn, t('f.ema.note', { a: price > e21 ? '>' : '<', b: e21 > e50 ? '>' : '<' })));
  }
  const m = macd(c);
  if (m) {
    const lineSc = clamp(m.line / (price * 0.004));
    const histSc = clamp((m.hist - m.histPrev) / (price * 0.0012));
    const sc = lineSc * 0.6 + histSc * 0.4;
    out.push(
      F('macd', t('f.macd.name'), 'technicals', sc, 0.7, m.hist.toFixed(1), t('f.macd.note', {
        a: m.line > 0 ? t('f.macd.above') : t('f.macd.below'),
        b: m.hist > m.histPrev ? t('f.macd.strengthen') : t('f.macd.weaken'),
      })),
    );
  }
  const r = rsi(c);
  if (r != null) {
    let sc: number;
    let note: string;
    if (r > 80) {
      sc = -0.3;
      note = t('f.rsi.overbought');
    } else if (r < 20) {
      sc = 0.3;
      note = t('f.rsi.oversold');
    } else {
      sc = clamp((r - 50) / 30);
      note = r > 55 ? t('f.rsi.bull') : r < 45 ? t('f.rsi.bear') : t('f.rsi.neutral');
    }
    out.push(F('rsi', t('f.rsi.name'), 'technicals', sc, 0.45, r.toFixed(1), note));
  }
  const st = stoch(ks);
  if (st != null) {
    let sc: number;
    if (st > 90) sc = -0.25;
    else if (st < 10) sc = 0.25;
    else sc = (st - 50) / 55;
    out.push(F('stoch', t('f.stoch.name'), 'technicals', sc, 0.35, st.toFixed(0), st > 80 ? t('f.stoch.high') : st < 20 ? t('f.stoch.low') : t('f.stoch.neutral')));
  }
  const bb = boll(c);
  if (bb) {
    const pos = (price - bb.ma) / (bb.up - bb.ma || 1);
    const squeeze = bb.width < 0.025;
    const sc = clamp(-pos * 0.3);
    out.push(
      F('boll', t('f.boll.name'), 'technicals', sc, squeeze ? 0.2 : 0.3, (pos * 100).toFixed(0) + '%', squeeze ? t('f.boll.squeeze') : pos > 0.9 ? t('f.boll.upper') : pos < -0.9 ? t('f.boll.lower') : t('f.boll.inside')),
    );
  }
  const ax = adx(ks);
  if (ax) {
    const sc = clamp((ax.pdi - ax.ndi) / 40);
    const conf = clamp(ax.adx / 40, 0, 1);
    out.push(F('adx', t('f.adx.name'), 'technicals', sc, conf, ax.adx.toFixed(0), ax.adx > 25 ? (ax.pdi > ax.ndi ? t('f.adx.up') : t('f.adx.down')) : t('f.adx.weak')));
  }
  const ob = obvSlope(ks);
  if (ob != null) out.push(F('obv', t('f.obv.name'), 'technicals', clamp(ob), 0.5, (ob * 100).toFixed(0), ob > 0 ? t('f.obv.up') : t('f.obv.down')));
  const vw = vwap(ks);
  if (vw) {
    const d = (price - vw) / vw;
    out.push(F('vwap', t('f.vwap.name'), 'technicals', clamp(d * 60), 0.55, (d * 100).toFixed(2) + '%', price > vw ? t('f.vwap.above') : t('f.vwap.below')));
  }
  return out;
}

export function levelFactors(ks: Candle[]): Factor[] {
  const c = closes(ks);
  const price = c[c.length - 1];
  const out: Factor[] = [];
  const a = atr(ks) || price * 0.005;
  const win = ks.slice(-60);
  const highs = win.map((k) => k.h);
  const lows = win.map((k) => k.l);
  const res = Math.max(...highs);
  const sup = Math.min(...lows);
  const dRes = (res - price) / a;
  const dSup = (price - sup) / a;
  let sc = clamp((dRes - dSup) / 8);
  let note = t('f.sr.range', { res: res.toFixed(0), sup: sup.toFixed(0) });
  if (dSup < 1.2) {
    sc = 0.45;
    note = t('f.sr.nearSup');
  }
  if (dRes < 1.2) {
    sc = -0.45;
    note = t('f.sr.nearRes');
  }
  out.push(F('sr', t('f.sr.name'), 'levels', sc, 0.6, t('f.sr.value', { n: dSup.toFixed(1) }), note));
  const sh = Math.max(...highs);
  const sl = Math.min(...lows);
  const rng = sh - sl || 1;
  const fibPos = (price - sl) / rng;
  let fsc = 0;
  let fnote: string;
  if (fibPos >= 0.35 && fibPos <= 0.5) {
    fsc = 0.35;
    fnote = t('f.fib.golden');
  } else if (fibPos > 0.9) {
    fsc = -0.25;
    fnote = t('f.fib.high');
  } else if (fibPos < 0.1) {
    fsc = 0.25;
    fnote = t('f.fib.low');
  } else fnote = t('f.fib.inRange', { p: (fibPos * 100).toFixed(0) });
  out.push(F('fib', t('f.fib.name'), 'levels', fsc, 0.45, (fibPos * 100).toFixed(0) + '%', fnote));
  return out;
}

export function structureFactors(ks: Candle[]): Factor[] {
  const out: Factor[] = [];
  if (ks.length < 40) return out;
  const recent = ks.slice(-30);
  const part = (arr: Candle[], a: number, b: number) => arr.slice(a, b);
  const hi = (arr: Candle[]) => Math.max(...arr.map((k) => k.h));
  const lo = (arr: Candle[]) => Math.min(...arr.map((k) => k.l));
  const h1 = hi(part(recent, 0, 15));
  const h2 = hi(part(recent, 15, 30));
  const l1 = lo(part(recent, 0, 15));
  const l2 = lo(part(recent, 15, 30));
  let sc = 0;
  let vKey: string;
  let nKey: string;
  if (h2 > h1 && l2 > l1) {
    sc = 0.75;
    vKey = 'f.ms.up.v';
    nKey = 'f.ms.up.n';
  } else if (h2 < h1 && l2 < l1) {
    sc = -0.75;
    vKey = 'f.ms.down.v';
    nKey = 'f.ms.down.n';
  } else if (h2 > h1 && l2 < l1) {
    sc = 0;
    vKey = 'f.ms.expand.v';
    nKey = 'f.ms.expand.n';
  } else {
    sc = 0;
    vKey = 'f.ms.contract.v';
    nKey = 'f.ms.contract.n';
  }
  out.push(F('ms', t('f.ms.name'), 'structure', sc, 0.7, t(vKey), t(nKey)));
  const a = atr(ks) || 1;
  const net = ks[ks.length - 1].c - ks[ks.length - 6].c;
  out.push(F('mom', t('f.mom.name'), 'structure', clamp(net / (a * 2.2)), 0.55, net.toFixed(0), net > 0 ? t('f.mom.up') : t('f.mom.down')));
  return out;
}

export function priceFactors(ks: Candle[]): Factor[] {
  const out: Factor[] = [];
  const last = ks[ks.length - 1];
  const buyRatio = last.v ? last.tbv / last.v : 0.5;
  out.push(F('takervol', t('f.takervol.name'), 'price', clamp((buyRatio - 0.5) * 4), 0.4, (buyRatio * 100).toFixed(0) + '%', buyRatio > 0.55 ? t('f.takervol.buy') : buyRatio < 0.45 ? t('f.takervol.sell') : t('f.takervol.balanced')));
  const vols = ks.slice(-21).map((k) => k.v);
  const avg = vols.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
  const rel = avg ? last.v / avg : 1;
  const dir = last.c >= last.o ? 1 : -1;
  out.push(F('volexp', t('f.volexp.name'), 'price', clamp(dir * (rel - 1)), 0.45, rel.toFixed(2) + 'x', rel > 1.5 ? (dir > 0 ? t('f.volexp.up') : t('f.volexp.down')) : t('f.volexp.normal')));
  return out;
}

// ── Global (cross-timeframe) factors ─────────────────────────────────────────
function emptyGlobals(): Record<Category, Factor[]> {
  const g = {} as Record<Category, Factor[]>;
  for (const cat of CAT_ORDER) g[cat] = [];
  return g;
}

export function globalFactors(D: GlobalData): Record<Category, Factor[]> {
  const G = emptyGlobals();
  if (D.premium.ok) {
    const fr = +D.premium.v.lastFundingRate;
    let sc: number;
    if (fr > 0.0005) sc = -0.5;
    else if (fr < -0.0005) sc = 0.5;
    else sc = clamp((fr / 0.0003) * 0.3);
    G.derivatives.push(F('funding', t('f.funding.name'), 'derivatives', sc, 0.7, (fr * 100).toFixed(4) + '%', fr > 0.0005 ? t('f.funding.hot') : fr < -0.0005 ? t('f.funding.cold') : t('f.funding.mild')));
  }
  if (D.oiHist.ok && D.oiHist.v.length > 1) {
    const o = D.oiHist.v;
    const oiChg = (+o[o.length - 1].sumOpenInterest - +o[0].sumOpenInterest) / +o[0].sumOpenInterest;
    const pf = D.ticker.ok ? +D.ticker.v.priceChangePercent : 0;
    let sc: number;
    let note: string;
    if (oiChg > 0.01 && pf > 0) {
      sc = 0.45;
      note = t('f.oi.upUp');
    } else if (oiChg > 0.01 && pf < 0) {
      sc = -0.45;
      note = t('f.oi.upDown');
    } else if (oiChg < -0.01 && pf < 0) {
      sc = 0.25;
      note = t('f.oi.downDown');
    } else if (oiChg < -0.01 && pf > 0) {
      sc = -0.2;
      note = t('f.oi.downUp');
    } else {
      sc = 0;
      note = t('f.oi.steady');
    }
    G.derivatives.push(F('oi', t('f.oi.name'), 'derivatives', sc, 0.6, (oiChg * 100).toFixed(1) + '%', note));
  }
  if (D.lsAcct.ok && D.lsAcct.v.length) {
    const r = +D.lsAcct.v[D.lsAcct.v.length - 1].longShortRatio;
    let sc: number;
    if (r > 2) sc = -0.4;
    else if (r < 0.8) sc = 0.4;
    else sc = clamp((1.2 - r) * 0.5);
    G.derivatives.push(F('lsacct', t('f.lsacct.name'), 'derivatives', sc, 0.55, r.toFixed(2), r > 1.5 ? t('f.lsacct.long') : r < 0.9 ? t('f.lsacct.short') : t('f.lsacct.balanced')));
  }
  if (D.lsTop.ok && D.lsTop.v.length) {
    const r = +D.lsTop.v[D.lsTop.v.length - 1].longShortRatio;
    G.derivatives.push(F('lstop', t('f.lstop.name'), 'derivatives', clamp((r - 1) * 0.6), 0.6, r.toFixed(2), r > 1.1 ? t('f.lstop.long') : r < 0.9 ? t('f.lstop.short') : t('f.lstop.neutral')));
  }
  if (D.taker.ok && D.taker.v.length) {
    const r = +D.taker.v[D.taker.v.length - 1].buySellRatio;
    G.derivatives.push(F('takerg', t('f.takerg.name'), 'derivatives', clamp((r - 1) * 1.2), 0.5, r.toFixed(2), r > 1.05 ? t('f.takerg.buy') : r < 0.95 ? t('f.takerg.sell') : t('f.takerg.balanced')));
  }
  if (D.deribit && D.deribit.ok) {
    const op = computeOptions(D.deribit.v);
    if (op) {
      if (op.pc != null) {
        const sc = clamp((0.85 - op.pc) * 1.0);
        G.derivatives.push(F('pcr', t('f.pcr.name'), 'derivatives', sc, 0.5, op.pc.toFixed(2), op.pc > 1 ? t('f.pcr.put') : op.pc < 0.7 ? t('f.pcr.call') : t('f.pcr.neutral')));
      }
      if (op.skew != null) {
        const sc = clamp(-op.skew / 10);
        G.derivatives.push(F('skew', t('f.skew.name'), 'derivatives', sc, 0.5, (op.skew > 0 ? '+' : '') + op.skew.toFixed(1) + 'v', op.skew > 2 ? t('f.skew.put') : op.skew < -2 ? t('f.skew.call') : t('f.skew.neutral')));
      }
      if (op.maxPain != null && op.price) {
        const pull = (op.maxPain - op.price) / op.price;
        const sc = clamp(pull * 15);
        const conf = op.mpDte < 3 ? 0.5 : 0.25;
        G.overlooked.push(F('maxpain', t('f.maxpain.name'), 'overlooked', sc, conf, op.maxPain.toFixed(0), t('f.maxpain.note', { mp: op.maxPain.toFixed(0), dte: op.mpDte.toFixed(1), dir: op.price > op.maxPain ? t('f.maxpain.above') : t('f.maxpain.below') })));
      }
      if (op.atmIV != null) {
        G.sentiment.push(F('ivol', t('f.ivol.name'), 'sentiment', 0, 0, op.atmIV.toFixed(0) + '%', op.atmIV > 70 ? t('f.ivol.high') : op.atmIV < 40 ? t('f.ivol.low') : t('f.ivol.mid')));
      }
    } else {
      G.overlooked.push(F('options', t('f.options.name1'), 'overlooked', 0, 0, t('f.options.parseFail'), t('f.options.parseFailNote'), false));
    }
  } else {
    G.overlooked.push(F('options', t('f.options.name2'), 'overlooked', 0, 0, t('f.options.unreachable'), t('f.options.unreachableNote'), false));
  }
  if (D.depth.ok) {
    const bid = D.depth.v.bids.reduce((s, b) => s + +b[0] * +b[1], 0);
    const ask = D.depth.v.asks.reduce((s, a) => s + +a[0] * +a[1], 0);
    const imb = (bid - ask) / (bid + ask);
    G.overlooked.push(F('obi', t('f.obi.name'), 'overlooked', clamp(imb * 2), 0.4, (imb * 100).toFixed(0) + '%', imb > 0.1 ? t('f.obi.bid') : imb < -0.1 ? t('f.obi.ask') : t('f.obi.balanced')));
  }
  if (D.premium.ok) {
    const fr = +D.premium.v.lastFundingRate;
    const crowd = Math.abs(fr) > 0.0008;
    G.overlooked.push(F('crowd', t('f.crowd.name'), 'overlooked', crowd ? (fr > 0 ? -0.5 : 0.5) : 0, crowd ? 0.5 : 0.2, crowd ? t('f.crowd.crowdedV') : t('f.crowd.normalV'), crowd ? t('f.crowd.crowdedN') : t('f.crowd.normalN')));
  }
  if (D.fng.ok && D.fng.v.data) {
    const v = +D.fng.v.data[0].value;
    let sc: number;
    if (v > 75) sc = -0.4;
    else if (v < 25) sc = 0.4;
    else sc = clamp((50 - v) / 60);
    G.sentiment.push(F('fng', t('f.fng.name'), 'sentiment', sc, 0.5, v + ' ' + D.fng.v.data[0].value_classification, v > 75 ? t('f.fng.greed') : v < 25 ? t('f.fng.fear') : t('f.fng.neutral')));
  }
  if (D.cg.ok && D.cg.v.data) {
    const dom = D.cg.v.data.market_cap_percentage.btc;
    const mcChg = D.cg.v.data.market_cap_change_percentage_24h_usd;
    G.flows.push(F('dom', t('f.dom.name'), 'flows', clamp((mcChg || 0) / 5), 0.4, dom.toFixed(1) + '%', t('f.dom.note', { chg: (mcChg >= 0 ? '+' : '') + (mcChg || 0).toFixed(2) })));
  }
  if (D.memFee.ok) {
    const fast = D.memFee.v.fastestFee;
    G.onchain.push(F('mempool', t('f.mempool.name'), 'onchain', 0, 0.3, fast + ' sat/vB', fast > 50 ? t('f.mempool.busy') : t('f.mempool.quiet')));
  }
  if (D.hashr.ok && D.hashr.v.currentHashrate) {
    G.onchain.push(F('hash', t('f.hash.name'), 'onchain', 0, 0.25, (D.hashr.v.currentHashrate / 1e18).toFixed(0) + ' EH/s', t('f.hash.note')));
  }
  // ── Keyless free sources (extra-sources.ts): real when reachable, else degrade ──
  if (D.mvrv && D.mvrv.ok) {
    const m = D.mvrv.v;
    let sc: number;
    if (m > 3.5) sc = -0.6;
    else if (m < 1.0) sc = 0.6;
    else sc = clamp((1.8 - m) * 0.5);
    G.onchain.push(F('mvrv', t('f.mvrv.name'), 'onchain', sc, 0.4, m.toFixed(2), m > 3.5 ? t('f.mvrv.high') : m < 1.0 ? t('f.mvrv.low') : t('f.mvrv.mid')));
  } else {
    G.onchain.push(F('mvrv', t('f.mvrv.name'), 'onchain', 0, 0, t('val.unavail'), t('f.mvrv.unreach'), false));
  }
  // ── Paid / API-key sources (stubbed: render as "needs API key", never break) ──
  G.onchain.push(F('sopr', t('f.sopr.name'), 'onchain', 0, 0, t('val.needKey'), t('f.sopr.note'), false));
  G.onchain.push(F('netflow', t('f.netflow.name'), 'onchain', 0, 0, t('val.needKey'), t('f.netflow.note'), false));
  G.flows.push(F('etf', t('f.etf.name'), 'flows', 0, 0, t('val.needKey'), t('f.etf.note'), false));
  if (D.macro && D.macro.ok) {
    const mc = D.macro.v;
    const sc = clamp(-mc.dxyChg * 35 - (isNaN(mc.y10Chg) ? 0 : mc.y10Chg) * 0.8);
    const y10txt = isNaN(mc.y10) ? 'n/a' : mc.y10.toFixed(2) + '%';
    G.flows.push(F('dxy', t('f.dxy.name'), 'flows', sc, 0.4, mc.dxy.toFixed(1), t('f.dxy.real', { chg: (mc.dxyChg * 100 >= 0 ? '+' : '') + (mc.dxyChg * 100).toFixed(2), y: y10txt })));
  } else {
    G.flows.push(F('dxy', t('f.dxy.name'), 'flows', 0, 0, t('val.unavail'), t('f.dxy.unreach'), false));
  }
  G.overlooked.push(F('liqmap', t('f.liqmap.name'), 'overlooked', 0, 0, t('val.needKey'), t('f.liqmap.note'), false));
  G.news.push(F('macro', t('f.macro.name'), 'news', 0, 0, t('val.needKey'), t('f.macro.note'), false));
  G.news.push(F('reg', t('f.reg.name'), 'news', 0, 0, t('val.needKey'), t('f.reg.note'), false));
  return G;
}

// ── Composite scoring (unchanged algorithm) ──────────────────────────────────
export function scoreTF(tf: TF, perTF: Factor[], glob: Record<Category, Factor[]>): TFResult {
  const w = WEIGHTS[tf];
  const byCat = {} as Record<Category, Factor[]>;
  for (const k of CAT_ORDER) byCat[k] = [];
  perTF.forEach((f) => byCat[f.category].push(f));
  for (const cat of CAT_ORDER) (glob[cat] || []).forEach((f) => byCat[cat].push(f));
  const catScores = {} as Record<Category, CatScore>;
  let composite = 0;
  let wsum = 0;
  for (const cat of CAT_ORDER) {
    const fs = byCat[cat].filter((f) => f.available && f.confidence > 0);
    let cs: number | null = null;
    if (fs.length) {
      let s = 0;
      let c = 0;
      fs.forEach((f) => {
        s += f.score * f.confidence;
        c += f.confidence;
      });
      cs = c ? s / c : 0;
      composite += cs * w[cat];
      wsum += w[cat];
    }
    catScores[cat] = { score: cs, factors: byCat[cat], weight: w[cat] };
  }
  const raw = wsum ? composite / wsum : 0;
  composite = clamp(Math.tanh(raw * 6));
  const allActive = Object.values(byCat).flat().filter((f) => f.available && f.confidence > 0);
  const coverage = clamp(wsum / 0.85, 0, 1);
  const agree = allActive.length ? Math.abs(allActive.reduce((s, f) => s + Math.sign(f.score), 0)) / allActive.length : 0;
  const conf = clamp(Math.abs(composite) * 0.55 + agree * 0.3 + coverage * 0.15);
  return { tf, composite, raw, confidence: conf, catScores, coverage };
}
