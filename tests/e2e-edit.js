// 分类 month/year stepping and renaming / memo on a transaction.
// Run from the repo root after `python3 tools/build.py`:  node tests/e2e-edit.js
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const R = path.join(__dirname, '..'); const L = path.join(R, 'node_modules');
const LIBS = { 'zip-full.min.js': '@zip.js/zip.js/dist/zip-full.min.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'pdf.min.js': 'pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': 'pdfjs-dist/build/pdf.worker.min.js' };
let failed = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', (e) => { console.log('pageerror', e.message); failed++; });
  await p.route('**/*', (r) => { const u = new URL(r.request().url());
    if (u.host === 'app.test') { const f = path.join(R, u.pathname === '/' ? 'index.html' : u.pathname); return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404 }); }
    for (const k in LIBS) if (u.href.endsWith(k)) return r.fulfill({ path: path.join(L, LIBS[k]), contentType: 'application/javascript' });
    return r.fulfill({ status: 404, body: '' }); });
  await p.goto('http://app.test/'); await p.waitForTimeout(300);

  // categories: step back month by month (sample data covers ~5 months)
  await p.click('#tabbar [data-tab="cats"]');
  ok(await p.textContent('#dcK') === '本月支出' && await p.isDisabled('#catNext'), 'starts on this month, cannot go into the future');
  const totals = [];
  for (let i = 0; i < 3; i++) { await p.click('#catPrev'); totals.push([await p.textContent('#catNow'), await p.textContent('#dcK'), await p.textContent('#dcV')]); }
  ok(totals[0][1] === '上月支出' && /月支出$/.test(totals[2][1]) && totals[2][1] !== '上月支出', 'stepping back: ' + totals.map((t) => t.join(' ')).join(' | '));
  ok(new Set(totals.map((t) => t[2])).size === 3, 'each month has its own total');
  await p.click('#catNow'); ok(await p.textContent('#dcK') === '本月支出', 'tapping the month label returns to this month');
  await p.click('#catRanges [data-r="year"]'); ok(await p.textContent('#dcK') === '今年支出', 'by year');
  await p.click('#catRanges [data-r="all"]'); ok(await p.isHidden('#catStep'), 'everything hides the stepper');
  await p.click('#catRanges [data-r="month"]');
  for (let i = 0; i < 12; i++) if (!(await p.isDisabled('#catPrev'))) await p.click('#catPrev');
  ok(await p.isDisabled('#catPrev'), 'cannot step before the first record');

  // rename every transaction with the same bill name (works on the sample data in memory)
  await p.click('#tabbar [data-tab="trend"]');
  const showAll = async () => { while (await p.isVisible('#moreBtn')) await p.click('#moreBtn'); if (await p.isVisible('#expandAll') && (await p.textContent('#expandAll')) === '全部展开') await p.click('#expandAll'); };
  await showAll();
  const before = await p.locator('#list .row', { hasText: '美团外卖' }).count();
  await p.locator('#list .row', { hasText: '美团外卖' }).first().click();
  await p.check('#txNameAll'); await p.fill('#txName', '外卖'); await p.press('#txName', 'Enter'); await p.keyboard.press('Escape');
  await showAll();
  const after = await p.locator('#list .row', { hasText: '美团外卖' }).count(); const renamed = await p.locator('#list .row-t', { hasText: /^外卖$/ }).count();
  ok(before > 1 && after === 0 && renamed === before, `同名一起改: ${before} rows renamed (${renamed} now 外卖)`);

  // rename + memo (import a real-looking file so it is saved, not sample data)
  await p.click('#tabbar [data-tab="trend"]');
  await p.click('#importBtn'); await p.setInputFiles('#fileInput', [path.join(__dirname, 'fixtures/boc.pdf')]);
  await p.click('#parseBtn'); await p.waitForFunction(() => !document.querySelector('#parseBtn .spinner'));
  await p.fill('#anchorInput', '30000'); await p.click('#saveImportBtn');
  await p.click('#filters [data-f="all"]'); await showAll();
  await p.locator('#list .row', { hasText: '房东李先生' }).click();
  await p.fill('#txName', '房租'); await p.press('#txName', 'Enter');
  await p.fill('#txMemo', '十一月'); await p.press('#txMemo', 'Enter');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  const row = await p.locator('#list .row', { hasText: '房租' }).innerText();
  ok(/房租/.test(row) && /十一月/.test(row), 'renamed with memo: ' + row.replace(/\n/g, ' | '));
  await p.reload(); await p.waitForTimeout(200); await showAll();
  ok(await p.locator('#list .row', { hasText: '房租' }).count() === 1, 'rename survives reopening');
  await p.locator('#list .row', { hasText: '房租' }).click();
  ok(/账单原名/.test(await p.textContent('#txKv')) && /房东李先生/.test(await p.textContent('#txKv')), 'sheet still shows the bill name');
  await p.fill('#txName', ''); await p.press('#txName', 'Enter'); await p.keyboard.press('Escape'); await showAll();
  ok(await p.locator('#list .row', { hasText: '房东李先生' }).count() === 1, 'clearing the name restores the bill name');
  await b.close();
  console.log(failed ? `${failed} check(s) failed` : 'all edit checks passed'); process.exit(failed ? 1 : 0);
})();
