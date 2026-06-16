// Endpoints and credentials configuration.
//
// All market-data endpoints below are PUBLIC and KEYLESS (see the "Data sources"
// table in README.md). DXY/Treasury yields and MVRV are now sourced keyless too
// (US Treasury XML, Frankfurter, Coin Metrics Community — see extra-sources.ts).
// The `API_KEYS` block stays empty for the factors with NO free keyless path
// (ETF flows, SOPR/exchange-flow, liquidation heatmap): those are *built* (see
// `paid-sources.ts`) but inert while their key is "" — they render as "needs API
// key" and never break the app. Drop a key here (or via PUBLIC_* env) to enable.

export const SYMBOL = 'BTCUSDT';

/** Public Binance hosts (no key). `fapi` = USDⓈ-M futures (funding, OI, L/S). */
export const BINANCE = {
  spot: 'https://api.binance.com',
  fapi: 'https://fapi.binance.com',
  ws: 'wss://stream.binance.com:9443/stream',
} as const;

export const DERIBIT_OPTIONS_URL =
  'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option';

// limit=2 per the data-source spec (the engine only reads the latest, data[0]).
export const FNG_URL = 'https://api.alternative.me/fng/?limit=2';
export const COINGECKO_GLOBAL_URL = 'https://api.coingecko.com/api/v3/global';
export const MEMPOOL_FEE_URL = 'https://mempool.space/api/v1/fees/recommended';
export const MEMPOOL_HASHRATE_URL = 'https://mempool.space/api/v1/mining/hashrate/1m';

// ── Free, keyless + CORS macro / on-chain sources (see extra-sources.ts) ──────
// US Treasury daily yield-curve XML (10Y). Keyless, Access-Control-Allow-Origin: *.
export const treasuryYieldUrl = (year: number): string =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
// Frankfurter (ECB FX). Keyless, no quotas, CORS *. Base for the DXY proxy.
export const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';
// Coin Metrics Community API (BTC MVRV). Keyless, CORS *. CC BY-NC 4.0.
export const COINMETRICS_COMMUNITY = 'https://community-api.coinmetrics.io/v4';

/** Premium data sources still requiring a paid/registered key — deliberately
 *  blank. Empty ⇒ that factor stays a "needs API key" stub and the app keeps
 *  working. (DXY/yields and MVRV are no longer here: they are now sourced from
 *  the keyless feeds above.) */
export interface ApiKeys {
  glassnode: string; // SOPR / exchange-flow (no keyless source found)
  cryptoquant: string; // SOPR / exchange-flow alternative
  coinglass: string; // liquidation heatmap
  etf: string; // spot ETF net inflow (SoSoValue / Farside-type provider)
}

export const API_KEYS: ApiKeys = {
  glassnode: readEnv('PUBLIC_GLASSNODE_KEY'),
  cryptoquant: readEnv('PUBLIC_CRYPTOQUANT_KEY'),
  coinglass: readEnv('PUBLIC_COINGLASS_KEY'),
  etf: readEnv('PUBLIC_ETF_KEY'),
};

function readEnv(name: string): string {
  try {
    // Vite exposes PUBLIC_*/import.meta.env at build time; default to "".
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return (env && env[name]) || '';
  } catch {
    return '';
  }
}
