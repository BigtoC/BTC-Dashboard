// Static configuration shared by the engine and the renderer.
import type { TF, Category } from './types';

export const TF_LIST: TF[] = ['5m', '15m', '30m', '1h', '4h', '1d'];

/** Binance kline interval per timeframe (lowercase — unlike OKX's `1H`/`1D`). */
export const BINANCE_INTERVAL: Record<TF, string> = {
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

export const CAT_ORDER: Category[] = [
  'technicals',
  'levels',
  'structure',
  'price',
  'derivatives',
  'sentiment',
  'flows',
  'onchain',
  'overlooked',
  'news',
];

export const CAT_ICONS: Record<Category, string> = {
  technicals: '📈',
  levels: '📐',
  structure: '🧭',
  price: '💹',
  derivatives: '⚙️',
  sentiment: '🎭',
  flows: '🏦',
  onchain: '⛓️',
  overlooked: '🔍',
  news: '📰',
};

export const WEIGHTS: Record<TF, Record<Category, number>> = {
  '5m': { technicals: 0.34, levels: 0.12, structure: 0.14, price: 0.12, derivatives: 0.16, sentiment: 0.03, flows: 0.01, onchain: 0.01, overlooked: 0.06, news: 0.01 },
  '15m': { technicals: 0.34, levels: 0.12, structure: 0.15, price: 0.1, derivatives: 0.15, sentiment: 0.04, flows: 0.02, onchain: 0.02, overlooked: 0.05, news: 0.01 },
  '30m': { technicals: 0.33, levels: 0.11, structure: 0.16, price: 0.09, derivatives: 0.15, sentiment: 0.04, flows: 0.03, onchain: 0.03, overlooked: 0.05, news: 0.01 },
  '1h': { technicals: 0.3, levels: 0.1, structure: 0.18, price: 0.07, derivatives: 0.14, sentiment: 0.06, flows: 0.05, onchain: 0.05, overlooked: 0.04, news: 0.01 },
  '4h': { technicals: 0.28, levels: 0.09, structure: 0.18, price: 0.05, derivatives: 0.12, sentiment: 0.07, flows: 0.08, onchain: 0.09, overlooked: 0.03, news: 0.01 },
  '1d': { technicals: 0.24, levels: 0.08, structure: 0.16, price: 0.04, derivatives: 0.1, sentiment: 0.09, flows: 0.12, onchain: 0.13, overlooked: 0.03, news: 0.01 },
};
