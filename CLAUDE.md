# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A real-time BTC **multi-timeframe up/down composite prediction** dashboard. It scores 27 factors across 10 categories for 6 timeframes (5m·15m·30m·1h·4h·1d) entirely in the browser from public, keyless market-data endpoints.

It is a **faithful 1:1 port** of an upstream single-file HTML dashboard (credited to ZAIJIN88 in `README.md`), rebuilt in Astro + TypeScript with two deliberate changes: the data source was swapped OKX → Binance, and a CN/EN i18n layer was added. **The scoring math is intentionally byte-for-byte equivalent to the original** — treat `engine.ts`/`indicators.ts` numeric logic as a frozen port, not code to "improve." Changing a formula changes the product.

## Commands

```bash
pnpm install
pnpm dev                              # dev server → http://localhost:4321
pnpm build                            # static build → dist/
pnpm preview                          # serve the production build
pnpm check                            # astro check — TS + .astro template diagnostics (run before committing)
pnpm test:e2e                         # Playwright E2E (auto-starts dev server)
pnpm test:e2e:ui                      # Playwright UI mode
pnpm exec playwright install chromium # first run only
pnpm exec playwright test -g "renders all six timeframe cards"   # single test by title
```

This repo pins `packageManager: pnpm@9.15.4` (corepack) in `package.json`. Keep that field — without it pnpm can misfire with a "configured to use yarn" error. Use pnpm, not npm/yarn.

## Architecture

Fully client-side static site (SSG) — there is **no server and no backend**. `src/pages/index.astro` is a static HTML shell (its default no-JS paint is Chinese); all behavior lives in the client entry `src/scripts/app.ts`. Every fetch goes browser → public exchange/3rd-party APIs directly.

Data flows in one direction through `src/lib/`:

```
app.ts (pollers + WS + bootstrap)
  → binance.ts   fetch + normalize raw APIs into the GlobalData shape
  → engine.ts    build Factor[] per timeframe + global, then scoreTF()
  → render.ts    paint the DOM (reads active language via t())
```

- **`binance.ts`** is the OKX→Binance migration layer. It fetches and normalizes every source into the `GlobalData` shape `engine.ts` expects. The OKX→Binance endpoint map and the per-bar `takerBuyBase` / Deribit `.result` fixes are documented in the file header and `README.md`.
- **`engine.ts`** is the ported prediction core. Per-timeframe factor builders (`technicalFactors`, `levelFactors`, `structureFactors`, `priceFactors`) run off klines; `globalFactors` builds cross-timeframe factors (derivatives, options, sentiment, flows, on-chain). `scoreTF` combines them into a composite per timeframe.
- **`indicators.ts`** is pure TA math (EMA/MACD/RSI/ADX/…), no I/O.
- **`constants.ts`** holds the timeframe list and the per-timeframe category `WEIGHTS` matrix — the weights are the heart of the scoring and differ by timeframe.
- **`config.ts`** centralizes endpoints + the (blank) `API_KEYS`. **`paid-sources.ts`** scaffolds premium/keyed factors that stay inert.

### Invariants to preserve

- **Fail-soft everywhere.** Every fetch is wrapped in `Safe<T>` (`{ok:true,v} | {ok:false,e}`). A down source must drop its factor (`available:false`) from the weighted composite, never throw and break the cycle. `scoreTF` only sums factors where `available && confidence > 0`, then renormalizes by the available weight. Preserve this when adding factors or sources.

- **Every user-facing string goes through `t(key, params)`** (`i18n.ts`) — including dynamically built factor `note`/`value` text. The engine recomputes from raw data on every render, so a language toggle is just `setLang` + re-render. Never hardcode a Chinese or English string in `engine.ts`/`render.ts`; add the key to **both** the `zh` and `en` dictionaries in `i18n.ts`. The E2E suite asserts **zero Chinese leaks** in the EN view (`CJK` regex), so a missed key fails tests. The `zh` dictionary preserves the original wording 1:1.

- **Adding a factor:** construct it with the `F(id, name, category, score, confidence, value, note, available?)` helper. `score ∈ [-1,1]` (−1 bearish … +1 bullish), `confidence ∈ [0,1]`. Push it into the right `Category` (must be one of `CAT_ORDER`). Paid/keyed factors render as inert stubs: `F(..., 0, 0, t('val.needKey'), ..., false)`.

### Polling cadence (`app.ts`)

A combined Binance WebSocket (`@trade` + `@ticker`) drives tick-by-tick price; a `setInterval` render-if-dirty loop (300ms) repaints. REST pollers: 1s price ticker, 12s kline refresh, 20s globals. WS failure degrades to a 1.5s REST fallback (`startRestFallback`). The render loop swallows errors to avoid render races during a language toggle.

## Testing

`tests/e2e/` (Playwright, chromium) mocks **every** network call with deterministic fixtures in `tests/e2e/fixtures.ts`, so the suite runs fully offline and reproducibly — it verifies the OKX→Binance migration, the engine output, the 10-category breakdown, that Deribit options factors actually compute, that paid stubs render without breaking, and the CN→EN toggle. When you add a data source or factor, add its mock to `fixtures.ts` or the deterministic suite will diverge. `playwright.config.ts` auto-starts `pnpm dev` and reuses an already-running server outside CI.
