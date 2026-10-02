'use strict';

// ---- Config ----
const API = '/api/freeserp'; // same-origin proxy: see vercel.json / dev_server.py
const AGENT = 'AILaunchRadar/1.0';
const PAGE = 24;
const MAX_COMPARE = 3;
const MAX_OFFSET = 10000; // FreeSerp Main: from + size <= 10,000
const BUILDERS = { lovable:'Lovable', v0:'v0', bolt:'Bolt', base44:'Base44', ai_likely:'Looks AI-built',
  nextjs:'Next.js', react:'React', webflow:'Webflow', wordpress:'WordPress', shopify:'Shopify', wix:'Wix' };
const AI_BUILDERS = ['lovable', 'v0', 'bolt', 'base44', 'ai_likely'];
const TEXT = {
  radar:   { title:'New AI startups, every day', lead:'A live radar of genuine AI products discovered by FreeSerp — filter by niche, authority and stack, then shortlist and compare.' },
  built:   { title:'Built with AI', lead:'Sites shipped with AI builders — Lovable, v0, Bolt, Base44. See what vibe-coders are launching right now.' },
  compare: { title:'Compare', lead:'Side-by-side view of up to 3 shortlisted sites. Use “Find similar” to explore competitors in the same niche.' },
};

// ---- DOM ----
const $ = (s) => document.querySelector(s);
const el = {
  q:$('#q'), niche:$('#niche'), builder:$('#builder'), drMin:$('#drMin'), sort:$('#sort'), reset:$('#resetBtn'),
  results:$('#results'), meta:$('#resultMeta'), more:$('#moreBtn'), stats:$('#stats'),
  filters:$('#filtersSection'), chips:$('#builderChips'), compareView:$('#compareView'),
  title:$('#pageTitle'), lead:$('#pageLead'), compareCount:$('#compareCount'),
  tray:$('#tray'), trayText:$('#trayText'), trayClear:$('#trayClear'), trayGo:$('#trayGo'),
};

// ---- State ----
const state = { tab:'radar', from:0, total:0, items:[], compare:loadCompare() };
let ctrl = null;
let chipsLoaded = false;

// ---- Helpers ----
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');
function fmtDate(d) {
  if (!d) return '—';
  const t = new Date(d + 'T00:00:00Z');
  return isNaN(t) ? d : t.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' });
}
function safeUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; }
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function api(params, signal, url = API) {
  const qs = new URLSearchParams({ ...params, agent: AGENT });
  const res = await fetch(`${url}?${qs}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'API error');
  return data;
}

// ---- Compare storage (per-browser convenience) ----
function loadCompare() {
  try { return new Map(JSON.parse(localStorage.getItem('alr_compare') || '[]')); } catch { return new Map(); }
}
function saveCompare() {
  try { localStorage.setItem('alr_compare', JSON.stringify([...state.compare])); } catch { /* storage unavailable */ }
}

// ---- Query building ----
function buildParams() {
  const p = { size: PAGE, from: state.from };
  const q = el.q.value.trim();
  if (q) p.q = q;
  if (el.niche.value) p.ai_categories = el.niche.value;
  if (el.builder.value) p.ai_source = el.builder.value;
  if (el.drMin.value) p.dr_min = el.drMin.value;
  const [sort, order] = el.sort.value.split(':');
  p.sort = sort === 'relevance' && !q ? 'went_live' : sort; // relevance needs a query
  p.order = order;
  if (state.tab === 'radar') p.ai_startups = 1;               // genuine AI products only
  else if (state.tab === 'built' && !p.ai_source) p.ai = 1;   // any AI builder
  return p;
}

// ---- Loading ----
async function load(append = false) {
  if (!append) { state.from = 0; state.items = []; renderSkeleton(); }
  syncURL();
  if (ctrl) ctrl.abort();
  const my = (ctrl = new AbortController());
  const timer = setTimeout(() => my.abort(), 15000);
  el.more.disabled = true;
  try {
    const data = await api(buildParams(), my.signal);
    if (my !== ctrl) return;
    state.total = data.total || 0;
    const rows = data.results || [];
    state.items = append ? state.items.concat(rows) : rows;
    renderResults(rows, append, data);
  } catch (e) {
    if (my !== ctrl) return; // superseded by a newer request
    renderError(e.name === 'AbortError' ? 'request timed out' : e.message);
  } finally {
    clearTimeout(timer);
    if (my === ctrl) el.more.disabled = false;
  }
}

async function loadStats() {
  try {
    const s = await api({}, undefined, "/api/overview");
    // skip noise buckets like 'Other AI': only niches that count as real AI startups
    const topNiche = (s.top_ai_categories || []).find((c) => [...el.niche.options].some((o) => o.value === c.key));
    const tiles = [
      [s.ai_startups?.total, 'AI startups tracked'],
      s.ai_startups?.today ? [s.ai_startups.today, 'new AI startups today'] : [topNiche?.count, `top niche: ${topNiche?.key || '—'}`],
      [s.new?.last_7d, 'new sites, last 7 days'],
      [s.totals?.real_sites, 'live sites indexed'],
    ];
    el.stats.innerHTML = tiles.map(([n, l]) => `<div class="stat"><b>${fmtNum(n)}</b><span>${esc(l)}</span></div>`).join('');
    const counts = new Map((s.top_ai_categories || []).map((c) => [c.key, c.count]));
    [...el.niche.options].forEach((o) => {
      if (o.value && counts.has(o.value)) o.textContent = `${o.value} (${fmtNum(counts.get(o.value))})`;
    });
  } catch { el.stats.innerHTML = ''; }
}

async function loadBuilderChips() {
  if (chipsLoaded) return renderChipState();
  chipsLoaded = true;
  el.chips.innerHTML = AI_BUILDERS.map((b) => `<button class="chip" data-b="${b}">${BUILDERS[b]} <small>…</small></button>`).join('');
  renderChipState();
  await Promise.all(AI_BUILDERS.map(async (b) => {
    try {
      const d = await api({ ai_source: b, size: 1 });
      const small = el.chips.querySelector(`[data-b="${b}"] small`);
      if (small) small.textContent = fmtNum(d.total);
    } catch { /* keep placeholder */ }
  }));
}
function renderChipState() {
  el.chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.b === el.builder.value));
}

// ---- Rendering ----
function renderSkeleton() {
  el.meta.textContent = 'Loading…';
  el.more.classList.add('hidden');
  el.results.innerHTML = '<div class="skeleton"></div>'.repeat(6);
}
function renderError(msg) {
  el.meta.textContent = '';
  el.more.classList.add('hidden');
  el.results.innerHTML = `<div class="empty">Couldn't load data (${esc(msg)}). <button class="ghost" data-act="retry">Retry</button></div>`;
}
function card(r) {
  const niches = (r.ai_categories || []).slice(0, 3).map((n) => `<span class="tag niche">${esc(n)}</span>`).join('');
  const builder = BUILDERS[r.ai_source] ? `<span class="tag builder">${esc(BUILDERS[r.ai_source])}</span>` : '';
  const sum = r.ai_summary || 'No summary yet.';
  const on = state.compare.has(r.domain);
  return `<article class="card" data-domain="${esc(r.domain)}">
    <div class="card-top">
      <img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(r.domain)}&sz=64" alt="" loading="lazy" width="28" height="28">
      <div class="t">
        <a class="domain" href="${esc(safeUrl(r.url || 'https://' + r.domain))}" target="_blank" rel="noopener nofollow">${esc(r.domain)}</a>
        <div class="title" title="${esc(r.title)}">${esc(r.title || '')}</div>
      </div>
    </div>
    <div class="tags">${niches}${builder}<span class="tag dr" title="FreeSerp Domain Rating (— = not scored yet)">DR ${r.dr ?? '—'}</span><span class="tag" title="Date FreeSerp first confirmed the site live">Live since ${fmtDate(r.went_live)}</span></div>
    <p class="summary">${esc(sum)}</p>
    <div class="card-actions">
      ${sum.length > 220 ? '<button class="more" data-act="more">Read more</button>' : '<span></span>'}
      <button class="cmp-btn ${on ? 'on' : ''}" data-act="cmp">${on ? '✓ In compare' : '+ Compare'}</button>
    </div>
  </article>`;
}
function renderResults(rows, append, data) {
  const html = rows.map(card).join('');
  if (append) el.results.insertAdjacentHTML('beforeend', html);
  else el.results.innerHTML = html || '<div class="empty">No sites match these filters. Try a broader niche or remove the DR filter.</div>';
  el.meta.textContent = state.total
    ? `${fmtNum(state.total)} sites found · showing ${fmtNum(state.items.length)} · ${data.took_ms ?? '?'} ms`
    : '';
  const cap = Math.min(state.total, MAX_OFFSET);
  el.more.classList.toggle('hidden', !(state.items.length < cap && state.from + 2 * PAGE <= MAX_OFFSET));
}

function renderCompare() {
  const items = [...state.compare.values()];
  if (!items.length) {
    el.compareView.innerHTML = '<div class="empty">Nothing to compare yet. Add up to 3 sites with “+ Compare” on any card.<br><br><button class="primary" data-act="go-radar">Open Radar</button></div>';
    return;
  }
  const drs = items.map((r) => (typeof r.dr === 'number' ? r.dr : -1));
  const bestDr = Math.max(...drs);
  const rows = [
    ['Site', (r) => `<a href="${esc(safeUrl(r.url || 'https://' + r.domain))}" target="_blank" rel="noopener nofollow">${esc(r.domain)}</a>`],
    ['Title', (r) => esc(r.title || '—')],
    ['AI niches', (r) => esc((r.ai_categories || []).join(', ') || '—')],
    ['Built with', (r) => esc(BUILDERS[r.ai_source] || r.ai_source || '—')],
    ['Domain Rating', (r) => `<span class="${typeof r.dr === 'number' && r.dr === bestDr && items.length > 1 ? 'best' : ''}">${r.dr ?? '— (not scored)'}</span>`],
    ['Live since', (r) => fmtDate(r.went_live)],
    ['First seen', (r) => fmtDate(r.first_seen)],
    ['TLD', (r) => esc(r.tld ? '.' + r.tld : '—')],
    ['Web server', (r) => esc(r.webserver || '—')],
    ['Homepage text', (r) => (r.content_length ? `${Math.round(r.content_length / 1024)} KB` : '—')],
    ['Summary', (r) => esc(r.ai_summary || '—')],
    ['', (r) => `<button class="ghost" data-act="similar" data-domain="${esc(r.domain)}">Find similar</button> <button class="ghost" data-act="remove" data-domain="${esc(r.domain)}">Remove</button>`],
  ];
  el.compareView.innerHTML = `<div class="cmp-wrap"><table class="cmp"><tbody>${
    rows.map(([label, f]) => `<tr><th>${label}</th>${items.map((r) => `<td>${f(r)}</td>`).join('')}</tr>`).join('')
  }</tbody></table></div>`;
}

// ---- Compare actions ----
function toggleCompare(domain) {
  if (state.compare.has(domain)) state.compare.delete(domain);
  else {
    if (state.compare.size >= MAX_COMPARE) { flashTray(`Max ${MAX_COMPARE} sites — remove one first`); return; }
    const r = state.items.find((x) => x.domain === domain);
    if (r) state.compare.set(domain, r);
  }
  saveCompare();
  updateCompareUI();
}
function updateCompareUI() {
  const n = state.compare.size;
  el.compareCount.textContent = n;
  el.tray.classList.toggle('hidden', n === 0 || state.tab === 'compare');
  el.trayText.textContent = `${n} of ${MAX_COMPARE} selected for comparison`;
  el.results.querySelectorAll('.card').forEach((c) => {
    const on = state.compare.has(c.dataset.domain);
    const b = c.querySelector('.cmp-btn');
    b.classList.toggle('on', on);
    b.textContent = on ? '✓ In compare' : '+ Compare';
  });
  if (state.tab === 'compare') renderCompare();
}
function flashTray(msg) {
  el.tray.classList.remove('hidden');
  el.trayText.textContent = msg;
  setTimeout(updateCompareUI, 2000);
}

// ---- Tabs & URL ----
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  el.title.textContent = TEXT[tab].title;
  el.lead.textContent = TEXT[tab].lead;
  const isCmp = tab === 'compare';
  [el.filters, el.meta, el.results].forEach((x) => x.classList.toggle('hidden', isCmp));
  el.stats.classList.toggle('hidden', tab !== 'radar'); // index-wide stats belong to Radar; Built tab has its own chip counts
  el.compareView.classList.toggle('hidden', !isCmp);
  el.chips.classList.toggle('hidden', tab !== 'built');
  updateCompareUI();
  if (isCmp) { el.more.classList.add('hidden'); renderCompare(); syncURL(); return; }
  if (tab === 'built') loadBuilderChips();
  load();
}
function syncURL() {
  const p = new URLSearchParams();
  if (state.tab !== 'radar') p.set('tab', state.tab);
  if (el.q.value.trim()) p.set('q', el.q.value.trim());
  if (el.niche.value) p.set('niche', el.niche.value);
  if (el.builder.value) p.set('builder', el.builder.value);
  if (el.drMin.value) p.set('dr', el.drMin.value);
  if (el.sort.value !== 'went_live:desc') p.set('sort', el.sort.value);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}
function readURL() {
  const p = new URLSearchParams(location.search);
  const setIf = (sel, v) => { if (v && [...sel.options].some((o) => o.value === v)) sel.value = v; };
  el.q.value = p.get('q') || '';
  setIf(el.niche, p.get('niche'));
  setIf(el.builder, p.get('builder'));
  setIf(el.drMin, p.get('dr'));
  setIf(el.sort, p.get('sort'));
  const t = p.get('tab');
  return TEXT[t] ? t : 'radar';
}

// ---- Events ----
const onFilter = () => { renderChipState(); load(); };
el.q.addEventListener('input', debounce(load, 350));
el.q.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
[el.niche, el.builder, el.drMin, el.sort].forEach((s) => s.addEventListener('change', onFilter));
el.reset.addEventListener('click', () => {
  el.q.value = ''; el.niche.value = ''; el.builder.value = ''; el.drMin.value = ''; el.sort.value = 'went_live:desc';
  onFilter();
});
el.more.addEventListener('click', () => { state.from += PAGE; load(true); });
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
el.chips.addEventListener('click', (e) => {
  const c = e.target.closest('.chip'); if (!c) return;
  el.builder.value = el.builder.value === c.dataset.b ? '' : c.dataset.b;
  onFilter();
});
el.results.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'retry') return load();
  const domain = b.closest('.card')?.dataset.domain;
  if (b.dataset.act === 'cmp') toggleCompare(domain);
  if (b.dataset.act === 'more') {
    const s = b.closest('.card').querySelector('.summary');
    s.classList.toggle('open');
    b.textContent = s.classList.contains('open') ? 'Show less' : 'Read more';
  }
});
el.compareView.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const r = state.compare.get(b.dataset.domain);
  if (b.dataset.act === 'go-radar') return switchTab('radar');
  if (b.dataset.act === 'remove') { state.compare.delete(b.dataset.domain); saveCompare(); updateCompareUI(); }
  if (b.dataset.act === 'similar' && r) {
    el.q.value = ''; el.builder.value = ''; el.drMin.value = '';
    el.niche.value = (r.ai_categories || []).find((n) => [...el.niche.options].some((o) => o.value === n)) || '';
    switchTab('radar');
  }
});
el.trayClear.addEventListener('click', () => { state.compare.clear(); saveCompare(); updateCompareUI(); });
el.trayGo.addEventListener('click', () => switchTab('compare'));

// ---- Init ----
[...el.niche.options].forEach((o) => { o.value = o.value; }); // freeze values before labels get counts
loadStats();
switchTab(readURL());
