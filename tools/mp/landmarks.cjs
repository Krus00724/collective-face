// Runs MediaPipe Face Mesh (npm build, wasm, local) over images. Usage: node landmarks.cjs out.json a.jpg b.png ...
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [out, ...files] = process.argv.slice(2);
const root = path.join(__dirname, 'node_modules/@mediapipe/face_mesh');
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.binarypb': 'application/octet-stream', '.tflite': 'application/octet-stream', '.html': 'text/html' };
const server = http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end('<canvas id=c></canvas><script src="/m/face_mesh.js"></script>'); }
  const f = u.startsWith('/m/') ? path.join(root, u.slice(3)) : u.startsWith('/img/') ? files[+u.slice(5)] : null;
  if (!f || !fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': types[path.extname(f)] || 'image/png' });
  fs.createReadStream(f).pipe(s);
}).listen(8931);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 200)));
  await p.goto('http://localhost:8931/');
  const res = await p.evaluate(async (n) => {
    const fm = new FaceMesh({ locateFile: (f) => '/m/' + f });
    fm.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.2, minTrackingConfidence: 0.2, selfieMode: false });
    let resolve;
    fm.onResults((r) => resolve(r.multiFaceLandmarks && r.multiFaceLandmarks[0] ? r.multiFaceLandmarks[0].map((l) => [l.x, l.y, l.z]) : null));
    const out = [];
    for (let i = 0; i < n; i++) {
      const img = new Image();
      img.src = '/img/' + i;
      await img.decode();
      // keep the short side workable; detection runs on a downscaled copy anyway
      const done = new Promise((r) => { resolve = r; });
      await fm.send({ image: img });
      const l = await done;
      out.push({ w: img.naturalWidth, h: img.naturalHeight, landmarks: l });
    }
    return out;
  }, files.length);
  fs.writeFileSync(out, JSON.stringify(res));
  console.log(res.map((r) => [r.w, r.h, r.landmarks ? r.landmarks.length : 'NO FACE']));
  await b.close();
  server.close();
})().catch((e) => { console.log('FAILED', e.message); process.exit(1); });
