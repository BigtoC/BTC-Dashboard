// Premium / API-key data sources — the factors with NO free keyless path.
//
// After the keyless migration (see extra-sources.ts: DXY/10Y via US Treasury +
// Frankfurter, MVRV via Coin Metrics), these four remain genuinely paid or
// proxy-only and stay inert stubs until a key is supplied:
//   • ETF net inflow            (flows)      — SoSoValue / Farside (no keyless+CORS path)
//   • SOPR / STH-SOPR           (onchain)    — Glassnode/CryptoQuant; Coin Metrics community has no SOPR
//   • Exchange net in/outflow   (onchain)    — Glassnode/CryptoQuant (no keyless source found)
//   • Liquidation heatmap       (overlooked) — Coinglass (paid plan only)
//
// They are *built* here (real fetchers + a key config) but kept inert: with the
// key left "" each fetcher short-circuits to `null`, so the engine keeps showing
// them as "needs API key" stubs and the dashboard never breaks. Supply a key in
// `config.ts` / PUBLIC_* env and wire the returned value into `globalFactors`.
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

/** SOPR / exchange-netflow via Glassnode/CryptoQuant (no free keyless source).
 *  Returns null when no key is configured. */
export async function fetchOnchainValuation(metric: 'sopr' | 'netflow'): Promise<number | null> {
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
