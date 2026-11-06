// Runs real photos through the studio's own photo step on a local copy of the public site.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const out = process.env.OUT;
const files = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.data': 'application/octet-stream', '.binarypb': 'application/octet-stream', '.tflite': 'application/octet-stream' };
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join('dist', u === '/' ? 'index.html' : u);
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(s);
}).listen(8932);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(() => { window.__DEBUG = { speed: 8 }; });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
  await p.goto('http://localhost:8932/#studio');
  await p.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 200000 });
  await p.waitForTimeout(1500);
  let n = 0;
  for (const f of files) {
    const before = await p.locator('.thumbs button').count();
    await p.setInputFiles('#studio-photo', f);
    const t0 = Date.now();
    await p.waitForFunction((c) => {
      const s = document.querySelector('#studio-status')?.textContent || '';
      return document.querySelectorAll('.thumbs button').length > c || (s && !s.startsWith('Getting')) || document.querySelector('#studio-tap');
    }, before, { timeout: 120000 });
    const count = await p.locator('.thumbs button').count();
    const status = await p.textContent('#studio-status');
    const tap = await p.locator('#studio-tap').count();
    console.log(path.basename(f), count > before ? 'ACCEPTED' : tap ? 'FELL BACK TO TAPS' : 'RETAKE: ' + status, Date.now() - t0, 'ms');
    if (count > before) {
      const src = await p.locator('.thumbs button img').last().getAttribute('src');
      fs.writeFileSync(`${out}/prepared-${n++}.jpg`, Buffer.from(src.split(',')[1], 'base64'));
    }
  }
  await b.close();
  server.close();
})().catch((e) => { console.log('FAILED', e.message.slice(0, 300)); process.exit(1); });
