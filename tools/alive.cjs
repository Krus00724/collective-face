// Checks the living busts on the public build: heads and eyes following the mouse, a press in the clay.
// node tools/alive.cjs out-prefix
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join('dist', u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(8934);
(async () => {
  const prefix = process.argv[2];
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 800, height: 520 }, deviceScaleFactor: 1 })).newPage();
  await p.addInitScript(() => { window.__DEBUG = { speed: 1 }; });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
  p.on('console', (m) => { if (/error|warn/i.test(m.type()) && /shader|WebGL|THREE/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 600)); });
  await p.goto('http://localhost:8934/');
  await p.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 200000 });
  const shot = async (name) => { await p.evaluate(() => window.__loop('never')); await p.screenshot({ path: `${prefix}-${name}.png`, timeout: 120000 }); await p.evaluate(() => window.__loop('always')); console.log(name); };
  const settle = async (x, y, ms = 9000) => { for (let i = 0; i < 6; i++) { await p.mouse.move(x + i, y); await p.waitForTimeout(ms / 6); } };
  await settle(60, 90); await shot('left-up');
  await settle(760, 400); await shot('right-down');
  await p.evaluate(() => window.__store.getState().pick('child'));
  await settle(360, 250, 9000);
  await p.mouse.down(); await p.waitForTimeout(7000); console.log(JSON.stringify(await p.evaluate(() => { const u = window.__family.engine.figures.child.uniforms; return { poke: u.uPoke.value, o: u.uPokeO.value.toArray(), d: u.uPokeD.value.toArray() }; }))); await shot('press');
  await b.close(); process.exit(0);
})();
