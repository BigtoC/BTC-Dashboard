// Binance data-collection layer — the OKX → Binance migration.
//
// Every OKX endpoint the original used is mapped to its Binance equivalent (see
// the "Data sources" table in README.md), normalized to the exact `GlobalData`
// shape the engine expects.
// Each fetch is fail-soft: a dead source yields `{ok:false}` and its factor
// drops from the composite rather than crashing the cycle.
//
// OKX → Binance endpoint map:
//   candles     /api/v5/market/candles            → /api/v3/klines              (spot)
//   ticker      /api/v5/market/ticker             → /api/v3/ticker/24hr         (spot)
//   funding     /api/v5/public/funding-rate       → /fapi/v1/premiumIndex       (perp)
//   OI history  /api/v5/rubik/.../open-interest…  → /futures/data/openInterestHist
//   L/S ratio   /api/v5/rubik/.../long-short…     → /futures/data/globalLongShortAccountRatio
//   taker vol   /api/v5/rubik/.../taker-volume    → derived from klines (takerBuyBase)
//   depth       /api/v5/market/books              → /api/v3/depth               (spot)
// Deribit / Fear&Greed / CoinGecko / mempool are unchanged (already keyless).
import type { Candle, GlobalData, Safe, TF, TickerData, DeribitOption } from './types';
import { TF_LIST, BINANCE_INTERVAL } from './constants';
import {
  SYMBOL,
  BINANCE,
  DERIBIT_OPTIONS_URL,
  FNG_URL,
  COINGECKO_GLOBAL_URL,
  MEMPOOL_FEE_URL,
  MEMPOOL_HASHRATE_URL,
} from './config';

export async function jget<T = unknown>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url.split('?')[0] + ' → ' + r.status);
  return r.json() as Promise<T>;
}

export function safe<T>(p: Promise<T>): Promise<Safe<T>> {
  return p.then((v) => ({ ok: true as const, v })).catch((e) => ({ ok: false as const, e: String(e) }));
}

/** Binance klines → Candle[]. Index 9 is taker-buy base volume — real per-bar
 *  taker direction that OKX could not provide (it fell back to v/2). */
export async function binanceCandles(tf: TF): Promise<Candle[] | null> {
  const url = `${BINANCE.spot}/api/v3/klines?symbol=${SYMBOL}&interval=${BINANCE_INTERVAL[tf]}&limit=210`;
  const r = await safe(jget<(string | number)[][]>(url));
  if (!r.ok || !Array.isArray(r.v)) return null;
  return r.v.map((k) => ({
    t: +k[0],
    o: +k[1],
    h: +k[2],
    l: +k[3],
    c: +k[4],
    v: +k[5],
    tbv: +k[9],
  }));
}

interface RawGlobals {
  ticker: Safe<{ lastPrice: string; priceChangePercent: string }>;
  funding: Safe<{ lastFundingRate: string }>;
  oiv: Safe<{ sumOpenInterest: string }[]>;
  lsr: Safe<{ longShortRatio: string }[]>;
  books: Safe<{ bids: [string, string][]; asks: [string, string][] }>;
  deribit: Safe<{ result?: DeribitOption[] } | DeribitOption[]>;
  fng: Safe<GlobalData['fng'] extends Safe<infer U> ? U : never>;
  cg: Safe<GlobalData['cg'] extends Safe<infer U> ? U : never>;
  memFee: Safe<{ fastestFee: number }>;
  hashr: Safe<{ currentHashrate: number }>;
}

export async function fetchGlobalsRaw(): Promise<RawGlobals> {
  const [ticker, funding, oiv, lsr, books, deribit, fng, cg, memFee, hashr] = await Promise.all([
    safe(jget<{ lastPrice: string; priceChangePercent: string }>(`${BINANCE.spot}/api/v3/ticker/24hr?symbol=${SYMBOL}`)),
    safe(jget<{ lastFundingRate: string }>(`${BINANCE.fapi}/fapi/v1/premiumIndex?symbol=${SYMBOL}`)),
    safe(jget<{ sumOpenInterest: string }[]>(`${BINANCE.fapi}/futures/data/openInterestHist?symbol=${SYMBOL}&period=5m&limit=30`)),
    safe(jget<{ longShortRatio: string }[]>(`${BINANCE.fapi}/futures/data/globalLongShortAccountRatio?symbol=${SYMBOL}&period=5m&limit=30`)),
    safe(jget<{ bids: [string, string][]; asks: [string, string][] }>(`${BINANCE.spot}/api/v3/depth?symbol=${SYMBOL}&limit=50`)),
    safe(jget<{ result?: DeribitOption[] }>(DERIBIT_OPTIONS_URL)),
    safe(jget(FNG_URL)),
    safe(jget(COINGECKO_GLOBAL_URL)),
    safe(jget<{ fastestFee: number }>(MEMPOOL_FEE_URL)),
    safe(jget<{ currentHashrate: number }>(MEMPOOL_HASHRATE_URL)),
  ]);
  return { ticker, funding, oiv, lsr, books, deribit, fng, cg, memFee, hashr } as RawGlobals;
}

/** Normalize raw Binance/3rd-party responses into the engine's GlobalData shape.
 *  `klines5m` lets us derive the market taker buy/sell ratio (`takerg`) from the
 *  latest 5m bar's takerBuyBase, replacing OKX's taker-volume endpoint. */
export function normGlobals(R: RawGlobals, klines5m: Candle[] | null): Omit<GlobalData, 'klines' | 'deribit' | 'fng' | 'cg' | 'memFee' | 'hashr'> {
  const no = { ok: false as const, e: 'n/a' };

  const ticker: Safe<TickerData> = R.ticker.ok
    ? { ok: true, v: { lastPrice: +R.ticker.v.lastPrice, priceChangePercent: +R.ticker.v.priceChangePercent } }
    : no;

  const premium: Safe<{ lastFundingRate: string }> = R.funding.ok && R.funding.v.lastFundingRate != null
    ? { ok: true, v: { lastFundingRate: R.funding.v.lastFundingRate } }
    : no;

  const oiHist: Safe<{ sumOpenInterest: number }[]> = R.oiv.ok && Array.isArray(R.oiv.v) && R.oiv.v.length
    ? { ok: true, v: R.oiv.v.map((x) => ({ sumOpenInterest: +x.sumOpenInterest })) }
    : no;

  const lsAcct: Safe<{ longShortRatio: number }[]> = R.lsr.ok && Array.isArray(R.lsr.v) && R.lsr.v.length
    ? { ok: true, v: R.lsr.v.map((x) => ({ longShortRatio: +x.longShortRatio })) }
    : no;

  // Binance has no keyless "top trader" endpoint in our allowed set; OKX also
  // left this unavailable, so the `lstop` factor drops exactly as before.
  const lsTop: Safe<{ longShortRatio: number }[]> = no;

  // Market taker buy/sell ratio from the latest 5m bar (takerBuyBase / rest).
  let taker: Safe<{ buySellRatio: number }[]> = no;
  if (klines5m && klines5m.length) {
    const k = klines5m[klines5m.length - 1];
    const buy = k.tbv;
    const sell = k.v - k.tbv;
    taker = { ok: true, v: [{ buySellRatio: sell > 0 ? buy / sell : 1 }] };
  }

  const depth: Safe<{ bids: [string, string][]; asks: [string, string][] }> = R.books.ok && R.books.v && R.books.v.bids && R.books.v.asks
    ? { ok: true, v: { bids: R.books.v.bids, asks: R.books.v.asks } }
    : no;

  return { ticker, premium, oiNow: no, oiHist, lsAcct, lsTop, taker, depth };
}

/** Deribit returns `{ result: [...] }`; flatten to the option array so the
 *  engine's `computeOptions` receives a real array (the original passed the
 *  raw `{result}` object, which silently disabled every options factor). */
export function deribitArray(R: RawGlobals['deribit']): Safe<DeribitOption[]> {
  if (!R.ok) return R;
  const v = R.v;
  const arr = Array.isArray(v) ? v : v && Array.isArray(v.result) ? v.result : null;
  return arr ? { ok: true, v: arr } : { ok: false, e: 'no result' };
}

/** One full snapshot: 6 timeframes of klines + every global source. */
export async function collectAll(): Promise<GlobalData> {
  const [c5, c15, c30, c1h, c4h, c1d, R] = await Promise.all([
    binanceCandles('5m'),
    binanceCandles('15m'),
    binanceCandles('30m'),
    binanceCandles('1h'),
    binanceCandles('4h'),
    binanceCandles('1d'),
    fetchGlobalsRaw(),
  ]);
  const klines: Record<TF, Candle[] | null> = { '5m': c5, '15m': c15, '30m': c30, '1h': c1h, '4h': c4h, '1d': c1d };
  const g = normGlobals(R, c5);
  return {
    klines,
    ...g,
    deribit: deribitArray(R.deribit),
    fng: R.fng as GlobalData['fng'],
    cg: R.cg as GlobalData['cg'],
    memFee: R.memFee as GlobalData['memFee'],
    hashr: R.hashr as GlobalData['hashr'],
  };
}

export { TF_LIST };

/** Lightweight 1-second price poll (spot 24h ticker → price + 24h %). */
export async function fetchTicker(): Promise<{ lastPrice: number; priceChangePercent: number } | null> {
  const r = await safe(jget<{ lastPrice: string; priceChangePercent: string }>(`${BINANCE.spot}/api/v3/ticker/24hr?symbol=${SYMBOL}`));
  if (!r.ok) return null;
  return { lastPrice: +r.v.lastPrice, priceChangePercent: +r.v.priceChangePercent };
}

/** Combined Binance WS stream: live trades + 24h ticker. No manual ping needed
 *  — Binance sends ping frames and the browser auto-pongs. */
export function wsUrl(): string {
  const s = SYMBOL.toLowerCase();
  return `${BINANCE.ws}?streams=${s}@trade/${s}@ticker`;
}
