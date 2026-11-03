// Touch gestures on the curve (pinch, two-finger pan, double tap, scrub) and the 外观 setting.
// Run from the repo root after `python3 tools/build.py`:  node tests/e2e-zoom.js
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const R = path.join(__dirname, '..');
let failed = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) failed++; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  p.on('pageerror', (e) => { console.log('pageerror', e.message); failed++; });
  await p.route('**/*', (r) => { const u = new URL(r.request().url()); const f = path.join(R, u.pathname === '/' ? 'index.html' : u.pathname); return u.host === 'app.test' && fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' }); });
  await p.goto('http://app.test/'); await p.waitForTimeout(300);
  const box = await p.locator('#chart').boundingBox(); const y = box.y + box.height / 2;
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((x, i) => ({ x, y, id: i })) });
  const span = () => p.textContent('#qChange .span');
  const days = async () => +(await p.textContent('#listMeta')).match(/(\d+) 天/)[1];
  async function gesture(from, to, steps = 8) {
    await touch('touchStart', from);
    for (let i = 1; i <= steps; i++) await touch('touchMove', from.map((x, k) => x + (to[k] - x) * i / steps));
    await touch('touchEnd', []); await p.waitForTimeout(250);
  }
  ok(await span() === '近 1 月', 'starts on the whole month');
  const days0 = await days();

  // pinch out in the middle of the chart
  await gesture([box.x + 160, box.x + 230], [box.x + 40, box.x + 350]);
  const zoomed = await span();
  ok(zoomed !== '近 1 月' && /日/.test(zoomed), 'pinch locks a finer window: ' + zoomed);
  ok(/双击图表回到近 1 月/.test(await p.textContent('#qScrub')), 'hint says how to go back');
  const days1 = await days(); ok(days1 < days0, `ledger follows the window (${days0} → ${days1} days)`);

  // two fingers moving right together show earlier days
  await gesture([box.x + 120, box.x + 260], [box.x + 260, box.x + 400 > box.x + box.width ? box.x + box.width - 2 : box.x + 400]);
  const panned = await span(); ok(panned !== zoomed, 'two-finger pan moves the window: ' + panned);

  // one finger still scrubs
  await touch('touchStart', [box.x + 200]); await touch('touchMove', [box.x + 210]);
  ok(/\d+:\d+/.test(await p.textContent('#qLabel')), 'one finger scrubs: ' + await p.textContent('#qLabel'));
  await touch('touchEnd', []); await p.waitForTimeout(400);

  // double tap resets
  for (let i = 0; i < 2; i++) { await touch('touchStart', [box.x + 200]); await touch('touchEnd', []); await p.waitForTimeout(80); }
  await p.waitForTimeout(250);
  ok(await span() === '近 1 月', 'double tap returns to the whole month');
  ok(await days() === days0, 'ledger back to the whole month');

  // pinching all the way out ends the zoom by itself
  await gesture([box.x + 160, box.x + 230], [box.x + 60, box.x + 330]);
  await gesture([box.x + 60, box.x + 330], [box.x + 180, box.x + 210]);
  ok(await span() === '近 1 月', 'pinching back out unlocks');

  // 外观
  await p.click('#themeTabs [data-v="dark"]');
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'dark look applied');
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor); ok(bg === 'rgb(0, 0, 0)', 'page turns black: ' + bg);
  await p.reload(); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'look kept after reopening');
  ok(await p.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content) === 'black-translucent', 'status bar style matches dark');
  await p.click('#themeTabs [data-v="light"]'); await p.reload(); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content) === 'default', 'status bar style matches light');
  await p.click('#themeTabs [data-v="auto"]');
  ok(await p.evaluate(() => document.documentElement.hasAttribute('data-theme')) === false, 'auto follows the phone');
  await b.close();
  console.log(failed ? `${failed} check(s) failed` : 'all zoom checks passed'); process.exit(failed ? 1 : 0);
})();
