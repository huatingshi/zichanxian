// End-to-end test of the GitHub Pages build (index.html): import with per-file passwords, de-duplication,
// categories, repayments, subscriptions, and mail sync against tests/fake_mail_server.py.
// Run from the repo root after `python3 tools/build.py`:  node tests/e2e.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const R = path.join(__dirname, '..'); const L = path.join(R, 'node_modules');
const LIBS = { 'zip-full.min.js': '@zip.js/zip.js/dist/zip-full.min.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'pdf.min.js': 'pdfjs-dist/build/pdf.min.js', 'pdf.worker.min.js': 'pdfjs-dist/build/pdf.worker.min.js' };
let failed = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };
(async () => {
  const mail = spawn('python3', [path.join(__dirname, 'fake_mail_server.py'), 'http://app.test'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const port = await new Promise((res) => mail.stdout.once('data', (d) => res(String(d).trim())));
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', (e) => { console.log('pageerror', e.message); failed++; });
  await p.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.host === 'app.test') { const f = path.join(R, u.pathname === '/' ? 'index.html' : u.pathname); return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404 }); }
    if (u.host === 'bills.test') return r.fulfill({ response: await r.fetch({ url: `http://127.0.0.1:${port}${u.pathname}` }) });
    for (const k in LIBS) if (u.href.endsWith(k)) return r.fulfill({ path: path.join(L, LIBS[k]), contentType: 'application/javascript' });
    return r.fulfill({ status: 404, body: '' });
  });
  await p.goto('http://app.test/'); await p.waitForTimeout(300);

  // 1) two password-protected zips with different passwords in one import
  await p.click('#importBtn');
  await p.setInputFiles('#fileInput', [path.join(__dirname, 'fixtures/wx.zip'), path.join(__dirname, 'fixtures/ali.zip')]);
  await p.click('#parseBtn'); await p.waitForFunction(() => !document.querySelector('#parseBtn .spinner'));
  ok(await p.locator('#fileList input').count() === 2, 'each locked zip gets its own password box');
  await p.locator('#fileList input').nth(0).fill('123456'); await p.locator('#fileList input').nth(1).fill('654321');
  await p.click('#parseBtn'); await p.waitForFunction(() => !document.querySelector('#parseBtn .spinner'));
  const lines = await p.locator('#fileList .ok').allTextContents();
  ok(lines.length === 2 && /微信.*新增 6 笔/.test(lines[0]) && /支付宝.*新增 6 笔/.test(lines[1]), 'both zips parsed: ' + lines.join(' / '));
  await p.fill('#anchorInput', '30000'); await p.click('#saveImportBtn');

  // 2) mail sync: connect, fetch, the already-imported zips come back but are de-duplicated; the bank PDF is new
  await p.click('#mailRow'); await p.fill('#mlUrl', 'bills.test'); await p.fill('#mlToken', 'wrong-token-wrong-token-wrong');
  await p.click('#mlSave'); await p.waitForFunction(() => !/正在连接/.test(document.querySelector('#mlStatus').textContent));
  ok(/口令不对/.test(await p.textContent('#mlStatus')), 'wrong token is reported: ' + await p.textContent('#mlStatus'));
  await p.fill('#mlToken', 't'.repeat(32)); await p.click('#mlSave'); await p.waitForFunction(() => /连接成功|错误|连不上/.test(document.querySelector('#mlStatus').textContent));
  ok(/连接成功.*3 个账单附件/.test(await p.textContent('#mlStatus')), 'connects: ' + await p.textContent('#mlStatus'));
  await p.keyboard.press('Escape');
  await p.click('#importBtn'); ok(await p.isVisible('#mailFetchBtn'), '从邮箱获取 shows once connected');
  await p.click('#mailFetchBtn'); await p.waitForFunction(() => !document.querySelector('#mailFetchBtn .spinner'));
  ok(await p.locator('#fileList .fileres').count() === 3, 'three attachments fetched from the mailbox');
  await p.click('#parseBtn'); await p.waitForFunction(() => !document.querySelector('#parseBtn .spinner'));
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  const inputs = p.locator('#fileList input'); ok(await inputs.count() === 2, 'the two zips ask for passwords, the PDF parses');
  for (const box of await p.locator('#fileList .fileres:has(input)').all()) await box.locator('input').fill(/支付宝/.test(await box.locator('.fn').textContent()) ? '654321' : '123456');
  await p.click('#parseBtn'); await p.waitForFunction(() => !document.querySelector('#parseBtn .spinner'));
  const l2 = await p.locator('#fileList .ok').allTextContents();
  ok(l2.some((t) => /中国银行.*新增 7 笔/.test(t)) && l2.filter((t) => /新增 0 笔/.test(t)).length === 2, 'mail bills de-duplicated: ' + l2.join(' / '));
  await p.click('#saveImportBtn');
  await p.click('#importBtn'); await p.click('#mailFetchBtn'); await p.waitForFunction(() => !document.querySelector('#mailFetchBtn .spinner'));
  ok(await p.locator('#fileList .fileres').count() === 0, 'second fetch finds nothing new');
  await p.keyboard.press('Escape');

  // 2b) a bank PDF laid out differently (row numbers, slashed dates, +/- amounts)
  await p.click('#importBtn'); await p.setInputFiles('#fileInput', [path.join(__dirname, 'fixtures/boc-variant.pdf')]);
  await p.click('#parseBtn'); await p.waitForFunction(() => !document.querySelector('#parseBtn .spinner'));
  ok(/中国银行.*共 3 笔/.test(await p.textContent('#fileList')), 'variant bank PDF parsed: ' + await p.textContent('#fileList .fileres'));
  await p.keyboard.press('Escape');

  // 3) classification of the combined data
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('zichanxian.v1')));
  ok(st.tx.length === 19 && st.mailSeen.length === 3, `stored ${st.tx.length} tx, ${st.mailSeen.length} mail attachments marked seen`);
  ok(!JSON.stringify(st).includes('t'.repeat(32)), 'access token is not part of the backup data');
  while (await p.isVisible('#moreBtn')) await p.click('#moreBtn');
  if (await p.isVisible('#expandAll')) await p.click('#expandAll');
  const rows = await p.$$eval('#list .row', (rs) => rs.map((r) => r.innerText.replace(/\n/g, ' | ')));
  ok(rows.some((r) => /财付通-美团.*已在微信账单里/.test(r)), 'bank row duplicated in WeChat is excluded');
  ok(rows.some((r) => /信用卡还款.*还信用卡/.test(r)), 'credit card repayment is excluded');
  ok(rows.some((r) => /淘宝店A.*购物.*−199\.00/.test(r)) && rows.some((r) => /淘宝店A.*退款.*\+199\.00/.test(r)), 'closed Alipay order and its refund both count');
  await b.close(); mail.kill();
  console.log(failed ? `${failed} check(s) failed` : 'all e2e checks passed'); process.exit(failed ? 1 : 0);
})();
