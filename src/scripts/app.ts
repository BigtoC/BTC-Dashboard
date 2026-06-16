// Realtime engine + bootstrap (client entry).
//
// Ported from the original dashboard's live engine, retargeted to Binance:
//   • 1s REST price poll (spot 24h ticker)  → price / sparkline / verdict move every second
//   • Binance combined WebSocket (trade + ticker) for tick-by-tick price
//   • 12s kline refresh (indicator base) + 20s globals refresh
//   • fail-soft everywhere; WS failure degrades to a 1.5s REST fallback
// Adds: a CN/EN language toggle that re-renders the whole UI in place.
import type { Candle, GlobalData, TF } from '../lib/types';
import { TF_LIST } from '../lib/constants';
import {
  collectAll,
  fetchGlobalsRaw,
  normGlobals,
  binanceCandles,
  fetchTicker,
  deribitArray,
  wsUrl,
} from '../lib/binance';
import { fetchExtras } from '../lib/extra-sources';
import { buildLlmMessage } from '../lib/llm-export';
import { render, STATE, fmtP } from '../lib/render';
import { t, getLang, setLang, initLang, type Lang } from '../lib/i18n';

// ── live state ──────────────────────────────────────────────────────────────
const KLINES: Record<TF, Candle[] | null> = { '5m': null, '15m': null, '30m': null, '1h': null, '4h': null, '1d': null };
type GData = Partial<Omit<GlobalData, 'klines'>>;
let GDATA: GData = {};
let dirty = false;
let ws: WebSocket | null = null;
let wsAlive = false;
let lastPrice: number | null = null;
let restFallback: ReturnType<typeof setInterval> | null = null;
let msgCount = 0;
const SPARK: number[] = [];
const statusState: { on: boolean; key: string } = { on: false, key: 'chrome.notConnected' };

const NO = { ok: false as const, e: 'n/a' };

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function applyTickToKlines(p: number): void {
  for (const tf of TF_LIST) {
    const a = KLINES[tf];
    if (a && a.length) {
      const b = a[a.length - 1];
      b.c = p;
      if (p > b.h) b.h = p;
      if (p < b.l) b.l = p;
    }
  }
}

function setStatus(on: boolean, key: string): void {
  statusState.on = on;
  statusState.key = key;
  const dot = $('liveDot');
  if (dot) dot.className = 'dot' + (on ? ' live' : '');
  const txt = $('liveText');
  if (txt) txt.textContent = t(key);
}

function buildD(): GlobalData {
  const g = GDATA;
  return {
    klines: KLINES,
    ticker: g.ticker ?? NO,
    premium: g.premium ?? NO,
    oiNow: g.oiNow ?? NO,
    oiHist: g.oiHist ?? NO,
    lsAcct: g.lsAcct ?? NO,
    lsTop: g.lsTop ?? NO,
    taker: g.taker ?? NO,
    depth: g.depth ?? NO,
    deribit: g.deribit ?? NO,
    fng: g.fng ?? NO,
    cg: g.cg ?? NO,
    memFee: g.memFee ?? NO,
    hashr: g.hashr ?? NO,
    macro: g.macro ?? NO,
    mvrv: g.mvrv ?? NO,
  };
}

// ── sparkline ─────────────────────────────────────────────────────────────
function drawSpark(): void {
  const cv = $('spark') as HTMLCanvasElement | null;
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const w = cv.width;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (SPARK.length < 2) return;
  const mn = Math.min(...SPARK);
  const mx = Math.max(...SPARK);
  const rng = mx - mn || 1;
  ctx.beginPath();
  SPARK.forEach((v, i) => {
    const x = (i / (SPARK.length - 1)) * w;
    const y = h - ((v - mn) / rng) * (h - 6) - 3;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  const up = SPARK[SPARK.length - 1] >= SPARK[0];
  ctx.strokeStyle = up ? '#16c784' : '#ea3943';
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  const ly = h - ((SPARK[SPARK.length - 1] - mn) / rng) * (h - 6) - 3;
  ctx.beginPath();
  ctx.arc(w - 2, ly, 2, 0, 7);
  ctx.fillStyle = up ? '#16c784' : '#ea3943';
  ctx.fill();
}

function pushSpark(p: number): void {
  SPARK.push(p);
  if (SPARK.length > 160) SPARK.shift();
  drawSpark();
}

function showPrice(p: number, pct: number | null): void {
  const el = $('price');
  if (!el) return;
  const prev = lastPrice;
  el.textContent = '$' + fmtP(p);
  if (prev != null && p !== prev) {
    el.style.color = p > prev ? 'var(--long)' : 'var(--short)';
    setTimeout(() => {
      el.style.color = '';
    }, 200);
  }
  if (pct != null) {
    const ce = $('chg');
    if (ce) {
      ce.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      ce.style.color = pct >= 0 ? 'var(--long)' : 'var(--short)';
      ce.style.background = pct >= 0 ? 'var(--long-bg)' : 'var(--short-bg)';
    }
  }
  lastPrice = p;
  pushSpark(p);
}

// ── data lifecycle ──────────────────────────────────────────────────────────
async function seed(): Promise<boolean> {
  // Binance snapshot + the keyless macro/on-chain extras, in parallel.
  const [D, extras] = await Promise.all([collectAll(), fetchExtras(new Date())]);
  const anyK = Object.values(D.klines).some((v) => v);
  if (anyK) TF_LIST.forEach((tf) => { if (D.klines[tf]) KLINES[tf] = D.klines[tf]; });
  GDATA = {
    ticker: D.ticker, premium: D.premium, oiNow: D.oiNow, oiHist: D.oiHist,
    lsAcct: D.lsAcct, lsTop: D.lsTop, taker: D.taker, depth: D.depth,
    fng: D.fng, cg: D.cg, memFee: D.memFee, hashr: D.hashr, deribit: D.deribit,
    macro: extras.macro, mvrv: extras.mvrv,
  };
  if (KLINES['5m'] && SPARK.length < 5) {
    SPARK.length = 0;
    KLINES['5m']!.slice(-90).forEach((k) => SPARK.push(k.c));
    drawSpark();
  }
  if (D.ticker.ok) showPrice(D.ticker.v.lastPrice, D.ticker.v.priceChangePercent);
  if (anyK) render(buildD());
  return anyK;
}

async function pricePoll(): Promise<void> {
  const tk = await fetchTicker();
  if (tk) {
    applyTickToKlines(tk.lastPrice);
    GDATA.ticker = { ok: true, v: { lastPrice: tk.lastPrice, priceChangePercent: tk.priceChangePercent } };
    showPrice(tk.lastPrice, tk.priceChangePercent);
    msgCount++;
    dirty = true;
  }
}

async function refreshCandles(): Promise<void> {
  const cs = await Promise.all(TF_LIST.map(binanceCandles));
  TF_LIST.forEach((tf, i) => { if (cs[i]) KLINES[tf] = cs[i]; });
  dirty = true;
}

async function pollGlobal(): Promise<void> {
  const R = await fetchGlobalsRaw();
  const n = normGlobals(R, KLINES['5m']);
  if (n.ticker.ok) GDATA.ticker = n.ticker;
  GDATA.premium = n.premium;
  GDATA.oiHist = n.oiHist;
  GDATA.lsAcct = n.lsAcct;
  GDATA.lsTop = n.lsTop;
  GDATA.taker = n.taker;
  GDATA.depth = n.depth;
  const deri = deribitArray(R.deribit);
  if (deri.ok) GDATA.deribit = deri;
  if (R.fng.ok) GDATA.fng = R.fng as GlobalData['fng'];
  if (R.cg.ok) GDATA.cg = R.cg as GlobalData['cg'];
  if (R.memFee.ok) GDATA.memFee = R.memFee as GlobalData['memFee'];
  if (R.hashr.ok) GDATA.hashr = R.hashr as GlobalData['hashr'];
  dirty = true;
}

/** Refresh the keyless macro (DXY/10Y) + on-chain (MVRV) extras. They are daily
 *  data, so this runs on a slow cadence; failures degrade those factors only. */
async function pollExtras(): Promise<void> {
  const ex = await fetchExtras(new Date());
  if (ex.macro.ok) GDATA.macro = ex.macro;
  if (ex.mvrv.ok) GDATA.mvrv = ex.mvrv;
  dirty = true;
}

// ── Binance WebSocket (trade + 24h ticker) ───────────────────────────────────
function connectWS(): void {
  setStatus(false, 'status.connecting');
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    startRestFallback();
    return;
  }
  ws.onopen = () => {
    wsAlive = true;
    setStatus(true, 'status.live');
    if (restFallback) {
      clearInterval(restFallback);
      restFallback = null;
    }
  };
  ws.onmessage = (ev) => {
    let msg: { stream?: string; data?: Record<string, string> };
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    const stream = msg.stream;
    const d = msg.data;
    if (!stream || !d) return;
    if (stream.endsWith('@trade')) {
      const p = +d.p;
      applyTickToKlines(p);
      showPrice(p, null);
      msgCount++;
      dirty = true;
    } else if (stream.endsWith('@ticker')) {
      const p = +d.c;
      const pct = +d.P;
      applyTickToKlines(p);
      GDATA.ticker = { ok: true, v: { lastPrice: p, priceChangePercent: isNaN(pct) ? 0 : pct } };
      showPrice(p, isNaN(pct) ? null : pct);
      dirty = true;
    }
  };
  ws.onclose = () => {
    if (wsAlive) {
      wsAlive = false;
      setStatus(false, 'status.reconnect');
      setTimeout(connectWS, 3000);
    }
  };
  ws.onerror = () => {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    if (!wsAlive) startRestFallback();
  };
}

function startRestFallback(): void {
  if (restFallback) return;
  setStatus(false, 'status.restFallback');
  restFallback = setInterval(pricePoll, 1500);
}

// ── chrome i18n / language toggle ─────────────────────────────────────────
function applyChrome(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
  });
  document.title = t('chrome.title');
  document.documentElement.lang = t('chrome.htmlLang');
  setStatus(statusState.on, statusState.key);
}

// ── LLM data export (Agent panel) ───────────────────────────────────────────
async function copyLlmExport(): Promise<void> {
  const status = $('exportStatus');
  let ok = false;
  try {
    const msg = buildLlmMessage(buildD());
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(msg);
      ok = true;
    } else {
      // Fallback for non-secure contexts: transient off-DOM textarea.
      const ta = document.createElement('textarea');
      ta.value = msg;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    }
  } catch {
    ok = false;
  }
  if (status) {
    status.textContent = t(ok ? 'agent.copied' : 'agent.copyFail');
    status.style.color = ok ? 'var(--long)' : 'var(--short)';
    setTimeout(() => {
      status.textContent = '';
    }, 2500);
  }
}

function toggleLang(): void {
  const next: Lang = getLang() === 'zh' ? 'en' : 'zh';
  setLang(next);
  applyChrome();
  if (STATE.results) {
    try {
      render(buildD());
    } catch {
      /* ignore render race */
    }
  }
}

// ── boot ──────────────────────────────────────────────────────────────────
function start(): void {
  initLang();
  applyChrome();

  $('refreshBtn')?.addEventListener('click', () => {
    void pollGlobal();
    void pricePoll();
  });
  $('liveSwitch')?.addEventListener('click', () => {
    if (!wsAlive) connectWS();
  });
  $('langBtn')?.addEventListener('click', toggleLang);
  $('exportBtn')?.addEventListener('click', () => void copyLlmExport());

  // render-if-dirty loop + pollers (match the original cadence)
  setInterval(() => {
    if (dirty) {
      try {
        render(buildD());
      } catch {
        /* ignore */
      }
      dirty = false;
    }
  }, 300);
  setInterval(() => void pricePoll(), 1000);
  setInterval(() => void refreshCandles(), 12000);
  setInterval(() => {
    const rate = msgCount;
    msgCount = 0;
    const up = $('updated');
    if (up) {
      const loc = getLang() === 'zh' ? 'zh-CN' : 'en-US';
      up.textContent = new Date().toLocaleTimeString(loc) + ' · ' + t('status.txPerSec', { n: rate });
    }
    dirty = true;
    drawSpark();
  }, 1000);

  setStatus(false, 'status.loadingHistory');
  void (async () => {
    const ok = await seed();
    setInterval(() => void pollGlobal(), 20000);
    setInterval(() => void pollExtras(), 300000); // daily data — refresh every 5 min
    void pricePoll();
    if (ok) {
      connectWS();
    } else {
      const topErr = $('topErr');
      if (topErr) {
        topErr.innerHTML = `<div class="disclaimer" style="border-color:rgba(234,57,67,.4);background:rgba(234,57,67,.07);margin-top:14px"><b class="err">${t('err.cannotConnect')}</b> ${t('err.cannotConnectBody')}</div>`;
      }
      startRestFallback();
    }
  })();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
