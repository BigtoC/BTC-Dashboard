import { test, expect } from '@playwright/test';
import { setupMocks } from './fixtures';

const CJK = /[一-鿿]/;

test.beforeEach(async ({ page }) => {
  // Each test runs in a fresh context (empty localStorage), so the dashboard
  // starts in its Chinese default unless a test toggles + reloads.
  await setupMocks(page);
});

test('renders all six timeframe cards with direction + score', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('.tf-card');
  await expect(cards).toHaveCount(6);
  // Each card shows a direction word and a composite/confidence block.
  await expect(cards.first().locator('.dir')).toBeVisible();
  await expect(cards.first().locator('.score-bar .mark')).toBeVisible();
  await expect(page.locator('.tf-name')).toHaveText(['5 分钟', '15 分钟', '30 分钟', '1 小时', '4 小时', '1 天']);
});

test('live price + 24h change render from the Binance ticker', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#price')).toContainText('$');
  await expect(page.locator('#price')).not.toHaveText('--');
  await expect(page.locator('#chg')).toContainText('%');
});

test('factor breakdown renders all 10 categories with factor rows', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#breakdown .cat')).toHaveCount(10);
  // Default selected timeframe is 1h, technicals open with real factors.
  await expect(page.locator('.tf-card.sel')).toHaveCount(1);
  await expect(page.locator('#breakdown .factor').first()).toBeVisible();
  // The EMA technical factor must be present (engine produced it).
  await expect(page.locator('#breakdown')).toContainText('EMA 趋势排列');
});

test('Deribit options factors are wired in (the original silently disabled them)', async ({ page }) => {
  await page.goto('/');
  // Put/Call, skew and max-pain only appear if computeOptions received a real
  // array — proving the .result extraction fix works.
  await expect(page.locator('#breakdown')).toContainText('期权 Put/Call 比(OI)');
  await expect(page.locator('#breakdown')).toContainText('期权 25Δ 偏斜');
  await expect(page.locator('#globalGauge')).toContainText('最大痛点');
});

test('global gauge renders multiple live readings', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#globalGauge .g-item').first()).toBeVisible();
  expect(await page.locator('#globalGauge .g-item').count()).toBeGreaterThanOrEqual(5);
  await expect(page.locator('#globalGauge')).toContainText('资金费率');
});

test('API-key (paid) factors render as stubs without breaking the app', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#breakdown .cat')).toHaveCount(10); // wait for breakdown
  // 6 paid stubs remain: sopr, netflow, etf, liqmap, macro, reg.
  // (dxy + mvrv are now sourced keyless — see next test.)
  await expect(page.locator('#breakdown .factor.na')).toHaveCount(6);
  await expect(page.locator('#breakdown .pill', { hasText: '需接入' })).toHaveCount(6);
  // The app still produced six healthy cards alongside the stubs.
  await expect(page.locator('.tf-card')).toHaveCount(6);
});

test('keyless free sources (DXY + MVRV) render real values, not stubs', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#breakdown .cat')).toHaveCount(10);
  // MVRV (Coin Metrics) renders a real value and is NOT a "needs API key" stub.
  const mvrv = page.locator('#breakdown .factor', { hasText: 'MVRV' });
  await expect(mvrv).toHaveCount(1);
  await expect(mvrv).not.toHaveClass(/\bna\b/);
  await expect(mvrv.locator('.fv')).toHaveText('1.24');
  // DXY (Treasury + Frankfurter) renders a real index value and is not a stub.
  const dxy = page.locator('#breakdown .factor', { hasText: '美元指数' });
  await expect(dxy).toHaveCount(1);
  await expect(dxy).not.toHaveClass(/\bna\b/);
  await expect(dxy.locator('.fv')).not.toHaveText('需接入');
  await expect(dxy.locator('.fn small')).toContainText('DXY');
});

test('no uncaught page errors during a live cycle', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.locator('.tf-card')).toHaveCount(6);
  await page.waitForTimeout(1500); // let pollers + heartbeat tick
  expect(errors).toEqual([]);
});

test('CN→EN toggle translates the entire UI with no Chinese leaks', async ({ page }) => {
  await page.goto('/');
  // Starts Chinese.
  await expect(page.locator('.brand > span').first()).toHaveText('BTC 多周期涨跌综合预判系统');

  await page.locator('#langBtn').click();

  // Chrome + title switch to English.
  await expect(page.locator('.brand > span').first()).toHaveText('BTC Multi-TF Up/Down Composite Predictor');
  await expect(page).toHaveTitle(/BTC Multi-Timeframe Up\/Down Composite Predictor/);
  await expect(page.locator('.tf-name').first()).toHaveText('5 min');

  // Content regions must be fully translated — zero CJK characters.
  for (const sel of ['#tfGrid', '#breakdown', '#globalGauge', '.disclaimer']) {
    const text = await page.locator(sel).innerText();
    expect(text, `${sel} should contain no Chinese after switching to English`).not.toMatch(CJK);
  }
  // English factor wording is present; paid stubs now read "API key".
  await expect(page.locator('#breakdown')).toContainText('EMA Trend Alignment');
  await expect(page.locator('#breakdown .pill', { hasText: 'API key' })).toHaveCount(6);
});

test('language choice persists across reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#langBtn').click();
  await expect(page.locator('.brand > span').first()).toHaveText('BTC Multi-TF Up/Down Composite Predictor');
  await page.reload();
  await expect(page.locator('.brand > span').first()).toHaveText('BTC Multi-TF Up/Down Composite Predictor');
});

test('clicking a timeframe card updates the breakdown selection', async ({ page }) => {
  await page.goto('/');
  const card5m = page.locator('.tf-card[data-tf="5m"]');
  await card5m.click();
  await expect(card5m).toHaveClass(/sel/);
  await expect(page.locator('#selTf')).toContainText('5 分钟');
});
