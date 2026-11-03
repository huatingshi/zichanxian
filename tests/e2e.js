const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const L = path.join(__dirname, '..', 'node_modules');
const map = { 'zip-full.min.js': L + '/@zip.js/zip.js/dist/zip-full.min.js', 'xlsx.full.min.js': L + '/xlsx/dist/xlsx.full.min.js', 'pdf.min.js': L + '/pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': L + '/pdfjs-dist/build/pdf.worker.min.js' };
const body = fs.readFileSync('index.html', 'utf8');
const html = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + body + '</body></html>';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  p.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console', m.text()); });
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.route('**/*', r => { const u = r.request().url();
    if (u === 'http://app.test/') return r.fulfill({ contentType: 'text/html', body: html });
    for (const k in map) if (u.endsWith(k)) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(map[k]) });
    if (u.includes('fonts.googleapis.com')) return r.fulfill({ contentType: 'text/css', body: ['Regular:400','Medium:500','SemiBold:600','Bold:700'].map(w => { const [n, wt] = w.split(':'); return '@font-face{font-family:Geist;font-weight:' + wt + ';src:url(http://app.test/f/Geist-' + n + '.woff2)}'; }).join('') });
    if (u.startsWith('http://app.test/f/')) return r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(L + '/geist/dist/fonts/geist-sans/' + u.split('/f/')[1]) });
    return r.fulfill({ status: 404, body: '' }); });
  await p.goto('http://app.test/'); await p.waitForTimeout(300);
  await p.screenshot({ path: 'tests/out-s1-trend.png', fullPage: true });
  for (const t of ['cats', 'repay', 'subs']) { await p.click(`#tabbar [data-tab="${t}"]`); await p.waitForTimeout(100); await p.screenshot({ path: `s1-${t}.png`, fullPage: true }); }
  await p.click('#tabbar [data-tab="cats"]'); await p.click('#legend .row'); await p.waitForTimeout(100); await p.screenshot({ path: 'tests/out-s1-cats-sel.png', fullPage: false });
  // quick add in sample → leaves sample, prompts calibrate
  await p.click('#fab'); await p.fill('#qaAmt', '88'); await p.fill('#qaNote', '美团外卖 晚饭');
  console.log('qa auto:', await p.textContent('#qaAuto'), await p.textContent('#qaCats [aria-pressed="true"]'));
  await p.screenshot({ path: 'tests/out-s2-qa.png' });
  await p.fill('#qaTime', '2026-10-31T19:58'); await p.click('#qaSave'); await p.waitForTimeout(100);
  console.log('calib open:', await p.isVisible('#calibSheet'), await p.textContent('#calExtra'));
  await p.fill('#calInput', '30000'); await p.click('#calSave');
  // import the three fixtures
  for (const [f, pw] of [['tests/fixtures/wx.zip', '123456'], ['tests/fixtures/ali.zip', '654321'], ['tests/fixtures/boc.pdf', '']]) {
    await p.click('#tabbar [data-tab="trend"]'); await p.click('#importBtn'); await p.setInputFiles('#fileInput', [f]); await p.fill('#pwInput', pw);
    await p.click('#parseBtn'); await p.waitForFunction(() => !document.querySelector('#parseBtn .spinner'));
    await p.click('#saveImportBtn');
  }
  // add card + plan + sub
  await p.click('#tabbar [data-tab="repay"]'); await p.click('#addCardBtn'); await p.fill('#cdName', '招商银行信用卡'); await p.fill('#cdDue', String(new Date().getDate() + 2 > 28 ? 28 : new Date().getDate() + 2)); await p.fill('#cdStmt', '5'); await p.click('#cdSave');
  await p.click('#cardList button:has-text("加分期")'); await p.fill('#plName', '手机分期'); await p.fill('#plPer', '524.92'); await p.fill('#plTotal', '12'); await p.fill('#plPaid', '4'); await p.click('#plSave');
  await p.click('#cardList button:has-text("填账单金额")'); await p.fill('#billInput', '3286.40'); await p.click('#billSave');
  await p.screenshot({ path: 'tests/out-s3-repay.png', fullPage: true });
  await p.click('#cardList button:has-text("标记已还")');
  console.log('after paid:', (await p.textContent('#cardList .plan .s')));
  await p.click('#tabbar [data-tab="subs"]'); await p.click('#addSubBtn'); await p.fill('#sbName', 'iCloud+'); await p.fill('#sbAmt', '21'); await p.fill('#sbNext', '2026-11-04'); await p.click('#sbSave');
  await p.screenshot({ path: 'tests/out-s3-subs.png', fullPage: true });
  await p.click('#tabbar [data-tab="trend"]'); await p.screenshot({ path: 'tests/out-s3-trend.png', fullPage: false });
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('zichanxian.v1')));
  console.log('tx', st.tx.length, 'manual', st.tx.filter(x => x.src === 'manual').length, 'cards', st.cards.length, 'subs', st.subs.length, 'anchors', st.anchors.length);
  // check manual de-dup + categories via ledger text
  if (await p.isVisible('#expandAll')) await p.click('#expandAll');
  const rows = await p.$$eval('#list .row', rs => rs.map(r => r.innerText.replace(/\n/g, ' | ')));
  console.log(rows.slice(0, 24).join('\n'));
  await p.click('#tabbar [data-tab="cats"]'); await p.click('#catRanges [data-r="all"]');
  console.log('legend:', await p.$$eval('#legend .row', rs => rs.map(r => r.innerText.replace(/\n/g, ' '))));
  await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(100); await p.screenshot({ path: 'tests/out-s4-cats-dark.png', fullPage: false });
  await b.close();
})();
