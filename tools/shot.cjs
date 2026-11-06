// Headless look at the build. Usage: node tools/shot.cjs out.png [w] [h] [js] [waitMs]
const { chromium } = require('playwright');
(async () => {
  const [out, w = 1440, h = 900, js = '', wait = 2500] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  await p.addInitScript((h) => { window.__DEBUG = { speed: 40, high: h.high, backdrop: h.bg || undefined }; }, { high: process.env.HIGH === '1', bg: process.env.BG });
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(m.type(), m.text().slice(0, 600)); });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto('file://' + process.cwd() + '/dist/index.html');
  await p.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 240000 });
  if (js) await p.evaluate(js);
  await p.waitForTimeout(+wait);
  const n = await p.evaluate(async () => {
    const { gl, scene, camera } = window.__three;
    window.__loop('never');
    gl.render(scene, camera);
    const url = gl.domElement.toDataURL('image/jpeg', 0.94);
    const img = new Image();
    img.src = url;
    img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0';
    await img.decode();
    gl.domElement.parentElement.parentElement.style.display = 'none';
    document.getElementById('root').prepend(img);
    return 0;
  });
  console.log('frames', n);
  await p.waitForTimeout(300);
  await p.screenshot({ path: out, timeout: 60000 });
  await b.close();
})().catch((e) => { console.log('FAILED', e.message); process.exit(1); });
