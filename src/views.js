
/* ---------------- small helpers ---------------- */
const ICONS = {
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  chev: '<svg viewBox="0 0 20 20" aria-hidden="true" style="width:16px;height:16px;display:block"><path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
function icon(name) { const s = document.createElement('span'); s.innerHTML = ICONS[name]; return s.firstChild; }
function srcLabel(x) { return x.src === 'bank' ? (x.bank || '银行卡') : (SRC_NAME[x.src] || x.src); }
function catDot(cat) { const d = el('span', 'dot'); d.style.background = catColor(cat); return d; }
function whenText(days) { return days < 0 ? '逾期 ' + (-days) + ' 天' : days === 0 ? '今天' : days === 1 ? '明天' : days + ' 天后'; }
function whenEl(days, near) { const s = el('span', 'row-x', whenText(days)); if (days < 0) s.className = 'row-x when-late'; else if (days <= (near == null ? 3 : near)) s.className = 'row-x when-soon'; return s; }
function bigMoney(target, c) {
  const neg = c < 0; const a = Math.abs(Math.round(c));
  target.textContent = '';
  target.append(el('span', 'cur', (neg ? '−' : '') + '¥'), document.createTextNode(Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0')));
}

/* ---------------- trend view ---------------- */
/* the ledger shows this many days at first; 显示更多 adds DAYS_MORE at a time */
const DAYS_FIRST = 5, DAYS_MORE = 15;
let range = '1m', filter = 'all', listLimit = DAYS_FIRST, hover = null, view = null, tab = 'trend';
try { const r = localStorage.getItem(LS_KEY + ':range'); if (r) range = r; const tb = localStorage.getItem(LS_KEY + ':tab'); if (tb) tab = tb; } catch (e) {}

function rangeStart(now) {
  const map = { '1w': 7, '1m': 30, '3m': 90, '1y': 365 };
  const first = derived.all.length ? derived.all[0].x.t : now - 30 * DAY;
  const firstAll = Math.min(first, derived.anchors.length ? derived.anchors[0].t : first);
  if (range === 'all') return Math.min(firstAll, now - DAY);
  return Math.max(now - map[range] * DAY, Math.min(firstAll, now - DAY));
}
function buildView() {
  const now = Date.now();
  const t0 = rangeStart(now); const t1 = now;
  const ev = [];
  for (const r of derived.eff) if (r.x.t > t0 && r.x.t <= t1) ev.push({ t: r.x.t, rec: r });
  for (const a of derived.anchorRecs) if (a.anchor.t > t0 && a.anchor.t <= t1) ev.push({ t: a.anchor.t, anc: a });
  ev.sort((a, b) => a.t - b.t || (a.anc ? 1 : 0) - (b.anc ? 1 : 0));
  const v0 = derived.bal(t0);
  const pts = ev.map((e) => ({ t: e.t, v: derived.bal(e.t), e }));
  let inc = 0, out = 0, cnt = 0, adj = 0;
  for (const e of ev) {
    if (e.rec) { cnt++; if (e.rec.delta > 0) inc += e.rec.delta; else out += e.rec.delta; }
    else if (e.anc && e.anc.before != null) adj += e.anc.anchor.v - e.anc.before;
  }
  view = { t0, t1, v0, vEnd: derived.bal(t1), pts, inc, out, cnt, adj };
  return view;
}
function cls(d) { return d > 0 ? 'up' : d < 0 ? 'down' : 'flat'; }
const RANGE_LABEL = { '1w': '近 1 周', '1m': '近 1 月', '3m': '近 3 月', '1y': '近 1 年', 'all': '全部' };
function renderQuote() {
  const v = hover ? hover.v : view.vEnd;
  bigMoney($('#qValue'), v);
  const d = v - view.v0;
  const pct = view.v0 !== 0 ? (d / Math.abs(view.v0)) * 100 : 0;
  const ch = $('#qChange'); ch.textContent = '';
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  ch.append(el('span', cls(d), `${sign}¥${fmtMoney(Math.abs(d))}（${sign}${Math.abs(pct).toFixed(2)}%）`), el('span', 'span', hover ? '较 ' + fmtDate(view.t0) : RANGE_LABEL[range]));
  const sc = $('#qScrub'); const lbl = $('#qLabel');
  lbl.classList.toggle('sample', !!state.sample && !hover);
  if (hover) {
    lbl.textContent = fmtDT(hover.t);
    if (hover.e && hover.e.rec) { const x = hover.e.rec.x; sc.textContent = (x.name || x.note || '交易') + '　' + fmtMoney(hover.e.rec.delta, { sign: true }); }
    else if (hover.e && hover.e.anc) sc.textContent = '校准到 ¥' + fmtMoney(hover.e.anc.anchor.v);
    else sc.textContent = '这一刻没有交易';
    sc.classList.add('on');
  } else {
    lbl.textContent = '总资产';
    sc.textContent = derived.anchors.length ? '校准于 ' + fmtDT(derived.anchors[derived.anchors.length - 1].t) : '还没填写总资产，显示的是累计收支';
    sc.classList.remove('on');
  }
}
function renderStats() {
  $('#sIn').textContent = fmtMoney(view.inc);
  $('#sOut').textContent = fmtMoney(-view.out);
  if (view.adj) { $('#sCntK').textContent = '校准调整'; $('#sCnt').textContent = fmtMoney(view.adj, { sign: true }); }
  else { $('#sCntK').textContent = '计入笔数'; $('#sCnt').textContent = String(view.cnt); }
}

/* chart: one line, a dotted baseline at the range start, nothing else */
const cv = $('#chart'); const ctx = cv.getContext('2d');
let geo = null;
function tok(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function hexA(c, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  return c;
}
function drawChart() {
  if (!view || tab !== 'trend') return;
  const rect = cv.getBoundingClientRect(); if (rect.width < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const W = rect.width, H = rect.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const padT = 14, padB = 14, padL = 0, padR = 14;
  const { t0, t1, v0, pts } = view;
  let vmin = v0, vmax = v0; for (const p of pts) { if (p.v < vmin) vmin = p.v; if (p.v > vmax) vmax = p.v; }
  if (vmax === vmin) { vmax += 100; vmin -= 100; }
  const X = (t) => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const Y = (v) => padT + (vmax - v) / (vmax - vmin) * (H - padT - padB);
  geo = { X, Y, W, H, padL, padR };
  const end = view.vEnd; const col = end > v0 ? tok('--up') : end < v0 ? tok('--down') : tok('--ink-3');
  $('#ranges').dataset.trend = end > v0 ? 'up' : end < v0 ? 'down' : 'flat';
  ctx.setLineDash([2, 5]); ctx.strokeStyle = tok('--ink-3'); ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
  const yb = Math.round(Y(v0)) + 0.5; ctx.beginPath(); ctx.moveTo(0, yb); ctx.lineTo(W, yb); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  const path = new Path2D(); path.moveTo(X(t0), Y(v0)); let prev = v0;
  for (const p of pts) { const x = X(p.t); path.lineTo(x, Y(prev)); path.lineTo(x, Y(p.v)); prev = p.v; }
  path.lineTo(X(t1), Y(prev));
  const dim = hover ? 0.35 : 1;
  if (hover) {
    // left of the cursor in full colour, right of it faded
    const hx = X(hover.t);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, hx, H); ctx.clip(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(path); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(hx, 0, W - hx, H); ctx.clip(); ctx.globalAlpha = dim; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(path); ctx.restore();
    ctx.strokeStyle = tok('--line'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(hx) + 0.5, 0); ctx.lineTo(Math.round(hx) + 0.5, H); ctx.stroke();
    const hy = Y(hover.v);
    ctx.fillStyle = tok('--bg'); ctx.beginPath(); ctx.arc(hx, hy, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke(path);
    const ex = X(t1), ey = Y(prev);
    ctx.fillStyle = hexA(col, 0.18); ctx.beginPath(); ctx.arc(ex, ey, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fill();
  }
  cv.setAttribute('aria-label', `总资产走势，${fmtDate(t0)}到现在，从 ${fmtMoney(v0)} 元到 ${fmtMoney(view.vEnd)} 元，变动 ${fmtMoney(view.vEnd - v0, { sign: true })} 元`);
}
function hoverAt(clientX) {
  if (!geo || !view) return;
  const rect = cv.getBoundingClientRect(); const px = clientX - rect.left;
  const { t0, t1 } = view;
  const t = Math.min(t1, Math.max(t0, t0 + (px - geo.padL) / (geo.W - geo.padL - geo.padR) * (t1 - t0)));
  let best = null, bd = 14, bi = -1;
  const pts = view.pts;
  let lo = 0, hi = pts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m + 1; else hi = m; }
  for (let i = Math.max(0, lo - 3); i < Math.min(pts.length, lo + 3); i++) { const dx = Math.abs(geo.X(pts[i].t) - px); if (dx < bd) { bd = dx; best = pts[i]; bi = i; } }
  if (best) { let j = bi; while (j + 1 < pts.length && pts[j + 1].t === best.t) j++; hover = { t: best.t, v: pts[j].v, e: best.e }; }
  else hover = { t, v: lo > 0 ? pts[lo - 1].v : view.v0, e: null };
  renderQuote(); drawChart();
}
function clearHover() { if (!hover) return; hover = null; renderQuote(); drawChart(); }
let dragging = false;
cv.addEventListener('pointerdown', (e) => { dragging = true; hoverAt(e.clientX); });
cv.addEventListener('pointermove', (e) => { if (dragging || e.pointerType === 'mouse') hoverAt(e.clientX); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => cv.addEventListener(n, () => { dragging = false; clearHover(); }));

/* ledger rows (shared by 走势 and 分类) */
function makeRow(it) {
  const b = el('button', 'row'); b.type = 'button'; b._item = it;
  const main = el('span', 'row-m'); const right = el('span', 'row-r');
  if (it.r) {
    const { x, s } = it.r;
    const sub = [s !== 0 && it.r.cat ? CATS[it.r.cat].n : null, srcLabel(x), fmtTime(x.t), x.note && x.note !== x.name ? x.note : null].filter(Boolean).join(' · ');
    main.append(el('span', 'row-t', x.name || x.note || '(无名称)'), el('span', 'row-s', sub));
    if (s === 0) { b.classList.add('off'); right.append(el('span', 'row-a', fmtMoney(x.dir === 1 ? x.amt : -x.amt)), el('span', 'row-x', '未计入 · ' + (it.r.why || ''))); }
    else { right.append(el('span', 'row-a' + (it.r.delta > 0 ? ' in' : ''), fmtMoney(it.r.delta, { sign: true }))); if (it.r.manual) right.append(el('span', 'row-x', '手动设置')); }
  } else {
    const a = it.a;
    main.append(el('span', 'row-t', a.before == null ? '首次填写总资产' : '校准余额'), el('span', 'row-s', fmtTime(a.anchor.t) + ' · 填写 ¥' + fmtMoney(a.anchor.v)));
    if (a.before == null) right.append(el('span', 'row-a', '¥' + fmtMoney(a.anchor.v)));
    else { const d = a.anchor.v - a.before; right.append(el('span', 'row-a' + (d > 0 ? ' in' : ''), fmtMoney(d, { sign: true }))); }
  }
  b.append(main, right);
  return b;
}
function itemDelta(it) { if (it.r) return it.r.s ? it.r.delta : 0; return it.a.before == null ? 0 : it.a.anchor.v - it.a.before; }
/* Days fold: only the newest day starts open; a tap on the day line opens or closes it. */
const dayOpen = new Map();
function renderDays(container, items, dayLimit) {
  container.textContent = '';
  const groups = []; let g = null;
  for (const it of items) {
    const k = dayKey(it.t);
    if (!g || g.k !== k) { g = { k, t: it.t, items: [], net: 0, n: 0 }; groups.push(g); }
    g.items.push(it); g.net += itemDelta(it); if (it.r) g.n++;
  }
  groups.slice(0, dayLimit).forEach((g, idx) => {
    const id = container.id + ':' + g.k;
    const open = dayOpen.has(id) ? dayOpen.get(id) : idx === 0;
    const day = el('div', 'day');
    const h = el('button', 'dayh'); h.type = 'button'; h.setAttribute('aria-expanded', String(open));
    const l = el('span', 'dl'); l.append(el('span', 'd', fmtDateAuto(g.t)), el('span', 'w', WD[new Date(g.t).getDay()] + (g.n ? ' · ' + g.n + ' 笔' : '')));
    h.append(l, el('span', 'net' + (g.net > 0 ? ' in' : ''), g.net ? fmtMoney(g.net, { sign: true }) : ''), icon('chev'));
    const rows = el('div', 'rows'); rows.hidden = !open;
    const fill = () => { if (!rows.children.length) for (const it of g.items) rows.append(makeRow(it)); };
    if (open) fill();
    h.addEventListener('click', () => {
      const next = rows.hidden; dayOpen.set(id, next); h.setAttribute('aria-expanded', String(next));
      if (next) fill(); rows.hidden = !next;
      if (container.id === 'list') updateExpandAll();
    });
    day.append(h, rows); container.append(day);
  });
  return groups.length;
}
function updateExpandAll() {
  const hs = Array.from($('#list').querySelectorAll('.dayh'));
  const allOpen = hs.length > 0 && hs.every((h) => h.getAttribute('aria-expanded') === 'true');
  const b = $('#expandAll'); b.hidden = hs.length < 2; b.textContent = allOpen ? '全部收起' : '全部展开'; b.dataset.open = allOpen ? '1' : '';
}
$('#expandAll').addEventListener('click', () => {
  const open = $('#expandAll').dataset.open !== '1';
  for (const h of $('#list').querySelectorAll('.dayh')) if ((h.getAttribute('aria-expanded') === 'true') !== open) h.click();
  updateExpandAll();
});
function renderList() {
  const list = $('#list');
  const items = [];
  for (const r of derived.all) {
    if (r.x.t <= view.t0 || r.x.t > view.t1) continue;
    if (filter === 'in' && r.s === 0) continue;
    if (filter === 'off' && r.s !== 0) continue;
    items.push({ t: r.x.t, r });
  }
  if (filter !== 'off') for (const a of derived.anchorRecs) if (a.anchor.t > view.t0 && a.anchor.t <= view.t1) items.push({ t: a.anchor.t, a });
  items.sort((p, q) => q.t - p.t);
  if (!items.length) { list.textContent = ''; list.append(el('div', 'empty', state.tx.length ? '这个时间范围里没有记录。' : '还没有记录。点右上角导入账单，或点底部中间的笔记一笔。')); $('#moreRow').hidden = true; $('#listMeta').textContent = ''; $('#expandAll').hidden = true; return; }
  const nDays = renderDays(list, items, listLimit);
  const nTx = items.filter((it) => it.r).length;
  $('#listMeta').textContent = `${nTx} 笔 · ${nDays} 天`;
  setMoreRow($('#moreRow'), nDays, listLimit);
  updateExpandAll();
}
document.addEventListener('click', (e) => { const b = e.target.closest('.row'); if (b && b._item) openTx(b._item); });
function setMoreRow(row, nDays, limit) {
  const rest = nDays - limit;
  row.hidden = rest <= 0 && limit <= DAYS_FIRST;
  const more = row.querySelector('.more:not(.mute)'); const less = row.querySelector('.more.mute');
  more.hidden = rest <= 0; more.textContent = `显示更多 · 还有 ${rest} 天`;
  less.hidden = limit <= DAYS_FIRST;
}
$('#moreBtn').addEventListener('click', () => { listLimit += DAYS_MORE; renderList(); });
$('#lessBtn').addEventListener('click', () => { listLimit = DAYS_FIRST; renderList(); $('#list').closest('.sec').scrollIntoView({ block: 'start' }); });
$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; filter = b.dataset.f; listLimit = DAYS_FIRST;
  for (const x of $('#filters').children) x.setAttribute('aria-selected', String(x === b));
  renderList();
});
$('#ranges').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; range = b.dataset.r; listLimit = DAYS_FIRST;
  try { localStorage.setItem(LS_KEY + ':range', range); } catch (er) {}
  renderTrend();
});
function renderTrend() {
  buildView(); hover = null;
  for (const x of $('#ranges').children) x.setAttribute('aria-selected', String(x.dataset.r === range));
  renderQuote(); renderStats(); drawChart(); renderList(); renderReminders();
}

/* ---------------- sheets ---------------- */
let openSheetEl = null;
function openSheet(id) { closeSheet(); openSheetEl = $(id); $('#scrim').hidden = false; openSheetEl.hidden = false; openSheetEl.scrollTop = 0; }
function closeSheet() { if (openSheetEl) openSheetEl.hidden = true; openSheetEl = null; $('#scrim').hidden = true; }
$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
for (const x of document.querySelectorAll('.sheet-h .x')) x.append(icon('close'));
for (const s of document.querySelectorAll('[data-icon]')) s.append(icon(s.dataset.icon));
function armDelete(btn, label, fn) {
  btn.textContent = label; btn.dataset.armed = '';
  btn.onclick = () => { if (btn.dataset.armed === '1') { fn(); return; } btn.dataset.armed = '1'; btn.textContent = '再点一次确认删除'; };
}
function catChips(container, inc, selected, onPick) {
  container.textContent = '';
  for (const id of inc ? INC_ORDER : EXP_ORDER) {
    const b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(id === selected));
    b.append(catDot(id), document.createTextNode(CATS[id].n));
    b.addEventListener('click', () => { for (const c of container.children) c.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'true'); onPick(id); });
    container.append(b);
  }
}

/* transaction sheet */
let txCur = null;
function openTx(item) {
  txCur = item; const kv = $('#txKv'); kv.textContent = '';
  const addKV = (k, v) => { if (v == null || v === '') return; kv.append(el('dt', null, k), el('dd', null, v)); };
  $('#txDel').hidden = true; $('#anchorDel').hidden = true;
  const amtEl = $('#txAmt');
  if (item.r) {
    const { x, s } = item.r;
    $('#txTitle').textContent = x.name || x.note || '交易';
    amtEl.className = 'tx-a' + (s === 0 ? ' flat' : item.r.delta > 0 ? ' up' : '');
    amtEl.textContent = s === 0 ? fmtMoney(x.dir === 1 ? x.amt : -x.amt) : fmtMoney(item.r.delta, { sign: true });
    $('#txSub').textContent = fmtDT(x.t) + ' · ' + srcLabel(x) + (s !== 0 && item.r.cat ? ' · ' + CATS[item.r.cat].n : '');
    addKV('说明', x.note !== x.name ? x.note : ''); addKV('类型', x.type); addKV('支付方式', x.method); addKV('状态', x.status);
    if (x.bal != null) addKV('卡内余额', '¥' + fmtMoney(x.bal));
    kv.hidden = !kv.children.length;
    $('#txWhy').textContent = s === 0 ? '没有计入曲线：' + (item.r.why || '') + '。' : (item.r.manual ? '你手动设置了计入方式。' : '已计入曲线。') + (item.r.why && !item.r.manual ? '（' + item.r.why + '）' : '');
    for (const b of $('#txBtns').children) b.setAttribute('aria-selected', String(+b.dataset.set === s));
    $('#txCountBox').hidden = false; $('#txReset').hidden = !item.r.manual;
    $('#txCatBox').hidden = s === 0;
    if (s !== 0) {
      const key = mkey(x); $('#txRule').checked = false; $('#txRule').closest('.check').hidden = !key || x.src === 'manual';
      $('#txRuleText').textContent = '以后「' + (x.name || x.note || '').slice(0, 16) + '」都用这个分类';
      catChips($('#txCats'), s > 0, item.r.cat, (id) => {
        state.cat[x.id] = id;
        if ($('#txRule').checked && key) state.rules[key] = id;
        saveState(); renderAll(); toast('已改为「' + CATS[id].n + '」');
      });
      $('#txRule').onchange = () => { if ($('#txRule').checked && key) { const c = state.cat[x.id] || item.r.cat; state.rules[key] = c; saveState(); renderAll(); toast('同一商户以后都归到「' + CATS[c].n + '」'); } };
    }
    if (x.src === 'manual') { $('#txDel').hidden = false; armDelete($('#txDel'), '删除这笔', () => { state.tx = state.tx.filter((t) => t.id !== x.id); delete state.cat[x.id]; delete state.ov[x.id]; saveState(); closeSheet(); renderAll(); toast('已删除'); }); }
  } else {
    const a = item.a; $('#txTitle').textContent = a.before == null ? '首次填写总资产' : '校准余额';
    if (a.before == null) { amtEl.className = 'tx-a'; amtEl.textContent = '¥' + fmtMoney(a.anchor.v); }
    else { const d = a.anchor.v - a.before; amtEl.className = 'tx-a' + (d > 0 ? ' up' : ''); amtEl.textContent = fmtMoney(d, { sign: true }); }
    $('#txSub').textContent = fmtDT(a.anchor.t);
    addKV('填写金额', '¥' + fmtMoney(a.anchor.v)); if (a.before != null) addKV('当时推算', '¥' + fmtMoney(a.before));
    kv.hidden = false;
    $('#txWhy').textContent = a.before == null ? '曲线以这个数为基准，按账单往前、往后推算。' : '校准把曲线在这一刻调整到你填写的数字，差额通常来自没导入的账户、现金或利息。';
    $('#txCountBox').hidden = true; $('#txCatBox').hidden = true; $('#anchorDel').hidden = false;
    armDelete($('#anchorDel'), '删除这次校准', () => { state.anchors = state.anchors.filter((x) => !(x.t === a.anchor.t && x.v === a.anchor.v)); saveState(); closeSheet(); renderAll(); toast('已删除这次校准'); });
  }
  openSheet('#txSheet');
}
$('#txBtns').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || !txCur || !txCur.r) return;
  const v = +b.dataset.set; const id = txCur.r.x.id;
  if (v === txCur.r.auto) delete state.ov[id]; else state.ov[id] = v;
  saveState(); closeSheet(); renderAll(); toast(v === 0 ? '已设为不计入' : v > 0 ? '已计为收入' : '已计为支出');
});
$('#txReset').addEventListener('click', () => { if (!txCur || !txCur.r) return; delete state.ov[txCur.r.x.id]; saveState(); closeSheet(); renderAll(); toast('已恢复自动判断'); });

/* calibrate */
function openCalib(text) {
  derive(); const pred = derived.bal(Date.now());
  $('#calPred').textContent = '¥' + fmtMoney(pred); $('#calInput').value = ''; $('#calDiff').textContent = '';
  $('#calInput').placeholder = (pred / 100).toFixed(2);
  $('#calText').hidden = !!text; $('#calTitle').textContent = text ? '填写现在的总资产' : '校准余额';
  let extra = $('#calExtra'); if (!extra) { extra = el('p'); extra.id = 'calExtra'; $('#calText').after(extra); }
  extra.textContent = text || ''; extra.hidden = !text;
  openSheet('#calibSheet');
}
$('#calibBtn').addEventListener('click', () => openCalib());
$('#calibRow').addEventListener('click', () => openCalib());
$('#calInput').addEventListener('input', () => {
  const v = parseMoneyInput($('#calInput').value); const pred = derived.bal(Date.now());
  $('#calDiff').textContent = v == null || !state.anchors.length || state.sample ? '' : '比推算' + (v >= pred ? '多 ' : '少 ') + '¥' + fmtMoney(Math.abs(v - pred));
});
$('#calSave').addEventListener('click', () => {
  const v = parseMoneyInput($('#calInput').value);
  if (v == null) { toast('请填写金额，例如 86420.35'); return; }
  leaveSample();
  state.anchors.push({ t: Date.now(), v }); saveState(); closeSheet(); renderAll(); toast('已保存');
});

/* clear */
$('#clearBtn').addEventListener('click', () => openSheet('#clearSheet'));
$('#clearYes').addEventListener('click', () => {
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  state = makeSample(); closeSheet(); renderAll(); toast('已清空，现在显示示例数据');
});

/* backup / restore */
/* Inside Claude the viewer's downloads capability saves the file; on a normal website (GitHub Pages)
   the iPhone share sheet ("存储到文件") is used, with a plain download as the last resort. */
const IN_CLAUDE = !!(window.claude && window.claude.use);
let downloads = null;
(async () => {
  if (!IN_CLAUDE) { $('#backupBtn').hidden = false; return; }
  try { downloads = await window.claude.use('downloads'); } catch (e) { downloads = null; }
  $('#backupBtn').hidden = !downloads;
})();
async function saveTextFile(name, text) {
  if (downloads) { await downloads.save({ filename: name, data: text }); return; }
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  const url = URL.createObjectURL(file); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$('#backupBtn').addEventListener('click', async () => {
  if (state.sample) { toast('现在是示例数据，没有可备份的内容'); return; }
  const d = new Date(); const name = `thread-backup-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`;
  try { await saveTextFile(name, JSON.stringify(state)); toast('备份已保存'); }
  catch (e) { if (e && (e.code === 'declined' || e.name === 'AbortError')) return; toast('无法保存备份文件'); }
});
$('#restoreInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!s || s.v !== 1 || !Array.isArray(s.tx) || !Array.isArray(s.anchors)) throw new Error('bad');
    s.sample = false; state = migrate(s);
    saveState(); renderAll(); toast(`已恢复 ${state.tx.length} 笔记录`);
  } catch (er) { toast('这不是 thread 的备份文件'); }
});

