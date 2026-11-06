// The face tools run in the visitor's browser. They are served from the site itself, so no photo and
// no request ever touches a third party. Copied from node_modules at build time, never committed.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'public', 'mediapipe');
for (const [name, skip] of [['face_mesh', /\.d\.ts$|README|package\.json/], ['selfie_segmentation', /\.d\.ts$|README|package\.json|landscape/]]) {
  const from = path.join(__dirname, '..', 'node_modules', '@mediapipe', name);
  const to = path.join(out, name);
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) if (!skip.test(f)) fs.copyFileSync(path.join(from, f), path.join(to, f));
}
console.log('mediapipe copied');
