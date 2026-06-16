// LLM data export — serializes the live `GlobalData` snapshot into a compact
// JSON payload that can be pasted into an LLM chat together with the analysis
// prompt (src/prompts/price_prediction_cn.md).
//
// The LLM does its OWN analysis from this raw data; we do not export the
// engine's factor scores. Only data that genuinely exists in `GlobalData` is
// emitted — every dead/keyless-stub source is omitted and listed under
// `unavailable`, mirroring the engine's fail-soft "drop the factor" rule.
import type { GlobalData, TF } from './types';
import { TF_LIST } from './constants';
import { computeOptions } from './engine';
import { getLang, type Lang } from './i18n';
import promptZh from '../prompts/price_prediction_cn.md?raw';
import promptEn from '../prompts/price_prediction_en.md?raw';

const SNAPSHOT_MARKER = '{{SNAPSHOT_JSON}}';
const PROMPTS: Record<Lang, string> = { zh: promptZh, en: promptEn };

/** Round to `d` decimals; non-finite → 0 (keeps the JSON numeric and compact). */
function round(x: number, d: number): number {
  return Number.isFinite(x) ? +(+x).toFixed(d) : 0;
}

export interface LlmSnapshot {
  current_time: string;
  current_price: number | null;
  price_change_24h_pct: number | null;
  /** Per timeframe: `[open, high, low, close, volume, takerBuyBase]`, oldest→newest. */
  klines: Partial<Record<TF, number[][]>>;
  global: Record<string, unknown>;
  /** Sources that were unreachable/keyless this run (excluded above). */
  unavailable: string[];
}

export interface LlmExportOptions {
  /** Most-recent bars per timeframe to include. Default 120 (caps paste size). */
  bars?: number;
  /** Snapshot timestamp; defaults to the current time. */
  now?: Date;
  /** Prompt language; defaults to the dashboard's active language (`getLang()`). */
  lang?: Lang;
}

/** Build the structured market snapshot from a complete `GlobalData`. */
export function buildLlmSnapshot(D: GlobalData, opts: LlmExportOptions = {}): LlmSnapshot {
  const bars = opts.bars ?? 120;
  const now = opts.now ?? new Date();
  const unavailable: string[] = [];

  // ── klines: full OHLCV + taker-buy history so the LLM can compute its own TA ──
  const klines: Partial<Record<TF, number[][]>> = {};
  for (const tf of TF_LIST) {
    const ks = D.klines[tf];
    if (ks && ks.length) {
      klines[tf] = ks
        .slice(-bars)
        .map((k) => [round(k.o, 2), round(k.h, 2), round(k.l, 2), round(k.c, 2), round(k.v, 3), round(k.tbv, 3)]);
    } else {
      unavailable.push(`klines.${tf}`);
    }
  }

  const current_price = D.ticker.ok ? round(D.ticker.v.lastPrice, 2) : null;
  const price_change_24h_pct = D.ticker.ok ? round(D.ticker.v.priceChangePercent, 2) : null;
  if (!D.ticker.ok) unavailable.push('ticker');

  // ── global shared factors ──
  const g: Record<string, unknown> = {};

  if (D.premium.ok) g.funding_rate = round(+D.premium.v.lastFundingRate, 6);
  else unavailable.push('funding_rate');

  if (D.oiHist.ok && D.oiHist.v.length > 1) {
    const o = D.oiHist.v;
    const first = +o[0].sumOpenInterest;
    const last = +o[o.length - 1].sumOpenInterest;
    if (first) g.open_interest_change_pct = round(((last - first) / first) * 100, 2);
  } else unavailable.push('open_interest');

  if (price_change_24h_pct != null) g.price_change_24h_pct = price_change_24h_pct;

  if (D.lsAcct.ok && D.lsAcct.v.length) g.long_short_account_ratio = round(+D.lsAcct.v[D.lsAcct.v.length - 1].longShortRatio, 3);
  else unavailable.push('long_short_account_ratio');

  if (D.taker.ok && D.taker.v.length) g.taker_buy_sell_ratio_5m = round(+D.taker.v[D.taker.v.length - 1].buySellRatio, 3);
  else unavailable.push('taker_ratio');

  if (D.deribit.ok) {
    const op = computeOptions(D.deribit.v);
    if (op) {
      const options: Record<string, number> = { max_pain_dte_days: round(op.mpDte, 1) };
      if (op.pc != null) options.put_call_ratio = round(op.pc, 3);
      if (op.skew != null) options.skew_put_minus_call_iv = round(op.skew, 2);
      if (op.atmIV != null) options.atm_iv_pct = round(op.atmIV, 1);
      if (op.maxPain != null) options.max_pain = round(op.maxPain, 0);
      g.options = options;
    } else unavailable.push('options');
  } else unavailable.push('options');

  if (D.depth.ok) {
    const bid = D.depth.v.bids.reduce((s, b) => s + +b[0] * +b[1], 0);
    const ask = D.depth.v.asks.reduce((s, a) => s + +a[0] * +a[1], 0);
    const tot = bid + ask;
    if (tot) g.orderbook_imbalance_top50 = round((bid - ask) / tot, 3);
  } else unavailable.push('orderbook');

  if (D.fng.ok && D.fng.v.data && D.fng.v.data.length) {
    g.fear_greed_index = round(+D.fng.v.data[0].value, 0);
    g.fear_greed_label = D.fng.v.data[0].value_classification;
  } else unavailable.push('fear_greed');

  if (D.cg.ok && D.cg.v.data) {
    g.btc_dominance_pct = round(D.cg.v.data.market_cap_percentage.btc, 2);
    g.total_mcap_change_24h_pct = round(D.cg.v.data.market_cap_change_percentage_24h_usd, 2);
  } else unavailable.push('dominance');

  if (D.macro.ok) {
    g.dxy = round(D.macro.v.dxy, 2);
    g.dxy_change_pct = round(D.macro.v.dxyChg * 100, 2);
    if (!isNaN(D.macro.v.y10)) {
      g.us10y_yield_pct = round(D.macro.v.y10, 2);
      g.us10y_change_pp = round(D.macro.v.y10Chg, 2);
    } else unavailable.push('us10y');
  } else {
    unavailable.push('dxy');
    unavailable.push('us10y');
  }

  if (D.mvrv.ok) g.mvrv = round(D.mvrv.v, 2);
  else unavailable.push('mvrv');

  if (D.memFee.ok) g.mempool_fastest_fee_sat_vb = round(D.memFee.v.fastestFee, 0);
  else unavailable.push('mempool');

  if (D.hashr.ok && D.hashr.v.currentHashrate) g.hashrate_ehs = round(D.hashr.v.currentHashrate / 1e18, 0);
  else unavailable.push('hashrate');

  return { current_time: now.toISOString(), current_price, price_change_24h_pct, klines, global: g, unavailable };
}

/** The snapshot as a pretty-printed JSON string. */
export function llmSnapshotJson(D: GlobalData, opts?: LlmExportOptions): string {
  return JSON.stringify(buildLlmSnapshot(D, opts), null, 2);
}

/** Full ready-to-paste message: the analysis prompt (in the active language,
 *  CN or EN) with the live snapshot injected at its `{{SNAPSHOT_JSON}}` marker
 *  (falls back to appending). */
export function buildLlmMessage(D: GlobalData, opts?: LlmExportOptions): string {
  const template = PROMPTS[opts?.lang ?? getLang()] ?? promptZh;
  const json = llmSnapshotJson(D, opts);
  return template.includes(SNAPSHOT_MARKER)
    ? template.replace(SNAPSHOT_MARKER, json)
    : `${template}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}
