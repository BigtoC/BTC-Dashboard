import type { Page, Route } from '@playwright/test';

// ── deterministic market-data fixtures ───────────────────────────────────────
// Mirror the exact shapes the rebuilt Binance data layer parses, so the E2E
// suite verifies the OKX→Binance migration + engine rendering fully offline.

const BASE_PRICE = 60_000;

/** Binance kline rows: [openTime, o, h, l, c, v, closeTime, qVol, trades,
 *  takerBuyBase, takerBuyQuote, ignore]. Gentle uptrend + deterministic noise. */
export function genKlines(count = 210): (string | number)[][] {
  const out: (string | number)[][] = [];
  let price = BASE_PRICE;
  let ts = 1_700_000_000_000;
  for (let i = 0; i < count; i++) {
    const open = price;
    price = price + 8 + Math.sin(i / 5) * BASE_PRICE * 0.0015;
    const close = price;
    const high = Math.max(open, close) * 1.0008;
    const low = Math.min(open, close) * 0.9992;
    const vol = 120 + (i % 11) * 4;
    const tbv = vol * 0.56; // 56% taker-buy
    out.push([
      ts,
      open.toFixed(2), high.toFixed(2), low.toFixed(2), close.toFixed(2),
      vol.toFixed(4), ts + 60_000, (vol * close).toFixed(2), 80,
      tbv.toFixed(4), (tbv * close).toFixed(2), '0',
    ]);
    ts += 60_000;
  }
  return out;
}

const ticker24hr = { symbol: 'BTCUSDT', lastPrice: '60480.50', priceChangePercent: '1.84', openPrice: '59390.00', highPrice: '60900.00', lowPrice: '59100.00', volume: '12345.6789', weightedAvgPrice: '60100.00' };
const premiumIndex = { symbol: 'BTCUSDT', markPrice: '60485.0', indexPrice: '60470.0', lastFundingRate: '0.00012', nextFundingTime: 1_700_000_000_000, interestRate: '0.0001', time: 1_700_000_000_000 };

function oiHist() {
  const out = [];
  let oi = 80_000;
  let ts = 1_700_000_000_000;
  for (let i = 0; i < 30; i++) {
    oi += 120 + Math.sin(i / 3) * 200; // net increase → "OI up"
    out.push({ symbol: 'BTCUSDT', sumOpenInterest: oi.toFixed(3), sumOpenInterestValue: (oi * 60_000).toFixed(2), timestamp: ts });
    ts += 300_000;
  }
  return out;
}

function lsRatio() {
  return [{ symbol: 'BTCUSDT', longShortRatio: '1.12', longAccount: '0.528', shortAccount: '0.472', timestamp: 1_700_000_000_000 }];
}

function depth() {
  const bids: [string, string][] = [];
  const asks: [string, string][] = [];
  for (let i = 0; i < 25; i++) {
    bids.push([(60_400 - i * 5).toFixed(2), (1.5 + i * 0.05).toFixed(3)]); // slightly heavier bids
    asks.push([(60_500 + i * 5).toFixed(2), (1.2 + i * 0.04).toFixed(3)]);
  }
  return { lastUpdateId: 1, bids, asks };
}

/** Build a future Deribit expiry code (e.g. "27JUN26") `daysAhead` from now. */
function expiryCode(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return `${d.getUTCDate()}${mon}${String(d.getUTCFullYear()).slice(2)}`;
}

function deribitOptions() {
  const result = [];
  for (const days of [10, 40]) {
    const exp = expiryCode(days);
    for (let strike = 52_000; strike <= 68_000; strike += 2_000) {
      const mny = strike / BASE_PRICE;
      const iv = 55 + Math.abs(1 - mny) * 60; // smile
      for (const type of ['C', 'P']) {
        result.push({
          instrument_name: `BTC-${exp}-${strike}-${type}`,
          open_interest: type === 'P' ? 1400 - Math.abs(strike - 58_000) / 40 : 1100 - Math.abs(strike - 62_000) / 40,
          mark_iv: iv,
          underlying_price: BASE_PRICE + 480,
        });
      }
    }
  }
  return { jsonrpc: '2.0', result, usIn: 0, usOut: 0 };
}

const fng = { name: 'Fear and Greed Index', data: [{ value: '45', value_classification: 'Fear', timestamp: '1700000000' }, { value: '52', value_classification: 'Neutral', timestamp: '1699913600' }] };
const coingecko = { data: { active_cryptocurrencies: 10000, market_cap_percentage: { btc: 54.3, eth: 17.1 }, market_cap_change_percentage_24h_usd: 1.27 } };
const mempoolFee = { fastestFee: 38, halfHourFee: 30, hourFee: 22, economyFee: 12, minimumFee: 5 };
const mempoolHash = { currentHashrate: 6.2e20, currentDifficulty: 8.3e13 };

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

function xml(route: Route, body: string) {
  return route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/xml', 'access-control-allow-origin': '*' },
    body,
  });
}

// ── keyless macro / on-chain fixtures ────────────────────────────────────────
const frankfurterRange = {
  amount: 1.0,
  base: 'USD',
  start_date: '2026-06-06',
  end_date: '2026-06-15',
  rates: {
    '2026-06-06': { EUR: 0.86, JPY: 159.0, GBP: 0.743, CAD: 1.39, SEK: 9.3, CHF: 0.79 },
    '2026-06-15': { EUR: 0.86155, JPY: 160.19, GBP: 0.74509, CAD: 1.3981, SEK: 9.3887, CHF: 0.79366 },
  },
};

const treasuryXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns:m="http://x" xmlns:d="http://y">
  <entry><content><m:properties>
    <d:NEW_DATE m:type="Edm.DateTime">2026-06-08T00:00:00</d:NEW_DATE>
    <d:BC_10YEAR m:type="Edm.Double">4.40</d:BC_10YEAR>
  </m:properties></content></entry>
  <entry><content><m:properties>
    <d:NEW_DATE m:type="Edm.DateTime">2026-06-15T00:00:00</d:NEW_DATE>
    <d:BC_10YEAR m:type="Edm.Double">4.47</d:BC_10YEAR>
  </m:properties></content></entry>
</feed>`;

const coinMetricsMvrv = {
  data: [
    { asset: 'btc', time: '2026-06-14T00:00:00.000000000Z', CapMVRVCur: '1.2276' },
    { asset: 'btc', time: '2026-06-15T00:00:00.000000000Z', CapMVRVCur: '1.2394' },
  ],
};

/** Register every market-data route + a mock Binance WebSocket. Call before goto. */
export async function setupMocks(page: Page): Promise<void> {
  const klines = genKlines();
  await page.route('**/api/v3/klines*', (r) => json(r, klines));
  await page.route('**/api/v3/ticker/24hr*', (r) => json(r, ticker24hr));
  await page.route('**/fapi/v1/premiumIndex*', (r) => json(r, premiumIndex));
  await page.route('**/futures/data/openInterestHist*', (r) => json(r, oiHist()));
  await page.route('**/futures/data/globalLongShortAccountRatio*', (r) => json(r, lsRatio()));
  await page.route('**/api/v3/depth*', (r) => json(r, depth()));
  await page.route('**/deribit.com/**', (r) => json(r, deribitOptions()));
  await page.route('**/alternative.me/**', (r) => json(r, fng));
  await page.route('**/coingecko.com/**', (r) => json(r, coingecko));
  await page.route('**/mempool.space/api/v1/fees/**', (r) => json(r, mempoolFee));
  await page.route('**/mempool.space/api/v1/mining/**', (r) => json(r, mempoolHash));
  // keyless macro / on-chain extras
  await page.route('**/frankfurter.dev/**', (r) => json(r, frankfurterRange));
  await page.route('**/home.treasury.gov/**', (r) => xml(r, treasuryXml));
  await page.route('**/coinmetrics.io/**', (r) => json(r, coinMetricsMvrv));

  // Mock the Binance WS so no real connection is attempted (no server connect ⇒
  // the client sees an open socket; the page already renders from the REST seed).
  await page.routeWebSocket(/stream\.binance\.com/, () => {
    /* mock mode: do not connect to a real server */
  });
}
