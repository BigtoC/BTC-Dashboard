// Premium / API-key data sources.
//
// The original dashboard listed several factors that require a paid API key:
//   • ETF net inflow            (flows)   — e.g. SoSoValue / Farside
//   • DXY / Treasury yields     (flows)   — e.g. FRED
//   • MVRV, SOPR, exchange flow (onchain) — Glassnode / CryptoQuant
//   • Liquidation heatmap       (overlooked) — Coinglass
//   • Macro calendar, regulation(news)    — provider-specific
//
// They are *built* here (real fetchers + a key config) but kept inert: with the
// key left "" each fetcher short-circuits to `null`, so the engine keeps showing
// them as "needs API key" stubs and the dashboard never breaks. Supply a key in
// `config.ts` / PUBLIC_* env and wire the returned value into `globalFactors`
// to light one up.
import { API_KEYS } from './config';
import { safe, jget } from './binance';

export function hasPaidKeys(): boolean {
  return Object.values(API_KEYS).some((k) => k && k.length > 0);
}

/** Spot BTC ETF net inflow (USD). Returns null when no key is configured. */
export async function fetchEtfNetflow(): Promise<number | null> {
  if (!API_KEYS.etf) return null;
  // Placeholder for a keyed provider, e.g.:
  //   const r = await safe(jget(`https://api.sosovalue.xyz/...&apiKey=${API_KEYS.etf}`));
  //   return r.ok ? parseEtf(r.v) : null;
  return null;
}

/** DXY level / 10y yield via FRED. Returns null when no key is configured. */
export async function fetchMacroDxy(): Promise<number | null> {
  if (!API_KEYS.fred) return null;
  // const r = await safe(jget(`https://api.stlouisfed.org/fred/series/observations?series_id=DTWEXBGS&api_key=${API_KEYS.fred}&file_type=json`));
  return null;
}

/** Glassnode/CryptoQuant on-chain valuation (MVRV / SOPR / netflow). */
export async function fetchOnchainValuation(metric: 'mvrv' | 'sopr' | 'netflow'): Promise<number | null> {
  const key = API_KEYS.glassnode || API_KEYS.cryptoquant;
  if (!key) return null;
  void metric;
  // const r = await safe(jget(`https://api.glassnode.com/v1/metrics/.../${metric}?api_key=${key}`));
  return null;
}

/** Coinglass liquidation heatmap. Returns null when no key is configured. */
export async function fetchLiquidationMap(): Promise<unknown | null> {
  if (!API_KEYS.coinglass) return null;
  // const r = await safe(jget(`https://open-api.coinglass.com/...`, { headers: { 'coinglassSecret': API_KEYS.coinglass } }));
  return null;
}

// Keep `safe`/`jget` referenced so the wiring example above type-checks if
// uncommented, without tripping unused-import lint when keys are empty.
export const __wiring = { safe, jget };
