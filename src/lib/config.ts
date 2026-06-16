// Endpoints and credentials configuration.
//
// All market-data endpoints below are PUBLIC and KEYLESS (see the "Data sources"
// table in README.md).
// The `API_KEYS` block is intentionally empty: the original dashboard surfaced
// several premium factors (ETF flows, Glassnode/CryptoQuant on-chain, Coinglass
// liquidation maps, macro). Those are *built* (see `paid-sources.ts`) but stay
// inert while their key is "" — they render as "needs API key" and never break
// the app. Drop a key in here (or via PUBLIC_* env at build time) to enable one.

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

/** Premium data sources — keys deliberately blank. Empty ⇒ feature stays a
 *  "needs API key" stub and the app keeps working. */
export interface ApiKeys {
  glassnode: string;
  cryptoquant: string;
  coinglass: string;
  etf: string; // e.g. a SoSoValue / Farside provider key
  fred: string; // macro (DXY / yields) via FRED
}

export const API_KEYS: ApiKeys = {
  glassnode: readEnv('PUBLIC_GLASSNODE_KEY'),
  cryptoquant: readEnv('PUBLIC_CRYPTOQUANT_KEY'),
  coinglass: readEnv('PUBLIC_COINGLASS_KEY'),
  etf: readEnv('PUBLIC_ETF_KEY'),
  fred: readEnv('PUBLIC_FRED_KEY'),
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
