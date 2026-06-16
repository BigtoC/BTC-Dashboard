// DOM rendering layer. Ported from the original render functions; reads the
// active language via `t()` so a re-render fully reflects a CN/EN switch.
import type { Category, Factor, GlobalData, TF, TFResult } from './types';
import { TF_LIST, CAT_ORDER, CAT_ICONS, WEIGHTS } from './constants';
import { t } from './i18n';
import { globalFactors, technicalFactors, levelFactors, structureFactors, priceFactors, scoreTF } from './engine';

// ── view helpers ────────────────────────────────────────────────────────────
export function dirOf(s: number): 'long' | 'short' | 'neutral' {
  if (s > 0.05) return 'long';
  if (s < -0.05) return 'short';
  return 'neutral';
}
export function dirText(s: number): string {
  const d = dirOf(s);
  return d === 'long' ? t('dir.long') : d === 'short' ? t('dir.short') : t('dir.neutral');
}
export function arrowOf(s: number): string {
  const d = dirOf(s);
  return d === 'long' ? '▲' : d === 'short' ? '▼' : '●';
}
export function colorOf(s: number): string {
  const d = dirOf(s);
  return d === 'long' ? 'var(--long)' : d === 'short' ? 'var(--short)' : 'var(--neutral)';
}
export function fmtP(n: number | null): string {
  if (n == null) return '--';
  return (+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}

// ── shared UI state ───────────────────────────────────────────────────────
export interface DashboardState {
  results: Record<TF, TFResult> | null;
  glob: Record<Category, Factor[]> | null;
  sel: TF;
  openCats: Partial<Record<Category, boolean>>;
}
export const STATE: DashboardState = { results: null, glob: null, sel: '1h', openCats: { technicals: true } };

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// ── top-level render ──────────────────────────────────────────────────────
export function render(D: GlobalData): void {
  if (D.ticker.ok) {
    const ch = +D.ticker.v.priceChangePercent;
    const ce = $('chg');
    if (ce) {
      ce.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%';
      ce.style.color = ch >= 0 ? 'var(--long)' : 'var(--short)';
      ce.style.background = ch >= 0 ? 'var(--long-bg)' : 'var(--short-bg)';
    }
  }
  const glob = globalFactors(D);
  const results = {} as Record<TF, TFResult>;
  TF_LIST.forEach((tf) => {
    const ks = D.klines[tf];
    let per: Factor[] = [];
    if (ks) per = [...technicalFactors(ks), ...levelFactors(ks), ...structureFactors(ks), ...priceFactors(ks)];
    results[tf] = scoreTF(tf, per, JSON.parse(JSON.stringify(glob)) as Record<Category, Factor[]>);
  });
  STATE.results = results;
  STATE.glob = glob;
  renderCards(results);
  renderGlobal(glob);
  renderBreakdown(STATE.sel);
}

export function renderCards(results: Record<TF, TFResult>): void {
  const grid = $('tfGrid');
  if (!grid) return;
  grid.innerHTML = '';
  TF_LIST.forEach((tf) => {
    const r = results[tf];
    const s = r.composite;
    const col = colorOf(s);
    const top = topFactors(r, 3);
    const pct = (((s + 1) / 2) * 100).toFixed(1);
    const card = document.createElement('div');
    card.className = 'tf-card' + (tf === STATE.sel ? ' sel' : '');
    card.dataset.tf = tf;
    card.onclick = () => {
      STATE.sel = tf;
      document.querySelectorAll('.tf-card').forEach((c) => c.classList.remove('sel'));
      card.classList.add('sel');
      renderBreakdown(tf);
    };
    card.innerHTML = `
      <div class="tf-head"><span class="tf-name">${esc(t('tf.' + tf))}</span><span>${r.coverage ? esc(t('card.coverage', { p: (r.coverage * 100).toFixed(0) })) : ''}</span></div>
      <div class="dir" style="color:${col}"><span class="arrow">${arrowOf(s)}</span>${esc(dirText(s))}</div>
      <div class="score-bar"><div class="mark" style="left:${pct}%"></div></div>
      <div class="conf-label"><span>${esc(t('card.composite'))} <b>${(s * 100).toFixed(1)}</b></span><span>${esc(t('card.confidence'))} <b>${(r.confidence * 100).toFixed(0)}%</b></span></div>
      <div class="bar"><span style="left:0;width:${(r.confidence * 100).toFixed(0)}%;background:${col}"></span></div>
      <div class="mini-factors">${top.map((f) => `<div class="mf"><span>${esc(f.name)}</span><b style="color:${colorOf(f.score)}">${f.score > 0 ? '+' : ''}${(f.score * 100).toFixed(0)}</b></div>`).join('')}</div>`;
    grid.appendChild(card);
  });
}

export function topFactors(r: TFResult, n: number): Factor[] {
  const all: Factor[] = [];
  for (const cat of CAT_ORDER) r.catScores[cat].factors.forEach((f) => { if (f.available && f.confidence > 0) all.push(f); });
  return all.sort((a, b) => Math.abs(b.score * b.confidence) - Math.abs(a.score * a.confidence)).slice(0, n);
}

export function renderBreakdown(tf: TF): void {
  STATE.sel = tf;
  const sel = $('selTf');
  if (sel) sel.textContent = '· ' + t('tf.' + tf);
  if (!STATE.results) return;
  const r = STATE.results[tf];
  const box = $('breakdown');
  if (!box) return;
  box.innerHTML = '';
  const cats = [...CAT_ORDER].sort((a, b) => WEIGHTS[tf][b] - WEIGHTS[tf][a]);
  cats.forEach((cat) => {
    const cd = r.catScores[cat];
    const cs = cd.score;
    const cEl = document.createElement('div');
    cEl.className = 'cat' + (STATE.openCats[cat] ? ' open' : '');
    cEl.dataset.cat = cat;
    const csTxt = cs == null ? t('bd.noData') : (cs > 0 ? '+' : '') + (cs * 100).toFixed(0);
    const csCol = cs == null ? 'var(--faint)' : colorOf(cs);
    const csBg = cs == null ? 'var(--neutral-bg)' : dirOf(cs) === 'long' ? 'var(--long-bg)' : dirOf(cs) === 'short' ? 'var(--short-bg)' : 'var(--neutral-bg)';
    cEl.innerHTML = `<div class="cat-head"><span class="ci">${CAT_ICONS[cat]}</span><span class="cn">${esc(t('cat.' + cat))}<span class="wt">${esc(t('bd.weight', { p: (WEIGHTS[tf][cat] * 100).toFixed(0) }))}</span></span><span class="cs" style="color:${csCol};background:${csBg}">${esc(csTxt)}</span></div><div class="cat-body">${cd.factors.map(factorRow).join('') || `<div class="factor na">${esc(t('bd.noFactors'))}</div>`}</div>`;
    const head = cEl.querySelector<HTMLElement>('.cat-head');
    if (head) head.onclick = () => { STATE.openCats[cat] = !STATE.openCats[cat]; cEl.classList.toggle('open'); };
    box.appendChild(cEl);
  });
}

export function factorRow(f: Factor): string {
  const col = colorOf(f.score);
  const na = f.available ? '' : 'na';
  const pill = f.available ? '' : `<span class="pill">${esc(t('pill.needKey'))}</span>`;
  const barFill = f.score >= 0 ? `left:50%;width:${(f.score * 50).toFixed(0)}%` : `right:50%;width:${(-f.score * 50).toFixed(0)}%`;
  return `<div class="factor ${na}"><div class="fn">${esc(f.name)}${pill}<small>${esc(f.note)}</small></div><div class="fv">${esc(f.value)}</div><div><div class="fbar"><div class="center"></div><i style="background:${col};${barFill}"></i></div></div></div>`;
}

const GAUGE_PICKS: [Category, string, string][] = [
  ['derivatives', 'funding', 'g.funding'],
  ['derivatives', 'oi', 'g.oi'],
  ['derivatives', 'lsacct', 'g.lsacct'],
  ['derivatives', 'pcr', 'g.pcr'],
  ['derivatives', 'skew', 'g.skew'],
  ['overlooked', 'maxpain', 'g.maxpain'],
  ['sentiment', 'ivol', 'g.ivol'],
  ['sentiment', 'fng', 'g.fng'],
  ['overlooked', 'crowd', 'g.crowd'],
  ['flows', 'dom', 'g.dom'],
];

export function renderGlobal(glob: Record<Category, Factor[]>): void {
  const box = $('globalGauge');
  if (!box) return;
  box.innerHTML = '';
  const find = (cat: Category, id: string) => (glob[cat] || []).find((f) => f.id === id);
  const picks: [string, Factor][] = [];
  GAUGE_PICKS.forEach(([c, id, lblKey]) => {
    const f = find(c, id);
    if (f && (f.available || f.value)) picks.push([t(lblKey), f]);
  });
  picks.forEach(([lbl, f]) => {
    const el = document.createElement('div');
    el.className = 'g-item';
    el.innerHTML = `<div class="gl">${esc(lbl)}</div><div class="gv">${esc(f.value)}</div><div class="gd" style="color:${f.confidence > 0 ? colorOf(f.score) : 'var(--muted)'}">${f.confidence > 0 ? esc(dirText(f.score)) + ' · ' : ''}${esc(f.note)}</div>`;
    box.appendChild(el);
  });
}
