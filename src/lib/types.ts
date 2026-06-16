// Shared types for the BTC composite-prediction engine.

export type TF = '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export type Category =
  | 'technicals'
  | 'levels'
  | 'structure'
  | 'price'
  | 'derivatives'
  | 'sentiment'
  | 'flows'
  | 'onchain'
  | 'overlooked'
  | 'news';

/** A single OHLCV candle, normalized across data sources.
 *  `tbv` = taker-buy base volume (Binance provides this per-kline; OKX did not). */
export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  tbv: number;
}

/** One scored prediction factor. `score` ∈ [-1,1] (−1 bearish … +1 bullish),
 *  `confidence` ∈ [0,1]. `available=false` means the source needs an API key
 *  (or is unreachable) and the factor is excluded from the composite. */
export interface Factor {
  id: string;
  name: string;
  category: Category;
  score: number;
  confidence: number;
  value: string;
  note: string;
  available: boolean;
}

/** A fail-soft wrapper around a fetch: either a value, or an error string. */
export type Safe<T> = { ok: true; v: T } | { ok: false; e: string };

export interface TickerData {
  lastPrice: number;
  priceChangePercent: number;
}

/** The normalized global market snapshot consumed by the engine. Field names
 *  mirror the original Binance-compatible shape. */
export interface GlobalData {
  klines: Record<TF, Candle[] | null>;
  ticker: Safe<TickerData>;
  premium: Safe<{ lastFundingRate: string | number }>;
  oiNow: Safe<unknown>;
  oiHist: Safe<{ sumOpenInterest: number }[]>;
  lsAcct: Safe<{ longShortRatio: number }[]>;
  lsTop: Safe<{ longShortRatio: number }[]>;
  taker: Safe<{ buySellRatio: number }[]>;
  depth: Safe<{ bids: [string, string][]; asks: [string, string][] }>;
  deribit: Safe<DeribitOption[]>;
  fng: Safe<{ data: { value: string | number; value_classification: string }[] }>;
  cg: Safe<{ data: { market_cap_percentage: { btc: number }; market_cap_change_percentage_24h_usd: number } }>;
  memFee: Safe<{ fastestFee: number }>;
  hashr: Safe<{ currentHashrate: number }>;
}

export interface DeribitOption {
  instrument_name?: string;
  open_interest?: number;
  mark_iv?: number;
  underlying_price?: number;
}

export interface OptionsSummary {
  price: number;
  pc: number | null;
  skew: number | null;
  atmIV: number | null;
  maxPain: number | null;
  mpDte: number;
}

export interface CatScore {
  score: number | null;
  factors: Factor[];
  weight: number;
}

export interface TFResult {
  tf: TF;
  composite: number;
  raw: number;
  confidence: number;
  catScores: Record<Category, CatScore>;
  coverage: number;
}
