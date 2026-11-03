/* ---------------- parsing ---------------- */
function detectKind(bytes) {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) return 'zip';
  if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) return 'xls';
  return 'text';
}
function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch (e) { return new TextDecoder('gb18030').decode(bytes); }
}
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function excelSerialToTime(n) {
  const ms = Math.round((n - 25569) * 86400) * 1000; const d = new Date(ms);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).getTime();
}
function parseTime(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && v > 20000 && v < 80000) return excelSerialToTime(v);
  const s = String(v == null ? '' : v).trim();
  const m = /(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s) || /^(\d{4})(\d{2})(\d{2})(?:\s+(\d{1,2}):?(\d{2}):?(\d{2})?)?/.exec(s);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  return isNaN(t) ? null : t;
}
function parseAmt(v) {
  if (typeof v === 'number') return Math.round(Math.abs(v) * 100);
  const s = String(v == null ? '' : v).replace(/[¥￥,\s元]/g, '');
  const n = parseFloat(s); return isNaN(n) ? null : Math.round(Math.abs(n) * 100);
}
function cleanCell(v) { return v == null ? '' : (typeof v === 'string' ? v.replace(/[\t ]/g, ' ').trim() : v); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

function rowsToTx(rows, fileName) {
  rows = rows.map((r) => r.map(cleanCell));
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    const r = rows[i].map((c) => String(c).replace(/\s/g, ''));
    if (r.some((c) => /^交易(创建)?时间$|^付款时间$/.test(c)) && r.some((c) => /金额/.test(c))) { hi = i; break; }
  }
  if (hi < 0) throw new Error('没找到账单表头（交易时间、金额）。这个文件可能不是微信或支付宝导出的账单。');
  const head = rows[hi].map((c) => String(c).replace(/\s/g, ''));
  const col = (...names) => { for (const n of names) { const i = head.findIndex((h) => h === n); if (i >= 0) return i; } for (const n of names) { const i = head.findIndex((h) => h.includes(n)); if (i >= 0) return i; } return -1; };
  const isWx = head.includes('交易单号') || head.includes('当前状态') || head.includes('支付方式');
  const src = isWx ? 'wx' : 'ali';
  const c = isWx ? {
    t: col('交易时间'), type: col('交易类型'), name: col('交易对方'), note: col('商品'), io: col('收/支'), amt: col('金额(元)', '金额'),
    method: col('支付方式'), status: col('当前状态'), id: col('交易单号')
  } : {
    t: col('交易时间', '交易创建时间', '付款时间'), type: col('交易分类', '类型'), name: col('交易对方'), note: col('商品说明', '商品名称'), io: col('收/支'),
    amt: col('金额', '金额（元）', '金额(元)'), method: col('收/付款方式'), status: col('交易状态'), id: col('交易订单号', '交易号')
  };
  if (c.t < 0 || c.amt < 0) throw new Error('账单表头缺少交易时间或金额列。');
  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]; const g = (k) => (c[k] >= 0 ? r[c[k]] : '');
    const t = parseTime(g('t')); const amt = parseAmt(g('amt'));
    if (t == null || amt == null) continue;
    const io = String(g('io'));
    const dir = /支出/.test(io) ? -1 : /收入/.test(io) ? 1 : 0;
    let id = String(g('id') || '').trim();
    const x = { src, t, amt, dir, name: String(g('name') || ''), note: String(g('note') || ''), type: String(g('type') || ''), status: String(g('status') || ''), method: String(g('method') || '') };
    if (x.name === '/') x.name = ''; if (x.note === '/') x.note = ''; if (x.method === '/') x.method = '';
    x.id = src + ':' + (id || hashStr([t, amt, dir, x.name, x.note].join('|')));
    out.push(x);
  }
  return { src, tx: out };
}

async function parsePdf(bytes, password) {
  await loadScript(LIBS.pdf);
  const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
  let doc;
  try { doc = await lib.getDocument({ data: bytes, password: password || undefined, isEvalSupported: false, disableFontFace: true }).promise; }
  catch (e) {
    if (e && e.name === 'PasswordException') throw new Error(password ? 'PDF 密码不对。' : '这个 PDF 有密码，请在下面填写密码后再解析。');
    throw new Error('PDF 打不开：' + (e && e.message || e));
  }
  const lines = []; let fullText = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p); const tc = await page.getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.transform[3]) || 10 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const pl = [];
    for (const it of items) {
      const L = pl.find((l) => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.45));
      if (L) L.items.push(it); else pl.push({ y: it.y, items: [it] });
    }
    pl.sort((a, b) => b.y - a.y);
    for (const l of pl) {
      l.items.sort((a, b) => a.x - b.x);
      let s = '', end = null;
      for (const it of l.items) { if (end != null && it.x - end > it.h * 0.3) s += ' '; s += it.s; end = it.x + it.w; }
      lines.push(s.replace(/\s+/g, ' ').trim()); fullText += s + '\n';
    }
  }
  const bank = (/中国银行|BANK OF CHINA/i.test(fullText) && '中国银行') || (fullText.match(/(\S{2,6}银行)/) || [])[1] || '银行卡';
  const RE_DATE = /^(\d{4})[-\/.年]?(\d{2})[-\/.月]?(\d{2})日?(?=\s|$|\d{2}:)/;
  const RE_MONEY = /(^|\s)(-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2})(?=\s|$)/g;
  const recs = []; let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/第\s*\d+\s*页|共\s*\d+\s*页|^\d+\s*\/\s*\d+$/.test(line) || (/日期/.test(line) && /金额|余额/.test(line))) { cur = null; continue; }
    const dm = RE_DATE.exec(line);
    if (dm) {
      let rest = line.slice(dm[0].length).trim();
      let hh = 0, mi = 0, ss = 0;
      const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(rest);
      if (tm) { hh = +tm[1]; mi = +tm[2]; ss = +(tm[3] || 0); rest = rest.slice(tm[0].length).trim(); }
      const money = []; let mm; RE_MONEY.lastIndex = 0;
      while ((mm = RE_MONEY.exec(rest))) money.push(mm[2]);
      if (!money.length) continue;
      const text = rest.replace(RE_MONEY, ' ').replace(/人民币|CNY|RMB|钞|汇/g, ' ').replace(/\s+/g, ' ').trim();
      cur = { t: new Date(+dm[1], +dm[2] - 1, +dm[3], hh, mi, ss).getTime(), rawAmt: money[0], rawBal: money[1] != null ? money[1] : null, text, fx: RE_FX.test(rest) };
      recs.push(cur);
    } else if (cur && !RE_MONEY.test(line)) {
      cur.text = (cur.text + ' ' + line).trim();
    }
    RE_MONEY.lastIndex = 0;
  }
  if (!recs.length) throw new Error('没在 PDF 里找到交易明细。如果它是扫描件或格式特殊，把一页截图（打码）发给我来适配。');
  const num = (s) => Math.round(parseFloat(String(s).replace(/,/g, '')) * 100);
  const signed = recs.some((r) => /^-/.test(r.rawAmt));
  for (const r of recs) { r.amt = Math.abs(num(r.rawAmt)); r.bal = r.rawBal != null ? num(r.rawBal) : null; r.dir = signed ? (/^-/.test(r.rawAmt) ? -1 : 1) : 0; }
  if (!signed) {
    // infer direction from running balance, in whichever order the statement is sorted
    const tryOrder = (arr) => { let hits = 0; const dirs = new Array(arr.length).fill(0); for (let i = 1; i < arr.length; i++) { const p = arr[i - 1], q = arr[i]; if (p.bal == null || q.bal == null) continue; if (Math.abs(p.bal + q.amt - q.bal) <= 1) { dirs[i] = 1; hits++; } else if (Math.abs(p.bal - q.amt - q.bal) <= 1) { dirs[i] = -1; hits++; } } return { hits, dirs }; };
    const asc = tryOrder(recs); const rev = recs.slice().reverse(); const desc = tryOrder(rev);
    if (desc.hits > asc.hits) rev.forEach((r, i) => { r.dir = desc.dirs[i]; }); else recs.forEach((r, i) => { r.dir = asc.dirs[i]; });
    for (const r of recs) if (!r.dir) r.dir = /工资|代发|利息|结息|退款|转入|存入|收入|入账|奖金/.test(r.text) ? 1 : -1;
  }
  const seen = new Map(); const out = [];
  for (const r of recs) {
    let key = 'bank:' + r.t + ':' + (r.dir * r.amt) + ':' + (r.bal == null ? '' : r.bal);
    const n = (seen.get(key) || 0) + 1; seen.set(key, n); if (n > 1) key += '#' + n;
    const name = r.text.length > 40 ? r.text.slice(0, 40) + '…' : r.text;
    out.push({ id: key, src: 'bank', bank, t: r.t, amt: r.amt, dir: r.dir, name: name || bank, note: r.text, type: '', status: '', method: '', bal: r.bal, fx: r.fx || undefined });
  }
  for (const x of out) if (x.fx) { x.note = (x.note + ' 外币').trim(); delete x.fx; }
  return { src: 'bank', bank, tx: out };
}

async function parseBytes(bytes, name, password, depth) {
  const kind = detectKind(bytes);
  if (kind === 'pdf') return [await parsePdf(bytes, password)];
  if (kind === 'text') return [rowsToTx(parseCSV(decodeText(bytes)), name)];
  if (kind === 'xls') { await loadScript(LIBS.xlsx); return [sheetToTx(bytes, name)]; }
  // zip: either an .xlsx workbook or an archive
  await loadScript(LIBS.zip);
  const Z = window.zip; Z.configure({ useWebWorkers: false });
  const reader = new Z.ZipReader(new Z.Uint8ArrayReader(bytes), { password: password || undefined });
  let entries;
  try { entries = await reader.getEntries({ filenameEncoding: 'gb18030' }); }
  catch (e) { throw new Error('压缩包打不开：' + (e && e.message || e)); }
  if (entries.some((e) => e.filename === '[Content_Types].xml')) { await reader.close(); await loadScript(LIBS.xlsx); return [sheetToTx(bytes, name)]; }
  if (depth > 2) throw new Error('压缩包嵌套太深。');
  const results = [];
  for (const e of entries) {
    if (e.directory) continue;
    if (/(^|\/)(__MACOSX|\.)/.test(e.filename)) continue;
    if (e.encrypted && !password) throw new Error('压缩包有密码，请在下面填写解压密码后再解析。');
    let data;
    try { data = await e.getData(new Z.Uint8ArrayWriter(), { password: password || undefined }); }
    catch (er) { const m = String(er && er.message || er); if (/password/i.test(m)) throw new Error('解压密码不对。'); throw new Error('解压失败：' + m); }
    const sub = await parseBytes(data, e.filename, password, depth + 1);
    for (const s of sub) { s.inner = e.filename; results.push(s); }
  }
  await reader.close();
  if (!results.length) throw new Error('压缩包里没有账单文件。');
  return results;
}
function sheetToTx(bytes, name) {
  const wb = window.XLSX.read(bytes, { type: 'array', cellDates: false });
  let lastErr = null;
  for (const sn of wb.SheetNames) {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' });
    try { return rowsToTx(rows, name); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('表格里没有账单。');
}


