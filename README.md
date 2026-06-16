# BTC Multi-Timeframe Up/Down Composite Predictor

A real-time Bitcoin **multi-timeframe up/down composite prediction** dashboard,
rebuilt with [Astro](https://astro.build) + [pnpm](https://pnpm.io). It computes
a trend-dominant weighted score across **27 factors / 10 categories** for six
timeframes (5m · 15m · 30m · 1h · 4h · 1d), with a live price feed, sparkline,
factor breakdown, and a global market-state gauge.

> ⚠️ **Research only — not investment advice.** Leveraged contracts are
> extremely risky; always set your own stop-loss and position sizing.

| 中文                                          | English                                     |
|---------------------------------------------|---------------------------------------------|
| ![Chinese UI](screenshots/dashboard-zh.png) | ![English UI](screenshots/dashboard-en.png) |

## Credits

This is a faithful rebuild of the original single-file HTML dashboard by
**[ZAIJIN88](https://github.com/ZAIJIN88/-)** — <https://github.com/ZAIJIN88/->.
All of the scoring methodology, factor design, category weights, and the visual
design originate from that project. This repository ports it to a modern Astro
toolchain, swaps the data source, and adds bilingual support.

## What changed vs. the original

- **Astro + pnpm + TypeScript.** The single 460-line HTML file is decomposed
  into typed modules (`engine`, `indicators`, `binance`, `render`, `i18n`) and
  bundled by Vite. The indicator math and the composite-scoring algorithm are
  ported **1:1** — numeric output is identical.
- **OKX → Binance data sources.** Every OKX endpoint is replaced with its
  Binance equivalent (the public, **keyless** endpoints in
  [Data sources](#data-sources-all-public-no-api-key) below). No data is dropped:

  | Feed             | OKX (original)                       | Binance (this build)                        |
  |------------------|--------------------------------------|---------------------------------------------|
  | Candles          | `/api/v5/market/candles`             | `/api/v3/klines`                            |
  | 24h ticker       | `/api/v5/market/ticker`              | `/api/v3/ticker/24hr`                       |
  | Funding          | `/api/v5/public/funding-rate`        | `/fapi/v1/premiumIndex`                     |
  | Open interest    | `rubik/.../open-interest-volume`     | `/futures/data/openInterestHist`            |
  | Long/short ratio | `rubik/.../long-short-account-ratio` | `/futures/data/globalLongShortAccountRatio` |
  | Taker buy/sell   | `rubik/.../taker-volume`             | derived from klines `takerBuyBase`          |
  | Order book       | `/api/v5/market/books`               | `/api/v3/depth`                             |
  | Live stream      | OKX WebSocket                        | Binance combined WS (`@trade` + `@ticker`)  |

  Deribit options, Alternative.me Fear & Greed, CoinGecko dominance and
  mempool.space (fees + hashrate) are unchanged — they were already keyless.
- **Bilingual CN / EN toggle.** Every string — including the dynamically
  generated factor notes — is routed through an i18n layer. Click **EN / 中文**
  in the header; the choice persists in `localStorage`.
- **Two formerly-paid factors are now keyless.** `dxy` (DXY proxy + US 10Y
  yield) and `mvrv` are computed from free, keyless, CORS-enabled feeds — see
  [Keyless macro & on-chain factors](#keyless-macro--on-chain-factors) and
  [`src/lib/extra-sources.ts`](src/lib/extra-sources.ts).
- **The remaining API-key (paid) factors are built but inert.** Spot ETF net
  inflow, SOPR, exchange netflow, and the Coinglass liquidation heatmap have no
  free keyless path, so they are scaffolded in
  [`src/lib/paid-sources.ts`](src/lib/paid-sources.ts) with an empty-by-default
  key config. With keys blank they render as **“needs API key”** stubs and never
  break the app — see [`.env.example`](.env.example).

### Two improvements that fell out of the migration

Switching to Binance didn't just preserve the original — it fixed two factors
that were effectively dead in the OKX build:

1. **Real per-bar taker direction.** Binance klines expose `takerBuyBase`
   (kline column 9), so the **current-bar taker buy %** factor (`takervol`) and
   the **market taker buy/sell ratio** (`takerg`) now use genuine taker-side
   volume. OKX candle data carries no per-bar taker direction, so the original
   synthesized it as `volume / 2` — i.e. a constant ~50%, contributing no real
   signal. (`src/lib/binance.ts` → `binanceCandles`/`normGlobals`,
   `src/lib/engine.ts` → `priceFactors`.)
2. **Deribit options factors actually compute.** The original passed Deribit's
   raw `{ result: [...] }` envelope straight into `computeOptions`, whose first
   guard (`!arr.length`) silently returned `null` — disabling **Put/Call ratio
   (`pcr`)**, **25Δ skew (`skew`)**, **max pain (`maxpain`)** and **ATM implied
   volatility (`ivol`)** on every cycle, even though the UI advertised them as
   “已接入 / connected”. This build extracts `.result` (`deribitArray` in
   `src/lib/binance.ts`), so all four options factors compute as intended.

## Factors & scoring — every data point used to predict price

The verdict for each timeframe is a weighted blend of **~37 data points across
10 categories**. Most carry a directional score (−100 bearish … +100 bullish)
and a confidence weight; a few are informational; the genuinely-paid ones render
as stubs. The endpoint behind each one is in [Data sources](#data-sources-all-public-no-api-key).

**Legend:** ✅ scored · ℹ️ info-only (shown, score 0) · 🔑 needs API key (stub) · ⚪ not in the keyless data set
&nbsp;&nbsp;·&nbsp;&nbsp; *Conf.* = confidence weight within its category.

### Per-timeframe factors

Recomputed independently for **each** of the 6 timeframes (5m · 15m · 30m · 1h · 4h · 1d) from that timeframe's Binance klines.

**📈 Technicals**

| Factor    | Data point                                                  | Conf.        |
|-----------|-------------------------------------------------------------|--------------|
| `ema` ✅   | EMA 21 / 50 / 200 trend alignment (price vs EMAs, stacking) | 0.80         |
| `macd` ✅  | MACD line vs zero + histogram momentum change               | 0.70         |
| `rsi` ✅   | RSI(14): overbought/oversold extremes + trend momentum      | 0.45         |
| `stoch` ✅ | Stochastic %K position in the 14-bar range                  | 0.35         |
| `boll` ✅  | Bollinger-band position + squeeze (width) detection         | 0.20–0.30    |
| `adx` ✅   | ADX trend strength + directional index (+DI vs −DI)         | ≤1.0 (∝ ADX) |
| `obv` ✅   | On-Balance-Volume slope (volume-price confirmation)         | 0.50         |
| `vwap` ✅  | Price deviation from 30-bar VWAP                            | 0.55         |

**📐 Levels / Support & Resistance**

| Factor  | Data point                                               | Conf. |
|---------|----------------------------------------------------------|-------|
| `sr` ✅  | Distance to 60-bar high/low, in ATR units                | 0.60  |
| `fib` ✅ | Position within the recent range (Fibonacci retracement) | 0.45  |

**🧭 Market Structure**

| Factor  | Data point                                                       | Conf. |
|---------|------------------------------------------------------------------|-------|
| `ms` ✅  | Higher-highs/higher-lows vs lower-highs/lower-lows (BOS / CHoCH) | 0.70  |
| `mom` ✅ | Net price momentum over the last 5 bars (ATR-normalized)         | 0.55  |

**💹 Price & Volume Momentum**

| Factor       | Data point                                                    | Conf. |
|--------------|---------------------------------------------------------------|-------|
| `takervol` ✅ | Current-bar taker-buy share (Binance `takerBuyBase` / volume) | 0.40  |
| `volexp` ✅   | Volume vs 20-bar average × candle direction (expansion)       | 0.45  |

### Global factors (shared across all timeframes)

**⚙️ Derivatives / Options**

| Factor      | Data point                                           | Source                      | Conf.                       |
|-------------|------------------------------------------------------|-----------------------------|-----------------------------|
| `funding` ✅ | Perp funding rate (contrarian: hot longs → bearish)  | premiumIndex                | 0.70                        |
| `oi` ✅      | Open-interest Δ × price Δ, 4-quadrant rule           | openInterestHist + ticker   | 0.60                        |
| `lsacct` ✅  | Retail long/short account ratio (contrarian)         | globalLongShortAccountRatio | 0.55                        |
| `takerg` ✅  | Market taker buy/sell ratio (from 5m `takerBuyBase`) | klines                      | 0.50                        |
| `pcr` ✅     | Options Put/Call ratio (open interest)               | Deribit                     | 0.50                        |
| `skew` ✅    | Options 25Δ risk-reversal skew                       | Deribit                     | 0.50                        |
| `lstop` ⚪   | Top-trader long/short ratio                          | —                           | dropped (no keyless source) |

**🔍 Overlooked Angles**

| Factor      | Data point                                        | Source       | Conf.     |
|-------------|---------------------------------------------------|--------------|-----------|
| `maxpain` ✅ | Options max-pain strike "gravity" vs spot         | Deribit      | 0.25–0.50 |
| `obi` ✅     | Order-book bid/ask wall imbalance (top 50 levels) | depth        | 0.40      |
| `crowd` ✅   | Leverage crowding / reflexivity (extreme funding) | premiumIndex | 0.20–0.50 |
| `liqmap` 🔑 | Liquidation heatmap / magnet zones                | Coinglass    | —         |

**🎭 Sentiment & Alt Data**

| Factor    | Data point                                      | Source         | Conf.       |
|-----------|-------------------------------------------------|----------------|-------------|
| `fng` ✅   | Fear & Greed index (contrarian at extremes)     | alternative.me | 0.50        |
| `ivol` ℹ️ | Options ATM implied volatility (regime context) | Deribit        | 0 (display) |

**🏦 Flows & Macro**

| Factor   | Data point                                                                | Source                    | Conf. |
|----------|---------------------------------------------------------------------------|---------------------------|-------|
| `dom` ✅  | BTC market-cap dominance, 24h change                                      | CoinGecko                 | 0.40  |
| `dxy` ✅  | US Dollar Index proxy + US 10Y yield (risk-off when rising) — **keyless** | Frankfurter + US Treasury | 0.40  |
| `etf` 🔑 | Spot BTC ETF net inflow (USD)                                             | SoSoValue / Farside       | —     |

**⛓️ On-chain**

| Factor       | Data point                                      | Source                  | Conf.          |
|--------------|-------------------------------------------------|-------------------------|----------------|
| `mvrv` ✅     | MVRV ratio — valuation top/bottom — **keyless** | Coin Metrics            | 0.40           |
| `mempool` ℹ️ | Mempool fee congestion (demand proxy)           | mempool.space           | 0.30 (score 0) |
| `hash` ℹ️    | Network hashrate (security/stability)           | mempool.space           | 0.25 (score 0) |
| `sopr` 🔑    | SOPR / STH-SOPR profit-taking pressure          | Glassnode / CryptoQuant | —              |
| `netflow` 🔑 | Exchange net inflow / outflow                   | Glassnode / CryptoQuant | —              |

**📰 News / Event Watch**

| Factor     | Data point                             | Source   | Conf. |
|------------|----------------------------------------|----------|-------|
| `macro` 🔑 | Macro calendar (CPI / FOMC / NFP)      | provider | —     |
| `reg` 🔑   | Regulation / hacks / black-swan events | provider | —     |

### How the data points combine into a prediction

1. **Per category** — a confidence-weighted average of its *available* factors: `Σ(score·conf) / Σconf`. Info-only factors (`conf = 0`) are excluded; `🔑` stubs and `⚪` factors are excluded entirely.
2. **Composite** — categories are blended by per-timeframe weight (table below), then sharpened: `composite = tanh(rawWeightedScore · 6)`, clamped to [−1, +1].
3. **Confidence** — `0.55·|composite| + 0.30·agreement + 0.15·coverage`, where *agreement* is how aligned the active factors' signs are and *coverage* is the share of category weight that had data.
4. **Direction** — `> +0.05` ⇒ **Long ▲**, `< −0.05` ⇒ **Short ▼**, else **Neutral ●**.

**Category weights per timeframe** (the shorter the timeframe, the more technicals dominate; the longer, the more flows/on-chain matter):

| Category       | 5m  | 15m | 30m | 1h  | 4h  | 1d  |
|----------------|-----|-----|-----|-----|-----|-----|
| Technicals     | 34% | 34% | 33% | 30% | 28% | 24% |
| Levels         | 12% | 12% | 11% | 10% | 9%  | 8%  |
| Structure      | 14% | 15% | 16% | 18% | 18% | 16% |
| Price & Volume | 12% | 10% | 9%  | 7%  | 5%  | 4%  |
| Derivatives    | 16% | 15% | 15% | 14% | 12% | 10% |
| Sentiment      | 3%  | 4%  | 4%  | 6%  | 7%  | 9%  |
| Flows & Macro  | 1%  | 2%  | 3%  | 5%  | 8%  | 12% |
| On-chain       | 1%  | 2%  | 3%  | 5%  | 9%  | 13% |
| Overlooked     | 6%  | 5%  | 5%  | 4%  | 3%  | 3%  |
| News           | 1%  | 1%  | 1%  | 1%  | 1%  | 1%  |

## Data sources (all public, no API key)

These are the public market-data endpoints that feed the **live** composite (the
~27-factor signal originally computed upstream by `engine.compute_tf_detail`,
assembled in `live_data.py` and consumed by `btcls_paper.py` /
`btcls_polymarket.py` — which this dashboard mirrors in the browser). All require
**no API key / auth**, and every fetch is **fail-soft**: a down source returns
`None`/`{ok:false}` and its factor simply drops from the composite's weighted sum
(`available=false`) rather than failing the cycle.

| #  | Method & URL                                                             | Params                                         | Feeds (factor → category)                                                                                                                                                                                          | Reference fn (`live_data.py`)             |
|----|--------------------------------------------------------------------------|------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------|
| 1  | `GET https://api.binance.com/api/v3/klines`                              | `symbol=BTCUSDT`, `interval` (per TF), `limit` | **Core price predictor** — `ema`,`macd`,`rsi`,`stoch`,`boll`,`adx`,`obv`,`vwap` (technicals); `sr`,`fib` (levels); `ms`,`mom` (structure); `takervol`,`volexp` (price); `takerg` (derivatives, via `takerBuyBase`) | `fetch_binance_klines` / `compute_takerg` |
| 2  | `GET https://fapi.binance.com/fapi/v1/premiumIndex`                      | `symbol=BTCUSDT`                               | `funding` (derivatives) + `crowd` (overlooked)                                                                                                                                                                     | `fetch_binance_funding`                   |
| 3  | `GET https://api.binance.com/api/v3/ticker/24hr`                         | `symbol=BTCUSDT`                               | 24h price change — paired with OI for the `oi` 4-quadrant rule                                                                                                                                                     | `fetch_binance_price_change_pct`          |
| 4  | `GET https://fapi.binance.com/futures/data/openInterestHist`             | `symbol=BTCUSDT`, `period=5m`, `limit=30`      | `oi` (derivatives)                                                                                                                                                                                                 | `fetch_binance_oi_change`                 |
| 5  | `GET https://fapi.binance.com/futures/data/globalLongShortAccountRatio`  | `symbol=BTCUSDT`, `period=5m`, `limit=1`       | `lsacct` (derivatives)                                                                                                                                                                                             | `fetch_binance_ls`                        |
| 6  | `GET https://api.binance.com/api/v3/depth`                               | `symbol=BTCUSDT`, `limit=50`                   | `obi` — order-book imbalance (overlooked)                                                                                                                                                                          | `fetch_binance_book_imbalance`            |
| 7  | `GET https://www.deribit.com/api/v2/public/get_book_summary_by_currency` | `currency=BTC`, `kind=option`                  | `pcr`, `skew`, `maxpain` (derivatives/overlooked); `ivol` (info-only, excluded)                                                                                                                                    | `fetch_deribit_options`                   |
| 8  | `GET https://api.alternative.me/fng/?limit=2`                            | —                                              | `fng` — Fear & Greed (sentiment)                                                                                                                                                                                   | `fetch_fng`                               |
| 9  | `GET https://api.coingecko.com/api/v3/global`                            | —                                              | `dom` — BTC dominance change (flows)                                                                                                                                                                               | `fetch_dominance_change`                  |
| 10 | `GET https://mempool.space/api/v1/fees/recommended`                      | —                                              | `mempool` (onchain, info-only — score 0)                                                                                                                                                                           | `fetch_mempool_fee`                       |
| 11 | `GET https://mempool.space/api/v1/mining/hashrate/1m`                    | —                                              | `hash` (onchain, info-only — score 0)                                                                                                                                                                              | `fetch_hashrate`                          |

### Notes

- **No API key**: all endpoints above are public read-only market data. The
  factors with no free keyless path (spot ETF inflow, SOPR, exchange netflow,
  Coinglass liquidations, macro calendar, news) are stubbed — see
  [API-key (paid) factors](#what-changed-vs-the-original) above. `dxy` and `mvrv`
  used to be in that paid set but are now keyless (next subsection).
- **Klines drive the bulk of the signal**; the rest are the snapshot/derivative
  factors that a price-only backtest can't test (and that the live recorder
  accrues forward).
- **Geo note**: `api.binance.com` / `fapi.binance.com` are blocked in some
  regions (e.g. the US). From a blocked IP those calls fail and the composite
  degrades (factors drop) — it does not crash. Likewise Deribit / Fear & Greed /
  CoinGecko may be unreachable in some regions and degrade gracefully.
- **Polling**: the dashboard polls a handful of calls per cycle (1s price ticker,
  12s kline refresh, 20s globals, 5-min macro/on-chain extras), well within rate
  limits, plus a live `@trade` / `@ticker` WebSocket.

### Keyless macro & on-chain factors

Two factors the original gated behind paid keys are now sourced from free,
keyless, CORS-enabled feeds (fetched in [`src/lib/extra-sources.ts`](src/lib/extra-sources.ts),
refreshed every 5 min, fail-soft):

| Factor               | Source (keyless, CORS *)              | Endpoint                                                                                                                                                             |
|----------------------|---------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `dxy` — DXY proxy    | Frankfurter (ECB FX, no quotas)       | `GET https://api.frankfurter.dev/v1/{start}..{end}?base=USD&symbols=EUR,JPY,GBP,CAD,SEK,CHF` → ICE DXY formula computed client-side                                  |
| `dxy` — US 10Y yield | US Treasury daily yield-curve XML     | `GET https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value={year}` → `BC_10YEAR` |
| `mvrv` — BTC MVRV    | Coin Metrics Community (`CapMVRVCur`) | `GET https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d`                                                    |

> ℹ️ Coin Metrics community data is **CC BY-NC 4.0** (non-commercial). SOPR and
> exchange netflow have **no** free keyless source (Coin Metrics community
> exposes only MVRV), so they remain paid stubs.

## Getting started

```bash
pnpm install
pnpm dev          # http://localhost:4321
```

| Command         | Description                                       |
|-----------------|---------------------------------------------------|
| `pnpm dev`      | Start the dev server                              |
| `pnpm build`    | Build the static site to `dist/`                  |
| `pnpm preview`  | Preview the production build                      |
| `pnpm check`    | `astro check` — TypeScript / template diagnostics |
| `pnpm test:e2e` | Run the Playwright E2E suite                      |

## End-to-end verification

The Playwright suite ([`tests/e2e`](tests/e2e)) mocks every network call with
deterministic fixtures, so it verifies the OKX→Binance migration and the engine
**offline and reproducibly**. It covers:

- six timeframe cards render with direction, score and confidence;
- live price + 24h change from the Binance ticker;
- all 10 factor categories with factor rows;
- Deribit options factors are wired in;
- the global market-state gauge;
- keyless `dxy` + `mvrv` render real values (not stubs);
- the remaining API-key (paid) factors render as stubs **without breaking** the app;
- no uncaught page errors during a live cycle;
- the CN→EN toggle translates the entire UI with **zero Chinese leaks**, and the
  choice persists across reload.

```bash
pnpm exec playwright install chromium   # first run only
pnpm test:e2e
```

## Project structure

```
src/
  pages/index.astro      # page shell + chrome (data-i18n hooks)
  scripts/app.ts         # realtime engine + bootstrap + language toggle
  lib/
    binance.ts           # Binance data layer (the OKX→Binance migration)
    engine.ts            # factor builders + composite scoring (1:1 port)
    indicators.ts        # pure TA math (EMA/MACD/RSI/ADX/…)
    render.ts            # DOM rendering
    i18n.ts              # CN/EN dictionary + t()
    config.ts            # endpoints + (empty) API-key config
    extra-sources.ts     # keyless DXY/10Y (Treasury+Frankfurter) + MVRV (Coin Metrics)
    paid-sources.ts      # scaffolding for the remaining premium/keyed factors
    constants.ts         # timeframes, category weights, icons
    types.ts             # shared types
  styles/dashboard.css   # original styles, verbatim
tests/e2e/               # Playwright suite + fixtures
```
