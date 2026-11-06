// Stills of the family with reduced motion, so faces hold still. node tools/look.cjs prefix w h "state,state"
// state: row | mother | father | child | mother:scream | week:11
const { chromium } = require('playwright');
(async () => {
  const [prefix, w = 1280, h = 800, list = 'row'] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const c = await b.newContext({ viewport: { width: +w, height: +h }, reducedMotion: 'reduce' });
  const p = await c.newPage();
  await p.addInitScript((high) => { window.__DEBUG = { speed: 8, high }; }, process.env.HIGH === '1');
  p.on('console', (m) => { if (m.type() === 'error') console.log(m.text().slice(0, 400)); });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto('file://' + process.cwd() + '/dist/index.html');
  await p.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 280000 });
  await p.waitForTimeout(1500);
  for (const s of list.split(',')) {
    const [who, mood] = s.split(':');
    const hit = await p.evaluate(async ({ who, mood }) => {
      const st = window.__store.getState();
      if (who === 'week') { st.go('archive'); window.__store.getState().set({ archiveT: +mood }); return; }
      if (st.view !== 'family') st.go('family');
      window.__store.getState().pick(who === 'row' ? null : who);
      if (mood && window.__family) {
        const f = window.__family;
        const rt = f.engine.figures[who];
        const state = { ...f.shown[who], key: 'look:' + mood, emotion: mood };
        rt.arrange(state, state);
        f.shown[who] = state;
      }
    }, { who, mood });
    await p.waitForTimeout(4500);
    const url = await p.evaluate(() => { const { gl, scene, camera } = window.__three; gl.render(scene, camera); return gl.domElement.toDataURL('image/jpeg', 0.92); });
    require('fs').writeFileSync(`${prefix}-${s.replace(/[: ]/g, '_')}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
    console.log('ok', s);
  }
  await b.close();
})().catch((e) => { console.log('FAILED', e.message); process.exit(1); });
