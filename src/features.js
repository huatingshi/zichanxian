
/* ---------------- import flow ---------------- */
let staged = null;
function openImport() {
  staged = null; $('#fileInput').value = ''; $('#fileList').textContent = ''; $('#stageBox').hidden = true;
  $('#parseBtn').disabled = true; $('#saveImportBtn').disabled = true; $('#anchorInput').value = '';
  openSheet('#importSheet');
}
$('#importBtn').addEventListener('click', openImport);
$('#importRow').addEventListener('click', openImport);
$('#fileInput').addEventListener('change', () => {
  const fl = $('#fileList'); fl.textContent = ''; staged = null; $('#stageBox').hidden = true; $('#saveImportBtn').disabled = true;
  const files = Array.from($('#fileInput').files || []);
  for (const f of files) { const d = el('div', 'fileres'); d.append(el('div', 'fn', f.name)); fl.append(d); }
  $('#parseBtn').disabled = !files.length;
});
$('#parseBtn').addEventListener('click', async () => {
  const files = Array.from($('#fileInput').files || []); if (!files.length) return;
  const pw = $('#pwInput').value.trim();
  const btn = $('#parseBtn'); btn.disabled = true; btn.textContent = ''; btn.append(el('span', 'spinner'), document.createTextNode('解析中'));
  const fl = $('#fileList'); fl.textContent = '';
  const existing = new Set(state.sample ? [] : state.tx.map((x) => x.id));
  const newTx = new Map();
  for (const f of files) {
    const d = el('div', 'fileres'); d.append(el('div', 'fn', f.name)); fl.append(d);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const res = await parseBytes(bytes, f.name, pw, 0);
      for (const r of res) {
        let added = 0, minT = Infinity, maxT = -Infinity;
        for (const x of r.tx) { if (x.t < minT) minT = x.t; if (x.t > maxT) maxT = x.t; if (!existing.has(x.id) && !newTx.has(x.id)) { newTx.set(x.id, x); added++; } }
        const label = r.src === 'bank' ? r.bank : SRC_NAME[r.src];
        d.append(el('div', 'ok', r.tx.length ? `${label}：${fmtDate(minT, true)} 至 ${fmtDate(maxT, true)}，共 ${r.tx.length} 笔，新增 ${added} 笔` : `${label}：没有交易记录`));
      }
    } catch (e) {
      d.append(el('div', 'err', (e && e.message) || String(e)));
    }
  }
  btn.textContent = '重新解析'; btn.disabled = false;
  staged = { tx: Array.from(newTx.values()) };
  const hasAnchors = !state.sample && state.anchors.length > 0;
  $('#stageBox').hidden = false;
  if (hasAnchors) {
    const keep = state.tx; state.tx = keep.concat(staged.tx); derive(); const pred = derived.bal(Date.now()); state.tx = keep; derive();
    $('#anchorInput').value = (pred / 100).toFixed(2);
    $('#anchorHint').textContent = '这是按账单推算的现在的总资产。和实际不符就改成实际数字，曲线会在此刻记一笔「校准」。';
  } else {
    $('#anchorHint').textContent = '把微信零钱、支付宝余额和余额宝、银行卡余额加起来填一个数。曲线以它为终点，按账单往回推算每一天的资产。';
  }
  $('#saveImportBtn').disabled = !(staged.tx.length || hasAnchors);
  if (!staged.tx.length) toast('没有新的交易记录');
});
$('#saveImportBtn').addEventListener('click', () => {
  if (!staged) return;
  const v = parseMoneyInput($('#anchorInput').value);
  const needAnchor = state.sample || !state.anchors.length;
  if (needAnchor && v == null) { toast('请填写现在的总资产'); $('#anchorInput').focus(); return; }
  leaveSample();
  state.tx = state.tx.concat(staged.tx);
  derive();
  if (v != null) { const pred = derived.bal(Date.now()); if (needAnchor || Math.abs(pred - v) >= 1) state.anchors.push({ t: Date.now(), v }); }
  const n = staged.tx.length; staged = null;
  saveState(); closeSheet(); renderAll(); toast(`已导入 ${n} 笔`);
});

/* ---------------- quick add ---------------- */
const qa = { dir: -1, cat: null, picked: false };
function qaGrid() { catChips($('#qaCats'), qa.dir > 0, qa.cat, (id) => { qa.cat = id; qa.picked = true; $('#qaAuto').textContent = ''; }); }
$('#fab').addEventListener('click', () => {
  qa.dir = -1; qa.cat = null; qa.picked = false;
  $('#qaAmt').value = ''; $('#qaNote').value = ''; $('#qaTime').value = toDTInput(Date.now()); $('#qaAuto').textContent = '';
  for (const b of $('#qaKind').children) b.setAttribute('aria-selected', String(+b.dataset.k === -1));
  qaGrid(); openSheet('#qaSheet');
  $('#qaAmt').focus();
});
$('#qaKind').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return; qa.dir = +b.dataset.k;
  for (const x of $('#qaKind').children) x.setAttribute('aria-selected', String(x === b));
  qa.cat = null; qa.picked = false; $('#qaAuto').textContent = ''; qaGuess(); qaGrid();
});
function qaGuess() {
  const note = $('#qaNote').value.trim(); if (qa.picked || !note) return;
  const g = guessCat(note, qa.dir > 0);
  if (g === 'other' || g === 'otherin') return;
  qa.cat = g; $('#qaAuto').textContent = '按备注自动选择';
}
$('#qaNote').addEventListener('input', () => { if (qa.picked) return; qa.cat = null; $('#qaAuto').textContent = ''; qaGuess(); qaGrid(); });
$('#qaSave').addEventListener('click', () => {
  const amt = parseMoneyInput($('#qaAmt').value);
  if (!amt || amt <= 0) { toast('请填写金额'); $('#qaAmt').focus(); return; }
  const note = $('#qaNote').value.trim();
  const t = fromDateInput($('#qaTime').value) || Date.now();
  const cat = qa.cat || guessCat(note, qa.dir > 0);
  const wasSample = state.sample; leaveSample();
  const x = { id: uid('m:'), src: 'manual', t, amt, dir: qa.dir, name: note || CATS[cat].n, note: '', type: '', status: '', method: '手动记账' };
  state.tx.push(x); state.cat[x.id] = cat;
  saveState(); closeSheet(); renderAll();
  toast(`已记一笔 ${qa.dir < 0 ? '−' : '+'}¥${fmtMoney(amt)} · ${CATS[cat].n}`);
  if (wasSample || !state.anchors.length) openCalib('第一次记账，先填一下现在的总资产（零钱、余额宝、银行卡加起来），曲线才有起点。也可以先关掉，以后再填。');
});

/* ---------------- categories tab ---------------- */
let catRange = 'month', catKind = 'out', selCat = null, catLimit = DAYS_FIRST;
const PERIOD_LABEL = { month: '本月', last: '上月', '3m': '近3月', year: '今年', all: '全部' };
function catPeriod() {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  switch (catRange) {
    case 'month': return [new Date(y, m, 1).getTime(), Infinity];
    case 'last': return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
    case '3m': return [new Date(y, m - 2, 1).getTime(), Infinity];
    case 'year': return [new Date(y, 0, 1).getTime(), Infinity];
    default: return [-Infinity, Infinity];
  }
}
function arcPath(cx, cy, r0, r1, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (r, a) => (cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2);
  return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}
function renderCats() {
  for (const x of $('#catRanges').children) x.setAttribute('aria-selected', String(x.dataset.r === catRange));
  for (const x of $('#catKind').children) x.setAttribute('aria-selected', String(x.dataset.k === catKind));
  const [a, b] = catPeriod(); const inc = catKind === 'in';
  const sums = new Map(); const recs = [];
  for (const r of derived.all) {
    if (!r.s || r.x.t < a || r.x.t >= b) continue;
    if (inc ? r.delta <= 0 : r.delta >= 0) continue;
    sums.set(r.cat, (sums.get(r.cat) || 0) + Math.abs(r.delta)); recs.push(r);
  }
  let total = 0; for (const v of sums.values()) total += v;
  const order = inc ? INC_ORDER : EXP_ORDER;
  const slices = []; let fold = 0; const foldIds = [];
  for (const id of order) { const v = sums.get(id) || 0; if (!v) continue; if (CATS[id].c) slices.push({ id, v, ids: [id] }); else { fold += v; foldIds.push(id); } }
  if (fold) slices.push({ id: '_fold', v: fold, ids: foldIds });
  if (selCat && !sums.has(selCat) && selCat !== '_fold') selCat = null;
  if (selCat === '_fold' && !fold) selCat = null;
  const svg = $('#donut'); svg.textContent = '';
  const NS = 'http://www.w3.org/2000/svg';
  if (!total) {
    const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', 110); c.setAttribute('cy', 110); c.setAttribute('r', 91); c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'var(--fill)'); c.setAttribute('stroke-width', 18); svg.append(c);
  } else {
    let ang = -Math.PI / 2;
    for (const s of slices) {
      const a1 = ang + (s.v / total) * Math.PI * 2;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', arcPath(110, 110, 82, 100, ang, a1));
      p.setAttribute('fill', s.id === '_fold' ? 'var(--c0)' : catColor(s.id));
      p.setAttribute('stroke', 'var(--bg)'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linejoin', 'round');
      if (selCat && (selCat === s.id || s.ids.includes(selCat))) p.classList.add('on');
      const title = document.createElementNS(NS, 'title'); title.textContent = (s.id === '_fold' ? '其他各类' : CATS[s.id].n) + ' ¥' + fmtMoney(s.v) + '（' + (s.v / total * 100).toFixed(1) + '%）'; p.append(title);
      p.addEventListener('click', () => { selCat = selCat === s.id ? null : s.id; catLimit = DAYS_FIRST; renderCats(); });
      svg.append(p); ang = a1;
    }
  }
  $('#donutBox').classList.toggle('sel', !!selCat);
  const selV = selCat === '_fold' ? fold : selCat ? sums.get(selCat) || 0 : 0;
  if (selCat) {
    $('#dcK').textContent = selCat === '_fold' ? '其他各类' : CATS[selCat].n;
    $('#dcV').textContent = fmtMoney(selV); $('#dcP').textContent = (total ? (selV / total * 100).toFixed(1) : '0') + '%';
  } else {
    $('#dcK').textContent = PERIOD_LABEL[catRange] + (inc ? '收入' : '支出');
    $('#dcV').textContent = fmtMoney(total); $('#dcP').textContent = total ? recs.length + ' 笔' : '没有记录';
  }
  $('#donut').setAttribute('aria-label', `${PERIOD_LABEL[catRange]}${inc ? '收入' : '支出'}分类占比，合计 ${fmtMoney(total)} 元`);
  const lg = $('#legend'); lg.textContent = '';
  const rows = Array.from(sums.entries()).sort((p, q) => q[1] - p[1]);
  if (!rows.length) lg.append(el('div', 'empty', `${PERIOD_LABEL[catRange]}没有${inc ? '收入' : '支出'}记录。`));
  for (const [id, v] of rows) {
    const b = el('button', 'row'); b.type = 'button';
    b.setAttribute('aria-pressed', String(selCat === id || (selCat === '_fold' && foldIds.includes(id))));
    const t = el('span', 'row-t'); t.append(catDot(id), el('span', null, CATS[id].n));
    const m = el('span', 'row-m'); m.append(t);
    const r = el('span', 'row-r'); r.append(el('span', 'row-a', fmtMoney(v)), el('span', 'row-x', (v / total * 100).toFixed(1) + '%'));
    b.append(m, r);
    b.addEventListener('click', () => { selCat = selCat === id ? null : id; catLimit = DAYS_FIRST; renderCats(); });
    lg.append(b);
  }
  const box = $('#catTxBox');
  if (selCat) {
    const ids = selCat === '_fold' ? foldIds : [selCat];
    const items = recs.filter((r) => ids.includes(r.cat)).sort((p, q) => q.x.t - p.x.t).map((r) => ({ t: r.x.t, r }));
    $('#catTxTitle').textContent = (selCat === '_fold' ? '其他各类' : CATS[selCat].n) + ' · ' + items.length + ' 笔';
    const nDays = renderDays($('#catTxList'), items, catLimit); setMoreRow($('#catMoreRow'), nDays, catLimit); box.hidden = false;
  } else box.hidden = true;
}
$('#catMoreBtn').addEventListener('click', () => { catLimit += DAYS_MORE; renderCats(); });
$('#catLessBtn').addEventListener('click', () => { catLimit = DAYS_FIRST; renderCats(); $('#catTxBox').scrollIntoView({ block: 'start' }); });
$('#catRanges').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; catRange = b.dataset.r; selCat = null; renderCats(); });
$('#catKind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; catKind = b.dataset.k; selCat = null; renderCats(); });

/* ---------------- repayments tab ---------------- */
function cardNext(card) { let c = card.since, g = 0; while (card.paid[c] && g++ < 600) c = addMonths(c, 1); return c; }
function cardDue(card) {
  const c = cardNext(card); const t = dateInMonth(c, card.due); const days = daysUntil(t);
  const plans = card.plans.map((p) => ({ p, k: monthsBetween(p.start, c) + 1 })).filter((o) => o.k >= 1 && o.k <= o.p.total);
  const inst = plans.reduce((s, o) => s + o.p.per, 0);
  const bill = card.bills[c] != null ? card.bills[c] : null;
  return { c, t, days, inst, bill, plans };
}
const CARD_HUES = ['var(--c1)', 'var(--c7)', 'var(--c3)', 'var(--c2)', 'var(--c5)', 'var(--c4)'];
function renderRepay() {
  const list = $('#cardList'); list.textContent = '';
  let sum = 0, n = 0, left = 0, nearest = null;
  for (const card of state.cards) {
    const d = cardDue(card);
    const amt = d.bill != null ? d.bill : d.inst;
    if (d.days <= 30) { sum += amt; n++; }
    if (!nearest || d.t < nearest.t) nearest = { t: d.t, name: card.name };
    const box = el('div', 'cc');
    const h = el('div', 'cc-h'); const hl = el('div');
    hl.append(el('div', 't', card.name), el('div', 's', '每月 ' + card.due + ' 日还款' + (card.stmt ? ' · 账单日 ' + card.stmt + ' 日' : '')));
    const edit = el('button', 'tbtn mute', '编辑'); edit.type = 'button'; edit.addEventListener('click', () => openCard(card));
    h.append(hl, edit);
    const due = el('div', 'cc-due'); const dl = el('div');
    const dd = el('div', 'd'); dd.append(document.createTextNode(fmtDateAuto(d.t) + ' ' + WD[new Date(d.t).getDay()] + '　'), whenEl(d.days, 7));
    dl.append(el('div', 'k', '下次还款'), dd);
    const da = el('div', 'a'); da.append(document.createTextNode('¥' + fmtMoney(amt)), el('small', null, d.bill != null ? '本期账单' : d.inst ? '分期部分，未填账单' : '未填账单金额'));
    due.append(dl, da);
    const acts = el('div', 'cc-act');
    const paid = el('button', 'tbtn', '标记已还'); paid.type = 'button';
    paid.addEventListener('click', () => { leaveSampleKeep(); const c = findCard(card.id); c.paid[d.c] = true; saveState(); renderAll(); toast(card.name + ' ' + (+d.c.slice(5)) + '月 已还'); });
    const bill = el('button', 'tbtn mute', d.bill != null ? '改账单金额' : '填账单金额'); bill.type = 'button'; bill.addEventListener('click', () => openBill(card, d));
    const addp = el('button', 'tbtn mute', '加分期'); addp.type = 'button'; addp.addEventListener('click', () => openPlan(card, null));
    acts.append(paid, bill, addp);
    box.append(h, due, acts);
    if (card.plans.length) {
      const pl = el('div', 'plans');
      for (const p of card.plans) {
        const paidN = Math.max(0, Math.min(p.total, monthsBetween(p.start, d.c)));
        const rest = p.total - paidN; left += rest * p.per;
        const r = el('button', 'plan'); r.type = 'button';
        const prog = el('span', 'prog'); const i = el('i'); i.style.width = (paidN / p.total * 100).toFixed(1) + '%'; prog.append(i);
        r.append(el('span', 'nm', p.name), el('span', 'r', '¥' + fmtMoney(p.per) + ' × ' + p.total + ' 期'), prog,
          el('span', 's', rest > 0 ? `已还 ${paidN}/${p.total} 期 · 还剩 ¥${fmtMoney(rest * p.per)} · ${+addMonths(p.start, p.total - 1).slice(5)} 月还完` : `${p.total} 期已全部还清`));
        r.addEventListener('click', () => openPlan(card, p));
        pl.append(r);
      }
      box.append(pl);
    }
    list.append(box);
  }
  $('#repaySum').hidden = !state.cards.length; $('#repaySum').nextElementSibling.hidden = !state.cards.length;
  if (!state.cards.length) { list.append(el('div', 'empty', '还没有添加信用卡。添加后，到期前 7 天会在「走势」的提醒里出现。')); return; }
  bigMoney($('#repayBig'), sum);
  $('#repayMeta').textContent = `${n} 笔待还` + (nearest ? ` · 最近 ${fmtDate(nearest.t)} ${nearest.name}` : '') + (left ? ` · 分期还剩 ¥${fmtMoney(left)}` : '');
}
function findCard(id) { return state.cards.find((c) => c.id === id); }
/* Editing sample cards or subscriptions keeps those edits but drops the sample transactions. */
function leaveSampleKeep() {
  if (!state.sample) return;
  const keep = { cards: state.cards, subs: state.subs };
  state = emptyState(); state.cards = keep.cards; state.subs = keep.subs;
}
let cardCur = null;
function openCard(card) {
  cardCur = card;
  $('#cardTitle').textContent = card ? '编辑卡片' : '添加信用卡';
  $('#cdName').value = card ? card.name : ''; $('#cdDue').value = card ? card.due : ''; $('#cdStmt').value = card && card.stmt ? card.stmt : '';
  $('#cdUndo').hidden = !(card && Object.keys(card.paid).length); $('#cdDel').hidden = !card;
  if (card) armDelete($('#cdDel'), '删除这张卡', () => { leaveSampleKeep(); state.cards = state.cards.filter((c) => c.id !== card.id); saveState(); closeSheet(); renderAll(); toast('已删除'); });
  openSheet('#cardSheet');
}
$('#addCardBtn').addEventListener('click', () => openCard(null));
$('#cdUndo').addEventListener('click', () => {
  if (!cardCur) return; leaveSampleKeep(); const c = findCard(cardCur.id);
  const ks = Object.keys(c.paid).sort(); const last = ks[ks.length - 1]; if (!last) return;
  delete c.paid[last]; saveState(); closeSheet(); renderAll(); toast((+last.slice(5)) + '月 改回未还');
});
$('#cdSave').addEventListener('click', () => {
  const name = $('#cdName').value.trim(); const due = parseIntIn($('#cdDue').value, 1, 31);
  const stmtRaw = $('#cdStmt').value.trim(); const stmt = stmtRaw ? parseIntIn(stmtRaw, 1, 31) : null;
  if (!name) { toast('请填写名称'); return; }
  if (!due) { toast('还款日填 1 到 31 之间的数字'); return; }
  if (stmtRaw && !stmt) { toast('账单日填 1 到 31 之间的数字'); return; }
  leaveSampleKeep();
  if (cardCur) { const c = findCard(cardCur.id); c.name = name; c.due = due; c.stmt = stmt; }
  else {
    const now = Date.now(); const since = new Date(now).getDate() <= due ? cycleOf(now) : addMonths(cycleOf(now), 1);
    state.cards.push({ id: uid('card:'), name, due, stmt, since, paid: {}, bills: {}, plans: [] });
  }
  saveState(); closeSheet(); renderAll(); toast('已保存');
});
let billCur = null;
function openBill(card, d) {
  billCur = { id: card.id, c: d.c };
  $('#billText').textContent = `${card.name} ${fmtDateAuto(d.t)} 这一期。银行短信或 App 里的「本期应还」通常已经包含分期金额。`;
  $('#billInput').value = d.bill != null ? (d.bill / 100).toFixed(2) : '';
  openSheet('#billSheet'); $('#billInput').focus();
}
$('#billSave').addEventListener('click', () => {
  const raw = $('#billInput').value.trim(); const v = raw ? parseMoneyInput(raw) : null;
  if (raw && v == null) { toast('金额格式不对，例如 2350.00'); return; }
  leaveSampleKeep(); const c = findCard(billCur.id);
  if (v == null) delete c.bills[billCur.c]; else c.bills[billCur.c] = v;
  saveState(); closeSheet(); renderAll(); toast('已保存');
});
let planCur = null;
function openPlan(card, plan) {
  planCur = { cardId: card.id, plan };
  const nextC = cardNext(card);
  $('#planTitle').textContent = plan ? '编辑分期' : '添加分期';
  $('#plName').value = plan ? plan.name : ''; $('#plPer').value = plan ? (plan.per / 100).toFixed(2) : '';
  $('#plTotal').value = plan ? plan.total : ''; $('#plPaid').value = plan ? Math.max(0, Math.min(plan.total, monthsBetween(plan.start, nextC))) : '';
  $('#plDel').hidden = !plan;
  if (plan) armDelete($('#plDel'), '删除这笔分期', () => { leaveSampleKeep(); const c = findCard(card.id); c.plans = c.plans.filter((p) => p.id !== plan.id); saveState(); closeSheet(); renderAll(); toast('已删除'); });
  openSheet('#planSheet');
}
$('#plSave').addEventListener('click', () => {
  const name = $('#plName').value.trim() || '分期';
  const per = parseMoneyInput($('#plPer').value); const total = parseIntIn($('#plTotal').value, 1, 120);
  const paidRaw = $('#plPaid').value.trim(); const paid = paidRaw ? parseIntIn(paidRaw, 0, 120) : 0;
  if (!per || per <= 0) { toast('请填写每期还款金额'); return; }
  if (!total) { toast('总期数填 1 到 120'); return; }
  if (paid == null || paid > total) { toast('已还期数不能超过总期数'); return; }
  leaveSampleKeep(); const c = findCard(planCur.cardId);
  const start = addMonths(cardNext(c), -paid);
  if (planCur.plan) { const p = c.plans.find((x) => x.id === planCur.plan.id); Object.assign(p, { name, per, total, start }); }
  else c.plans.push({ id: uid('plan:'), name, per, total, start });
  saveState(); closeSheet(); renderAll(); toast('已保存');
});

/* ---------------- subscriptions tab ---------------- */
const CYCLE = { m: { n: '每月', s: '/月', months: 1 }, q: { n: '每季', s: '/季', months: 3 }, y: { n: '每年', s: '/年', months: 12 }, w: { n: '每周', s: '/周', months: 0 } };
function subNext(sub) {
  const st = fromDateInput(sub.start); const today = startOfDay(Date.now());
  if (st == null) return today;
  if (st >= today) return st;
  if (sub.cycle === 'w') { const k = Math.ceil((today - st) / (7 * DAY)); return startOfDay(st + k * 7 * DAY + 3 * 3600e3); }
  const n = CYCLE[sub.cycle].months; const c0 = cycleOf(st); const day = new Date(st).getDate();
  let i = 0, t = st; while (t < today && i < 2400) { i++; t = dateInMonth(addMonths(c0, i * n), day); }
  return t;
}
function monthlyEq(sub) { return sub.cycle === 'm' ? sub.amt : sub.cycle === 'q' ? sub.amt / 3 : sub.cycle === 'y' ? sub.amt / 12 : sub.amt * 52 / 12; }
function renderSubs() {
  const list = $('#subList'); list.textContent = '';
  const subs = state.subs.map((s) => ({ s, t: subNext(s) })).sort((a, b) => a.t - b.t);
  let mo = 0;
  for (const { s, t } of subs) {
    mo += monthlyEq(s);
    const r = el('button', 'row'); r.type = 'button';
    const main = el('span', 'row-m');
    main.append(el('span', 'row-t', s.name), el('span', 'row-s', CYCLE[s.cycle].n + ' · 下次 ' + fmtDateAuto(t) + (s.method ? ' · ' + s.method : '')));
    const right = el('span', 'row-r');
    right.append(el('span', 'row-a', fmtMoney(s.amt)));
    const days = daysUntil(t);
    right.append(days <= 3 ? whenEl(days, 3) : el('span', 'row-x', CYCLE[s.cycle].s.slice(1) + '付'));
    r.append(main, right); r.addEventListener('click', () => openSub(s, null));
    list.append(r);
  }
  $('#subSum').hidden = !subs.length; $('#subSum').nextElementSibling.hidden = !subs.length;
  if (!subs.length) list.append(el('div', 'empty', '还没有订阅。手动添加，或导入账单后从下面的建议里添加。'));
  else {
    bigMoney($('#subBig'), mo);
    $('#subMeta').textContent = `每年约 ¥${fmtMoney(mo * 12)} · ${subs.length} 个订阅 · 下一笔 ${fmtDate(subs[0].t)} ${subs[0].s.name}`;
  }
  const sugg = detectSubs(); const sl = $('#suggList'); sl.textContent = '';
  for (const g of sugg) {
    const row = el('div', 'row');
    const main = el('span', 'row-m');
    main.append(el('span', 'row-t', g.name), el('span', 'row-s', '¥' + fmtMoney(g.amt) + CYCLE[g.cycle].s + ' · 账单里 ' + g.count + ' 次 · 最近 ' + fmtDate(g.last)));
    const bx = el('span', 'sugg-b');
    const add = el('button', 'tbtn', '添加'); add.type = 'button'; add.addEventListener('click', () => openSub(null, g));
    const ign = el('button', 'tbtn mute', '忽略'); ign.type = 'button';
    ign.addEventListener('click', () => { leaveSampleKeep(); state.subHide.push(g.hideKey); saveState(); renderSubs(); });
    bx.append(add, ign); row.append(main, bx); sl.append(row);
  }
  $('#suggBox').hidden = !sugg.length;
}
function detectSubs() {
  const groups = new Map();
  for (const r of derived.all) {
    if (r.s !== -1 || r.x.src === 'manual') continue;
    if (['housing', 'social', 'food', 'grocery', 'transport', 'shopping', 'travel', 'medical'].includes(r.cat)) continue;
    const k = mkey(r.x); if (!k) continue;
    const key = k + '|' + r.x.amt;
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r);
  }
  const subKeys = state.subs.map((s) => s.name.replace(/[\s+＋]/g, '').toLowerCase()).filter(Boolean);
  const hide = new Set(state.subHide);
  const out = [];
  for (const [key, arr] of groups) {
    if (hide.has(key)) continue;
    arr.sort((a, b) => a.x.t - b.x.t);
    const last = arr[arr.length - 1].x; const n = arr.length;
    const iv = []; for (let i = 1; i < n; i++) iv.push((arr[i].x.t - arr[i - 1].x.t) / DAY);
    const kw = /会员|自动续费|连续包|订阅|VIP|iCloud/i.test(last.name + last.note + last.type);
    const all = (lo, hi) => iv.length > 0 && iv.every((d) => d >= lo && d <= hi);
    let cycle = null;
    if ((n >= 3 || (kw && n >= 2)) && all(26, 35)) cycle = 'm';
    else if (n >= 2 && all(85, 96)) cycle = 'q';
    else if (n >= 2 && all(355, 375)) cycle = 'y';
    else if (kw && n === 1) cycle = 'm';
    if (!cycle) continue;
    const hay = (last.name + last.note).replace(/\s/g, '').toLowerCase(); const mk = mkey(last).toLowerCase();
    if (subKeys.some((k) => hay.includes(k) || (mk && k.includes(mk)))) continue;
    out.push({ hideKey: key, name: last.name || last.note, amt: last.amt, cycle, count: n, last: last.t, method: last.method });
  }
  return out.sort((a, b) => b.last - a.last).slice(0, 8);
}
let subCur = null;
function openSub(sub, sugg) {
  $('#subTitle').textContent = sub ? '编辑订阅' : '添加订阅';
  const src = sub || sugg || {};
  $('#sbName').value = src.name || ''; $('#sbAmt').value = src.amt ? (src.amt / 100).toFixed(2) : '';
  $('#sbCycle').value = src.cycle || 'm'; $('#sbMethod').value = src.method || '';
  let next = sub ? subNext(sub) : null;
  if (!sub && sugg) {
    const t = sugg.last; const step = CYCLE[sugg.cycle].months;
    next = sugg.cycle === 'w' ? t + 7 * DAY : dateInMonth(addMonths(cycleOf(t), step), new Date(t).getDate());
    let g = 0; while (next < startOfDay(Date.now()) && g++ < 600) next = sugg.cycle === 'w' ? next + 7 * DAY : dateInMonth(addMonths(cycleOf(next), step), new Date(t).getDate());
  }
  $('#sbNext').value = toDateInput(next || Date.now());
  $('#sbDel').hidden = !sub;
  if (sub) armDelete($('#sbDel'), '删除这个订阅', () => { leaveSampleKeep(); state.subs = state.subs.filter((s) => s.id !== sub.id); saveState(); closeSheet(); renderAll(); toast('已删除'); });
  subCur = sub ? sub.id : null;
  openSheet('#subSheet');
}
$('#addSubBtn').addEventListener('click', () => openSub(null, null));
$('#sbSave').addEventListener('click', () => {
  const name = $('#sbName').value.trim(); const amt = parseMoneyInput($('#sbAmt').value);
  const cycle = $('#sbCycle').value; const start = $('#sbNext').value; const method = $('#sbMethod').value.trim();
  if (!name) { toast('请填写名称'); return; }
  if (!amt || amt <= 0) { toast('请填写扣费金额'); return; }
  if (!fromDateInput(start)) { toast('请选择下次扣费日期'); return; }
  leaveSampleKeep();
  if (subCur) Object.assign(state.subs.find((s) => s.id === subCur), { name, amt, cycle, start, method });
  else state.subs.push({ id: uid('sub:'), name, amt, cycle, start, method });
  saveState(); closeSheet(); renderAll(); toast('已保存');
});

/* ---------------- reminders & tabs ---------------- */
function reminders() {
  const out = [];
  state.cards.forEach((card, idx) => { const d = cardDue(card); if (d.days <= 7) out.push({ kind: 'card', title: card.name + ' 还款', t: d.t, days: d.days, amt: d.bill != null ? d.bill : d.inst, tab: 'repay', hue: CARD_HUES[idx % CARD_HUES.length] }); });
  for (const s of state.subs) { const t = subNext(s); const days = daysUntil(t); if (days <= 3) out.push({ kind: 'sub', title: s.name + ' 自动扣费', t, days, amt: s.amt, tab: 'subs', hue: 'var(--c7)' }); }
  return out.sort((a, b) => a.days - b.days);
}
function renderReminders() {
  const rs = reminders(); const box = $('#remindBox'); box.textContent = '';
  for (const r of rs) {
    const b = el('button', 'row'); b.type = 'button';
    const main = el('span', 'row-m'); main.append(el('span', 'row-t', r.title), el('span', 'row-s', fmtDateAuto(r.t) + ' ' + WD[new Date(r.t).getDay()]));
    const right = el('span', 'row-r'); right.append(el('span', 'row-a', r.amt ? fmtMoney(r.amt) : '—'), whenEl(r.days, r.kind === 'card' ? 7 : 3));
    b.append(main, right);
    b.addEventListener('click', () => setTab(r.tab));
    box.append(b);
  }
  $('#remindSec').hidden = !rs.length;
  $('#repayBadge').hidden = !rs.some((r) => r.kind === 'card' && r.days <= 3);
  $('#subBadge').hidden = !rs.some((r) => r.kind === 'sub' && r.days <= 1);
}
function setTab(t) {
  tab = t;
  try { localStorage.setItem(LS_KEY + ':tab', t); } catch (e) {}
  applyTab(); window.scrollTo(0, 0);
}
function applyTab() {
  if (!['trend', 'cats', 'repay', 'subs'].includes(tab)) tab = 'trend';
  for (const b of $('#tabbar').querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const id of ['trend', 'cats', 'repay', 'subs']) $('#pane-' + id).hidden = id !== tab;
  $('#sampleNotice').hidden = !state.sample || tab !== 'trend';
  if (tab === 'trend') requestAnimationFrame(drawChart);
}
$('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

function renderAll() {
  derive();
  applyTab();
  renderTrend(); renderCats(); renderRepay(); renderSubs();
}

/* ---------------- boot ---------------- */
renderAll();
let rT = null;
new ResizeObserver(() => { cancelAnimationFrame(rT); rT = requestAnimationFrame(drawChart); }).observe(cv);
const mq = window.matchMedia('(prefers-color-scheme: dark)');
if (mq.addEventListener) mq.addEventListener('change', drawChart);
new MutationObserver(drawChart).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawChart);
})();
</script>
