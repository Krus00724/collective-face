const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join('/home/claude/strangers/dist', u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(8935);
(async () => {
  const out = process.argv[2], list = (process.argv[3] || 'row').split(',');
  const W = +(process.env.W || 1500), H = +(process.env.H || 1000);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: !!process.env.MOBILE, hasTouch: !!process.env.MOBILE })).newPage();
  await p.addInitScript(() => { window.__DEBUG = { high: true, speed: 1 }; });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
  await p.goto('http://localhost:8935/');
  await p.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 300000 });
  console.log('ready', await p.evaluate(() => ({ storage: window.__store.getState().storage })));
  for (const item of list) {
    const [s, ui] = item.split(':');
    await p.evaluate(() => window.__loop('always'));
    await p.evaluate((s) => {
      const st = window.__store.getState();
      if (['mother', 'father', 'child'].includes(s)) { st.go('family'); window.__store.getState().pick(s); }
      else if (s === 'row' || s === 'menu') { st.go('family'); window.__store.getState().pick(null); }
      else st.go(s);
    }, s);
    await p.waitForTimeout(+(process.env.WAIT || 16000));
    if (s === 'menu') { await p.click('#menu'); await p.waitForTimeout(1200); }
    await p.evaluate((hide) => {
      let el = document.getElementById('cap-hide');
      if (!el) { el = document.createElement('style'); el.id = 'cap-hide'; document.head.append(el); }
      el.textContent = hide ? '.bar,.caption,.closeup,.panel,.archive{display:none!important}' : '.bar,.caption,.closeup{opacity:1!important}';
      document.getElementById('root').firstElementChild?.classList.remove('undisturbed');
      window.__loop('never');
      window.__three.setDpr(2);
    }, ui !== 'ui');
    await p.waitForTimeout(600);
    await p.evaluate(() => { window.__three.advance(performance.now() / 1000); });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/${s}${ui === 'ui' ? '-ui' : ''}.png`, timeout: 180000 });
    console.log(item);
  }
  await b.close(); process.exit(0);
})().catch((e) => { console.log('FAILED', e.message.slice(0, 300)); process.exit(1); });
