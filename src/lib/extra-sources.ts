// Keyless, CORS-enabled replacements for two formerly-paid factors.
//
//   • `dxy`  — US Dollar Index proxy + US 10Y yield, from the US Treasury daily
//              yield-curve XML feed (keyless, CORS *) and Frankfurter ECB FX
//              (keyless, no quotas, CORS *). Replaces FRED (key + no CORS).
//   • `mvrv` — BTC MVRV from the Coin Metrics Community API (keyless, CORS *,
//              CC BY-NC 4.0). Replaces Glassnode/CryptoQuant (paid).
//
// Both are fail-soft: a dead source yields `{ok:false}` and the factor degrades
// (drops from the composite) exactly like every other keyless source. SOPR and
// exchange-netflow have NO free keyless source (Coin Metrics community exposes
// only MVRV; SOPR returns "forbidden"), so they remain paid stubs.
import type { MacroData, Safe } from './types';
import { FRANKFURTER_BASE, COINMETRICS_COMMUNITY, treasuryYieldUrl } from './config';

async function safeJson<T>(url: string): Promise<Safe<T>> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { ok: false, e: url.split('?')[0] + ' → ' + r.status };
    return { ok: true, v: (await r.json()) as T };
  } catch (e) {
    return { ok: false, e: String(e) };
  }
}

async function safeText(url: string): Promise<Safe<string>> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { ok: false, e: url.split('?')[0] + ' → ' + r.status };
    return { ok: true, v: await r.text() };
  } catch (e) {
    return { ok: false, e: String(e) };
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ICE U.S. Dollar Index from USD-base ECB rates (rates = units per 1 USD).
 *  DXY = 50.14348112·EURUSD^-0.576·USDJPY^0.136·GBPUSD^-0.119·USDCAD^0.091·USDSEK^0.042·USDCHF^0.036,
 *  rewritten in terms of USD-base rates (EURUSD = 1/rates.EUR, etc.). */
export function computeDxy(r: Record<string, number>): number | null {
  const { EUR, JPY, GBP, CAD, SEK, CHF } = r;
  if (!EUR || !JPY || !GBP || !CAD || !SEK || !CHF) return null;
  return (
    50.14348112 *
    Math.pow(EUR, 0.576) *
    Math.pow(JPY, 0.136) *
    Math.pow(GBP, 0.119) *
    Math.pow(CAD, 0.091) *
    Math.pow(SEK, 0.042) *
    Math.pow(CHF, 0.036)
  );
}

interface FrankfurterRange {
  rates: Record<string, Record<string, number>>;
}

/** DXY proxy + 10Y yield with ~5-business-day change. DXY drives the factor;
 *  the 10Y yield is additive and degrades to NaN if the Treasury feed fails. */
export async function fetchMacro(now: Date): Promise<Safe<MacroData>> {
  const end = ymd(now);
  const start = ymd(new Date(now.getTime() - 9 * 86_400_000)); // ~5 trading days
  const fx = await safeJson<FrankfurterRange>(`${FRANKFURTER_BASE}/${start}..${end}?base=USD&symbols=EUR,JPY,GBP,CAD,SEK,CHF`);
  if (!fx.ok || !fx.v.rates) return { ok: false, e: 'frankfurter unavailable' };
  const dates = Object.keys(fx.v.rates).sort();
  if (dates.length < 1) return { ok: false, e: 'frankfurter empty' };
  const dxyNow = computeDxy(fx.v.rates[dates[dates.length - 1]]);
  const dxyPrev = computeDxy(fx.v.rates[dates[0]]);
  if (dxyNow == null) return { ok: false, e: 'dxy compute failed' };
  const dxyChg = dxyPrev ? (dxyNow - dxyPrev) / dxyPrev : 0;

  // 10Y yield (additive; tolerate failure).
  let y10 = NaN;
  let y10Chg = 0;
  const xml = await safeText(treasuryYieldUrl(now.getUTCFullYear()));
  if (xml.ok) {
    const yields = [...xml.v.matchAll(/BC_10YEAR[^>]*>([\d.]+)</g)].map((m) => +m[1]).filter((n) => !isNaN(n));
    if (yields.length) {
      y10 = yields[yields.length - 1];
      const prev = yields[Math.max(0, yields.length - 6)];
      y10Chg = y10 - prev;
    }
  }
  return { ok: true, v: { dxy: dxyNow, dxyChg, y10, y10Chg } };
}

interface CmResponse {
  data?: { time: string; CapMVRVCur?: string }[];
}

/** BTC MVRV (CapMVRVCur), latest daily value. Keyless Coin Metrics community. */
export async function fetchMvrv(now: Date): Promise<Safe<number>> {
  const start = ymd(new Date(now.getTime() - 7 * 86_400_000));
  const r = await safeJson<CmResponse>(`${COINMETRICS_COMMUNITY}/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&start_time=${start}`);
  if (!r.ok || !r.v.data || !r.v.data.length) return { ok: false, e: 'coinmetrics unavailable' };
  const last = r.v.data[r.v.data.length - 1];
  const v = last && last.CapMVRVCur != null ? +last.CapMVRVCur : NaN;
  if (isNaN(v)) return { ok: false, e: 'no MVRV value' };
  return { ok: true, v };
}

/** Fetch both keyless extras in parallel. */
export async function fetchExtras(now: Date): Promise<{ macro: Safe<MacroData>; mvrv: Safe<number> }> {
  const [macro, mvrv] = await Promise.all([fetchMacro(now), fetchMvrv(now)]);
  return { macro, mvrv };
}
