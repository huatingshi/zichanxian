const LIBS = {
  zip: 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.45/dist/zip-full.min.js',
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  pdfCmaps: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
  pdfFonts: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/'
};
const LS_KEY = 'zichanxian.v1';
const DAY = 864e5;
const SRC_NAME = { wx: '微信', ali: '支付宝', bank: '银行卡', manual: '手记' };
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/* ---------------- utils ---------------- */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function fmtMoney(c, opts) {
  opts = opts || {};
  const neg = c < 0; const a = Math.abs(Math.round(c));
  const s = (Math.floor(a / 100)).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0');
  if (opts.sign) return (c > 0 ? '+' : c < 0 ? '−' : '') + s;
  return (neg ? '−' : '') + s;
}
function pad2(n) { return String(n).padStart(2, '0'); }
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function fmtDate(t, withYear) { const d = new Date(t); return (withYear ? d.getFullYear() + '年' : '') + (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
function fmtDateAuto(t) { return fmtDate(t, new Date(t).getFullYear() !== new Date().getFullYear()); }
function fmtTime(t) { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fmtDT(t) { return fmtDateAuto(t) + ' ' + fmtTime(t); }
function dayKey(t) { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function parseMoneyInput(s) {
  if (s == null) return null;
  s = String(s).replace(/[,，\s¥￥元]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}
function parseIntIn(s, lo, hi) { const n = parseInt(String(s || '').trim(), 10); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; }
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}
function loadScript(url) {
  loadScript.cache = loadScript.cache || {};
  if (loadScript.cache[url]) return loadScript.cache[url];
  return (loadScript.cache[url] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = url; s.async = true;
    s.onload = () => res(); s.onerror = () => { delete loadScript.cache[url]; rej(new Error('组件加载失败，请检查网络后重试')); };
    document.head.appendChild(s);
  }));
}
/* month cycles 'YYYY-MM' */
function cycleOf(t) { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
function addMonths(c, n) { let [y, m] = c.split('-').map(Number); m = m - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad2(m + 1); }
function monthsBetween(a, b) { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); }
function dateInMonth(c, day) { const [y, m] = c.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return new Date(y, m - 1, Math.min(day, last)).getTime(); }
function daysUntil(t) { return Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY); }
function dueText(days) { return days < 0 ? '逾期 ' + (-days) + ' 天' : days === 0 ? '今天' : days === 1 ? '明天' : '还有 ' + days + ' 天'; }
function duePill(days, near) {
  const p = el('span', 'pill', dueText(days));
  if (days < 0) p.classList.add('late'); else if (days <= (near == null ? 3 : near)) p.classList.add('soon');
  return p;
}
function toDateInput(t) { const d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function toDTInput(t) { const d = new Date(t); return toDateInput(t) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fromDateInput(s) { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime() : null; }

/* ---------------- categories ---------------- */
const CATS = {
  food: { n: '餐饮', c: 1 }, grocery: { n: '超市日用', c: 2 }, transport: { n: '交通', c: 3 }, shopping: { n: '购物', c: 4 },
  housing: { n: '居住', c: 5 }, fun: { n: '娱乐', c: 6 }, subs: { n: '订阅会员', c: 7 }, social: { n: '人情红包', c: 8 },
  telecom: { n: '通讯缴费' }, medical: { n: '医疗' }, edu: { n: '教育' }, travel: { n: '旅行' }, insure: { n: '保险' }, life: { n: '生活服务' }, other: { n: '其他' },
  salary: { n: '工资', c: 1, inc: true }, bonus: { n: '奖金', c: 2, inc: true }, gift: { n: '红包转账', c: 3, inc: true }, refund: { n: '退款', c: 4, inc: true },
  invest: { n: '理财收益', c: 5, inc: true }, otherin: { n: '其他收入', inc: true }
};
const EXP_ORDER = ['food', 'grocery', 'transport', 'shopping', 'housing', 'fun', 'subs', 'social', 'telecom', 'medical', 'edu', 'travel', 'insure', 'life', 'other'];
const INC_ORDER = ['salary', 'bonus', 'gift', 'refund', 'invest', 'otherin'];
const catColor = (id) => (CATS[id] && CATS[id].c ? `var(--c${CATS[id].c})` : 'var(--c0)');
const KW_EXP = [
  [/房租|房东|租金|物业|水费|电费|燃气|自如|链家|贝壳|暖气/, 'housing'],
  [/中国移动|中国联通|中国电信|话费|宽带|流量|手机充值/, 'telecom'],
  [/iCloud|Apple Music|App Store|爱奇艺|腾讯视频|优酷|芒果TV|网易云音乐|QQ音乐|酷狗|Spotify|Netflix|哔哩哔哩|bilibili|大会员|ChatGPT|OpenAI|Claude|百度网盘|WPS|喜马拉雅|微信读书|自动续费|连续包月|连续包年/i, 'subs'],
  [/美团外卖|饿了么|肯德基|麦当劳|星巴克|瑞幸|喜茶|奈雪|蜜雪|茶百道|霸王茶姬|库迪|必胜客|汉堡|海底捞|火锅|烧烤|餐|饭|面馆|菜馆|酒家|食堂|小吃|咖啡|奶茶|烘焙|面包|早饭|午饭|晚饭|宵夜|外卖/, 'food'],
  [/盒马|叮咚|朴朴|美团买菜|多多买菜|超市|便利|全家|罗森|7-?11|美宜佳|永辉|沃尔玛|山姆|物美|华润万家|买菜|水果|生鲜/, 'grocery'],
  [/滴滴|高德打车|曹操|T3出行|嘀嗒|地铁|公交|铁路|12306|航空|机票|加油|中石化|中石油|停车|ETC|哈啰|青桔|单车|出租|打车/, 'transport'],
  [/携程|飞猪|去哪儿|同程|酒店|民宿|景区|门票|旅行|旅游/, 'travel'],
  [/医院|药|诊所|体检|医保|口腔|牙科|医疗/, 'medical'],
  [/课程|培训|学费|教育|书店|得到|买书/, 'edu'],
  [/保险|保费|人寿|财险/, 'insure'],
  [/电影|猫眼|淘票票|KTV|游戏|Steam|健身|演出|剧本杀|网吧/i, 'fun'],
  [/淘宝|天猫|京东|拼多多|唯品会|抖音|得物|闲鱼|苏宁|Apple|小米|华为|优衣库|ZARA|商城|网购|衣服/i, 'shopping'],
  [/会员|订阅/, 'subs'],
  [/红包|转账|亲属卡|代付|礼金|份子/, 'social'],
  [/理发|美发|美容|洗衣|家政|快递|顺丰|宠物|维修|洗车/, 'life']
];
const ALI_MAP = { '餐饮美食': 'food', '日用百货': 'grocery', '交通出行': 'transport', '爱车养车': 'transport', '服饰装扮': 'shopping', '数码电器': 'shopping', '美容美发': 'life', '母婴亲子': 'shopping', '家居家装': 'shopping', '住房物业': 'housing', '生活服务': 'life', '充值缴费': 'telecom', '医疗健康': 'medical', '教育培训': 'edu', '文化休闲': 'fun', '运动户外': 'fun', '酒店旅游': 'travel', '保险': 'insure', '转账红包': 'social', '亲友代付': 'social', '宠物': 'life', '公益捐赠': 'social' };
function mkey(x) { return String(x.name || x.note || '').replace(/[\s\d()（）\-_*#·.,，:：/]+/g, '').slice(0, 24); }
function guessCat(text, inc, extra) {
  text = text || '';
  if (inc) {
    if (extra && extra.refund) return 'refund';
    if (/退款/.test(text)) return 'refund';
    if (/工资|代发|薪/.test(text)) return 'salary';
    if (/奖金|年终|绩效/.test(text)) return 'bonus';
    if (/利息|结息|收益|分红/.test(text)) return 'invest';
    if (/红包|转账|收款/.test(text)) return 'gift';
    return 'otherin';
  }
  for (const [re, c] of KW_EXP) if (re.test(text)) return c;
  if (extra && extra.aliType && ALI_MAP[extra.aliType]) return ALI_MAP[extra.aliType];
  return 'other';
}

/* ---------------- state ---------------- */
function emptyState() { return { v: 1, sample: false, tx: [], ov: {}, anchors: [], cat: {}, rules: {}, cards: [], subs: [], subHide: [], mailSeen: [], names: {}, nameRules: {}, memos: {} }; }
function migrate(s) {
  const e = emptyState();
  for (const k in e) if (s[k] == null) s[k] = e[k];
  return s;
}
function loadState() {
  try { const raw = localStorage.getItem(LS_KEY); if (!raw) return null; const s = JSON.parse(raw); if (s && s.v === 1 && Array.isArray(s.tx)) return migrate(s); } catch (e) {}
  return null;
}
function saveState() {
  if (state.sample) return true;
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; }
  catch (e) { toast('保存到本机失败，请下载备份'); return false; }
}
function leaveSample() { if (state.sample) state = emptyState(); }
function makeSample() {
  const rnd = mulberry32(20261103);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const now = Date.now(); const start = startOfDay(now - 150 * DAY);
  const tx = []; let n = 0;
  const add = (t, src, dir, yuan, name, note, ex) => { if (t > now) return; ex = ex || {}; tx.push({ id: 'sample:' + (n++), src, t: Math.round(t), amt: Math.round(yuan * 100), dir, name, note, type: ex.type || '', status: ex.status || '', method: ex.method || '', bank: ex.bank || '' }); };
  for (let d = 0; d <= 150; d++) {
    const t0 = start + d * DAY; const dt = new Date(t0); const H = 3600e3;
    if (dt.getDate() === 10) add(t0 + 10.2 * H, 'bank', 1, 18500, '代发工资', '某某科技有限公司 工资', { bank: '中国银行' });
    if (dt.getDate() === 1) add(t0 + 9.5 * H, 'ali', -1, 4800, '房东 李先生', '房租', { method: '中国银行储蓄卡(6217)' });
    if (dt.getDate() === 15) add(t0 + 11 * H, 'wx', -1, 129, '中国移动', '话费宽带', { method: '零钱' });
    if (dt.getDate() === 6) add(t0 + 3 * H, 'wx', -1, 25, '爱奇艺', '黄金VIP 连续包月', { method: '零钱' });
    if (dt.getDate() === 12) add(t0 + 4 * H, 'ali', -1, 21, 'Apple', 'iCloud+ 200GB', { method: '余额宝' });
    if (dt.getDate() === 20) add(t0 + 5 * H, 'ali', -1, 15, '网易云音乐', '黑胶VIP', { method: '余额宝' });
    if (rnd() < 0.6) add(t0 + (8.4 + rnd()) * H, 'wx', -1, 9.9 + rnd() * 14, pick(['瑞幸咖啡', '星巴克', '便利蜂', '全家']), '早餐 / 咖啡', { method: '零钱' });
    if (rnd() < 0.85) add(t0 + (11.6 + rnd()) * H, 'wx', -1, 18 + rnd() * 32, pick(['美团外卖', '饿了么', '肯德基', '楼下面馆']), '午餐', { method: '零钱' });
    if (rnd() < 0.65) add(t0 + (18.4 + rnd() * 2) * H, 'ali', -1, 26 + rnd() * 80, pick(['盒马', '叮咚买菜', '海底捞', '美团外卖']), '晚餐 / 买菜', { method: '余额宝' });
    if (rnd() < 0.3) add(t0 + (8 + rnd() * 12) * H, 'wx', -1, 14 + rnd() * 34, '滴滴出行', '打车', { method: '零钱' });
    if (rnd() < 0.22) add(t0 + (20 + rnd() * 3) * H, 'ali', -1, 59 + rnd() * 460, pick(['淘宝', '天猫', '京东']), '网购', { method: '花呗' });
    if (rnd() < 0.08) add(t0 + (19 + rnd() * 3) * H, 'wx', -1, 45 + rnd() * 60, pick(['猫眼电影', '健身房', 'KTV']), '娱乐', { method: '零钱' });
    if (rnd() < 0.05) add(t0 + (12 + rnd() * 8) * H, 'wx', 1, pick([66, 88, 200, 520]), '微信红包', '红包', { status: '已存入零钱' });
    if (rnd() < 0.04) add(t0 + (13 + rnd() * 6) * H, 'wx', 0, pick([500, 1000, 2000]), '零钱提现', '提现到中国银行(6217)', { type: '零钱提现', status: '提现已到账' });
    if (rnd() < 0.03) add(t0 + (14 + rnd() * 6) * H, 'ali', 1, 30 + rnd() * 150, '淘宝', '退款', { status: '退款成功' });
  }
  add(start + 47 * DAY + 15 * 3600e3, 'ali', -1, 6299, 'Apple Store', '手机', { method: '中国银行储蓄卡(6217)' });
  add(start + 96 * DAY + 10 * 3600e3, 'bank', 1, 6000, '年终奖', '某某科技有限公司 奖金', { bank: '中国银行' });
  const today = new Date(now);
  const nextCycle = (day) => (today.getDate() <= day ? cycleOf(now) : addMonths(cycleOf(now), 1));
  const c1 = nextCycle(18), c2 = nextCycle(10);
  const nextOn = (day) => { const c = today.getDate() <= day ? cycleOf(now) : addMonths(cycleOf(now), 1); return toDateInput(dateInMonth(c, day)); };
  return {
    v: 1, sample: true, tx, ov: {}, anchors: [{ t: now - 60e3, v: 8642035 }], cat: {}, rules: {}, subHide: [], names: {}, nameRules: {}, memos: {},
    cards: [
      { id: 'card:s1', name: '招商银行信用卡', due: 18, stmt: 5, since: c1, paid: {}, bills: { [c1]: 328640 }, plans: [{ id: 'plan:s1', name: '手机分期', per: 52492, total: 12, start: addMonths(c1, -4) }] },
      { id: 'card:s2', name: '花呗', due: 10, stmt: 1, since: c2, paid: {}, bills: { [c2]: 124000 }, plans: [] }
    ],
    subs: [
      { id: 'sub:s1', name: '爱奇艺', amt: 2500, cycle: 'm', start: nextOn(6), method: '微信零钱' },
      { id: 'sub:s2', name: 'iCloud+', amt: 2100, cycle: 'm', start: nextOn(12), method: '支付宝' },
      { id: 'sub:s3', name: '京东 PLUS', amt: 19800, cycle: 'y', start: toDateInput(now + 41 * DAY), method: '京东白条' }
    ]
  };
}
let state = loadState() || makeSample();

/* ---------------- classification ---------------- */
const RE_PLATFORM = /财付通|微信|tenpay|支付宝|alipay|网联/i;
const RE_REPAY = /信用卡还款|还款/;
const RE_INVEST = /理财|基金|申购|认购|赎回|定期|通知存款|结构性存款|转存/;
const RE_FX = /美元|港币|港元|欧元|日元|英镑|澳元|加元|USD|HKD|EUR|JPY|GBP/;
const RE_FULLREFUND = /全额退款|退款成功|交易关闭/;
function isRefundLike(x) { return x.dir !== -1 && /退款/.test((x.status || '') + (x.note || '') + (x.type || '') + (x.name || '')); }

let derived = null;
function derive() {
  const txs = state.tx.slice().sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const auto = new Map();
  // 1) fully refunded / closed payments paired with their refund rows
  const refundPool = txs.filter((x) => (x.src === 'wx' || x.src === 'ali') && isRefundLike(x));
  const usedRefund = new Set(); const pairedPay = new Set();
  for (const x of txs) {
    if ((x.src !== 'wx' && x.src !== 'ali') || x.dir !== -1 || !RE_FULLREFUND.test(x.status || '')) continue;
    const r = refundPool.find((r) => !usedRefund.has(r.id) && r.src === x.src && r.amt === x.amt && r.t >= x.t && r.t - x.t < 180 * DAY);
    if (r) { usedRefund.add(r.id); pairedPay.add(x.id); }
  }
  // 2) bank rows that are the same money as a WeChat / Alipay row
  const platByAmt = new Map();
  for (const x of txs) if (x.src === 'wx' || x.src === 'ali') { if (!platByAmt.has(x.amt)) platByAmt.set(x.amt, []); platByAmt.get(x.amt).push(x); }
  const usedPlat = new Set(); const bankDup = new Map();
  for (const b of txs) {
    if (b.src !== 'bank' || !RE_PLATFORM.test((b.name || '') + (b.note || ''))) continue;
    let best = null, bestD = Infinity;
    for (const p of platByAmt.get(b.amt) || []) {
      if (usedPlat.has(p.id)) continue;
      const m = p.method || '';
      if (/银行|储蓄卡|信用卡/.test(m) && !/中国银行|中行/.test(m)) continue;
      const d = Math.abs(p.t - b.t);
      if (d <= 3 * DAY && d < bestD) { best = p; bestD = d; }
    }
    if (best) { usedPlat.add(best.id); bankDup.set(b.id, best); }
  }
  // 3) hand-entered records replaced by an imported one (same direction, same amount, within 2 days)
  const impByAmt = new Map();
  for (const x of txs) if (x.src !== 'manual') { if (!impByAmt.has(x.amt)) impByAmt.set(x.amt, []); impByAmt.get(x.amt).push(x); }
  const usedImp = new Set(); const manualDup = new Map(); const manualFor = new Map();
  for (const m of txs) {
    if (m.src !== 'manual') continue;
    let best = null, bestD = Infinity;
    for (const x of impByAmt.get(m.amt) || []) {
      if (usedImp.has(x.id) || x.dir !== m.dir || bankDup.has(x.id)) continue;
      const d = Math.abs(x.t - m.t);
      if (d <= 2 * DAY && d < bestD) { best = x; bestD = d; }
    }
    if (best) { usedImp.add(best.id); manualDup.set(m.id, best); manualFor.set(best.id, m); }
  }
  for (const x of txs) {
    let s = x.dir, why = '';
    const st = x.status || '';
    if (x.src === 'wx' || x.src === 'ali') {
      if (/失败|撤销|未支付|已关闭/.test(st) && !pairedPay.has(x.id)) { s = 0; why = '交易未完成'; }
      else if (x.dir === -1 && RE_FULLREFUND.test(st) && !pairedPay.has(x.id)) { s = 0; why = st.includes('关闭') ? '交易关闭' : '已退款'; }
      else if (x.dir === 0 && isRefundLike(x)) { s = 1; why = '退款'; }
      else if (x.dir === 0) { s = 0; why = '自己账户间转移'; }
    } else if (x.src === 'bank') {
      const text = (x.name || '') + ' ' + (x.note || '');
      if (RE_FX.test(text)) { s = 0; why = '外币'; }
      else if (bankDup.has(x.id)) { s = 0; why = '已在' + SRC_NAME[bankDup.get(x.id).src] + '账单里'; }
      else if (x.dir === -1 && RE_REPAY.test(text)) { s = 0; why = '还信用卡'; }
      else if (RE_INVEST.test(text) && !/结息|利息/.test(text)) { s = 0; why = '理财划转'; }
    } else if (x.src === 'manual') {
      if (manualDup.has(x.id)) { const b = manualDup.get(x.id); s = 0; why = '已在' + (b.src === 'bank' ? (b.bank || '银行卡') : SRC_NAME[b.src]) + '账单里'; }
    }
    auto.set(x.id, { s, why });
  }
  const eff = []; const all = [];
  for (const x of txs) {
    const a = auto.get(x.id);
    const o = Object.prototype.hasOwnProperty.call(state.ov, x.id) ? state.ov[x.id] : null;
    const s = o == null ? a.s : o;
    const rec = { x, s, auto: a.s, why: o == null ? a.why : '手动设置', manual: o != null, delta: s * x.amt, cat: null,
      name: displayName(x), memo: (state.memos || {})[x.id] || '' };
    if (s !== 0) rec.cat = catFor(rec, manualFor);
    all.push(rec);
    if (s !== 0) eff.push(rec);
  }
  const times = eff.map((r) => r.x.t); const pref = [0];
  for (const r of eff) pref.push(pref[pref.length - 1] + r.delta);
  const S = (t) => { let lo = 0, hi = times.length; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m; } return pref[lo]; };
  const anchors = state.anchors.slice().sort((a, b) => a.t - b.t);
  const offs = anchors.map((a) => a.v - S(a.t));
  const offAt = (t) => { if (!anchors.length) return 0; let k = 0; for (let i = 0; i < anchors.length; i++) if (anchors[i].t <= t) k = i; return offs[k]; };
  const bal = (t) => S(t) + offAt(t);
  const anchorRecs = anchors.map((a, i) => ({ anchor: a, idx: i, before: i === 0 ? null : S(a.t) + offs[i - 1] }));
  derived = { all, eff, anchors, anchorRecs, bal, S, manualFor };
  return derived;
}
/* The bill's own name stays in x.name (de-duplication and rules key on it); what the list shows can be renamed
   for one transaction (names) or for every transaction with the same original name (nameRules). */
function displayName(x) {
  const own = (state.names || {})[x.id]; if (own) return own;
  const rule = (state.nameRules || {})[mkey(x)]; if (rule) return rule;
  return x.name || x.note || '';
}
function catFor(rec, manualFor) {
  const x = rec.x; const inc = rec.s > 0;
  const ok = (c) => !!(c && CATS[c] && !!CATS[c].inc === inc);
  if (ok(state.cat[x.id])) return state.cat[x.id];
  const m = manualFor.get(x.id); if (m && ok(state.cat[m.id])) return state.cat[m.id];
  const r = state.rules[mkey(x)]; if (ok(r)) return r;
  return guessCat([rec.name !== x.name ? rec.name : '', x.name, x.note, x.src === 'ali' ? '' : x.type].join(' '), inc, { refund: rec.why === '退款' || isRefundLike(x), aliType: x.src === 'ali' ? x.type : '' });
}

