// Walks the real interface headlessly: home, contribute with consent, archive, about, reload.
const { chromium } = require('playwright');
const SP = process.env.SP;
const [w, h, name] = [+(process.argv[2] || 1200), +(process.argv[3] || 750), process.argv[4] || 'd'];
const steps = (process.argv[5] || 'form,done,archive,about').split(',');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__DEBUG = { speed: 40 }; });
  p.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/sigmaRadians/.test(m.text()))) console.log(m.type(), m.text().slice(0, 500)); });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const load = async () => {
    await p.goto('file://' + process.cwd() + '/dist/index.html');
    await p.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 200000 });
  };
  const snap = async (file) => {
    // copy the frame next to the DOM so the page can be captured without waiting on software GL
    const restore = await p.evaluate(async () => {
      const { gl, scene, camera } = window.__three;
      window.__loop('never');
      gl.render(scene, camera);
      const img = new Image();
      img.src = gl.domElement.toDataURL('image/jpeg', 0.92);
      img.id = '__frame';
      img.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0';
      await img.decode();
      gl.domElement.parentElement.parentElement.style.visibility = 'hidden';
      document.getElementById('root').prepend(img);
      return true;
    });
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${SP}/${name}-${file}.png`, timeout: 60000 });
    await p.evaluate(() => {
      document.getElementById('__frame').remove();
      window.__three.gl.domElement.parentElement.parentElement.style.visibility = '';
      window.__loop('always');
    });
    console.log('shot', file, restore);
  };
  const settle = (ms) => p.waitForTimeout(ms);
  await load();
  for (const s of steps) {
    if (s === 'home') { await settle(2500); await snap('home'); }
    if (s === 'form') {
      await p.evaluate(() => { const s = window.__store.getState(); s.go('contribute'); s.pick('father'); });
      await settle(12000);
      await p.setInputFiles('#portrait', process.env.PORTRAIT);
      await p.check('#consent');
      await settle(800);
      await snap('form');
    }
    if (s === 'done') {
      await p.evaluate(() => { document.querySelector('#give-face').click(); });
      await p.waitForFunction(() => window.__store.getState().phase === 'done', null, { timeout: 150000 });
      console.log('code', await p.evaluate(() => window.__store.getState().lastCode), await p.evaluate(() => JSON.stringify(window.__store.getState().counts)));
      await settle(1500);
      await snap('done');
    }
    if (s === 'choose') {
      await p.evaluate(() => { window.__store.getState().go('contribute'); });
      await settle(9000);
      await snap('choose');
    }
    if (s === 'archive') {
      await p.evaluate(() => window.__store.getState().go('family'));
      await settle(300);
      await p.evaluate(() => window.__store.getState().go('archive'));
      await settle(14000);
      await p.evaluate(() => window.__store.getState().set({ archiveT: 1 }));
      await settle(6000);
      await snap('archive-early');
      await p.evaluate(() => window.__store.getState().set({ compare: true }));
      await settle(6000);
      await snap('archive-compare');
    }
    if (s === 'about') {
      await p.evaluate(() => window.__store.getState().go('about'));
      await settle(9000);
      await snap('about');
    }
    if (s === 'export') {
      await p.evaluate(() => { const w = window.__store.getState(); w.go('archive'); });
      await settle(4000);
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.evaluate(() => document.querySelector('#download-week').click())]);
      await dl.saveAs(`${SP}/week.zip`);
      console.log('downloaded', dl.suggestedFilename());
    }
    if (s === 'withdraw') {
      await p.evaluate(() => window.__store.getState().go('about'));
      await settle(1500);
      const n = await p.evaluate(() => window.__store.getState().lastCode);
      await p.fill('#withdraw-number', '#' + n);
      await p.evaluate(() => document.querySelector('#withdraw').click());
      await settle(2500);
      console.log('after withdraw', await p.evaluate(() => JSON.stringify(window.__store.getState().counts)), await p.textContent('.about form .small'));
    }
    if (s === 'voice') {
      // a real 4 second WAV goes through the whole path: attach, consent, send, review, approve, click, speak
      await p.evaluate(() => { const s = window.__store.getState(); s.go('family'); s.pick('mother'); });
      await settle(6000);
      await p.evaluate(() => document.querySelector('#leave-message').click());
      await settle(1200);
      await p.setInputFiles('#voice-file', process.env.VOICE);
      await p.waitForSelector('#voice-consent', { timeout: 30000 });
      await p.check('#voice-consent');
      await snap('voice');
      await p.evaluate(() => document.querySelector('#voice-send').click());
      await p.waitForSelector('#voice-done', { timeout: 30000 });
      console.log('sent', await p.textContent('.voice .small'));
      console.log('pending', await p.evaluate(() => window.__store.getState().pending.length), 'public', await p.evaluate(() => window.__store.getState().voices.mother.length));
      await p.evaluate(() => document.querySelector('#voice-done').click());
      await p.evaluate(() => window.__store.getState().go('review'));
      await settle(1500);
      await snap('review');
      await p.evaluate(() => document.querySelector('[id^=approve-]').click());
      await settle(1200);
      console.log('after approve pending', await p.evaluate(() => window.__store.getState().pending.length), 'public', await p.evaluate(() => window.__store.getState().voices.mother.length));
      await p.evaluate(() => { const s = window.__store.getState(); s.go('family'); s.pick('mother'); });
      await settle(2000);
      await p.evaluate(() => window.__voice.playRandom('mother'));
      await settle(2500);
      console.log('speaking', await p.evaluate(() => window.__store.getState().speaking), 'morph', await p.evaluate(() => window.__family.engine.figures.mother.uniforms.uMorph.value));
      await snap('speak');
    }
    if (s === 'reload') {
      await load();
      console.log('after reload', await p.evaluate(() => JSON.stringify(window.__store.getState().counts)));
    }
  }
  await b.close();
})().catch((e) => { console.log('FAILED', e.message); process.exit(1); });
