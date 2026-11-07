// Phone screenshots of the public build, served locally. node tools/phone.cjs out-prefix "state,state"
// state: row | mother | father | child | contribute | archive | studio | about
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join('dist', u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(8933);
(async () => {
  const [prefix, list = 'father'] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const device = { ...devices['iPhone 15 Pro'], viewport: { width: +(process.env.W || 393), height: +(process.env.H || 852) }, deviceScaleFactor: 1 };
  const c = await b.newContext({ ...device, reducedMotion: 'reduce' });
  const p = await c.newPage();
  await p.addInitScript(() => { window.__DEBUG = { speed: 8 }; });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
  await p.goto('http://localhost:8933/');
  await p.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 200000 });
  await p.waitForTimeout(1500);
  // Safari 26 on an iPhone, which this browser cannot be
  if (process.env.GLASS) await p.evaluate(() => document.documentElement.classList.add('glass'));
  if (process.env.FRAMED) await p.evaluate(() => document.documentElement.classList.add('framed'));
  for (const s of list.split(',')) {
    await p.evaluate((s) => {
      const st = window.__store.getState();
      if (['mother', 'father', 'child'].includes(s)) { st.go('family'); window.__store.getState().pick(s); }
      else if (s === 'row') { st.go('family'); window.__store.getState().pick(null); }
      else if (s.startsWith('contribute:')) { st.go('family'); window.__store.getState().pick(s.split(':')[1]); window.__store.getState().go('contribute'); }
      else st.go(s);
    }, s);
    await p.waitForTimeout(3500);
    await p.mouse.move(200, 300); await p.mouse.move(210, 310);
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${prefix}-${s.replace(':', '_')}.png`, timeout: 60000 });
    const nav = await p.evaluate(() => { const n = document.querySelector('.nav'); const r = [...n.children].map((b) => b.getBoundingClientRect()); return { rows: new Set(r.map((x) => Math.round(x.top))).size, right: Math.max(...r.map((x) => x.right)), width: innerWidth }; });
    const wide = await p.evaluate(() => {
      const W = innerWidth;
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > W + 0.5 || r.left < -0.5)) out.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 40) + ` ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
      return { scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth, out: out.slice(0, 8) };
    });
    console.log(s, JSON.stringify(nav), JSON.stringify(wide));
  }
  await b.close();
  server.close();
})().catch((e) => { console.log('FAILED', e.message.slice(0, 300)); process.exit(1); });
