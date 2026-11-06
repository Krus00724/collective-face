# Collective Face

Interactive prototype of an evolving collective sculpture with voices. React, TypeScript, Three.js, React Three Fiber.

```
npm install
npm run dev        # local development
npm run build      # one self contained dist/index.html
```

`ARCHITECTURE.md` explains the sculpture system, the production plan and what is simulated.

- `src/sculpture` bust cage, subdivision, emotions, mutation recipes, shaders
- `src/scene` studio, plasticine, light, camera, previews
- `src/ui` the four views
- `src/services` analysis, persistence, archive clock, GLB export
- `tools/bake_bust.py` bakes the busts and emotions from MakeHuman data, `tools/bake_wrinkles.py` draws the wrinkle map (needs numpy and opencv-python). `tools/data/base.obj` is included. For the targets, clone github.com/makehumancommunity/makehuman into `tools/data/mh/repo`.
- `tools/mp/landmarks.cjs` finds face landmarks with the npm build of MediaPipe Face Mesh in headless Chromium (`npm install @mediapipe/face_mesh` in `tools/mp`). `tools/rendermap.ts` renders a head with a map from pixel to vertex. `tools/fit_faces.py` fits the busts to the photographs and `tools/bake_hair.py` sculpts the hair and brows (needs scipy, scikit-image, fast-simplification, trimesh). The photographs and landmark files stay out of the repository.

The base mesh and expression targets are MakeHuman assets, CC0. The font is Michroma, SIL Open Font License.

## Studio

The Studio page (`src/ui/StudioView.tsx`, `src/studio/mix.ts`) comes from the Next.js prototype made separately. It keeps the same way of working: pick a portrait, draw around part of a face, move it on the canvas, turn, resize and reorder the layers. The last used portrait fills what is uncovered. A finished face is a 1024 by 1024 PNG, and saved faces stay in the browser.

This site has no server, so two parts work differently. Melting the edges uses pyramid blending in the browser instead of the OpenAI image API, with no key and no cost. A visitor's own photo stays on the device instead of going into a shared library. The six starting portraits are generated. `tools/align_portraits.py` bends them from `tools/data/portraits_src` onto one template in `src/assets/portraits`, so eyes, nose and mouth sit at the same place in all of them, and writes the ready made cuts and the three fitting points to `src/studio/template.ts`. A visitor's own photo is laid over the same template with three taps. `tools/studio.cjs` walks the whole page headlessly.

## Public site

`npm run build:site` builds the public version, which Vercel runs on every push. `.env.site` holds the Supabase address and the publishable key, which are safe in a browser. The Claude key is a secret of the Edge Function `portraits` and never reaches the page. The face tools are copied from `node_modules` into `public/mediapipe` at build time and served by the site itself.

`npm run build` makes the private artifact instead, one self contained page without Supabase.

Everything else about the backend is in the Portrait library section of `ARCHITECTURE.md`.
