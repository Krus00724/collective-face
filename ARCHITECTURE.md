# Collective Face: architecture

## The form

Three busts stand side by side on one plain ground. Each bust is modelled in its own plasticine, with colours sampled from the reference: a dense sandy blue with fine cracks, a stretched fibrous pink full of pits, a crumbly granular green. Nothing is written on or near the sculptures, because the faces are the work.

**Colour and type.** The ground is plain white and all text is set in Michroma. To change the ground, edit `src/theme.ts` and the `--paper` token in `src/styles.css`.

**Numbers.** How many people took part is never shown, anywhere: not per bust, not in the archive, not in downloads. Contributions get a random six character code in place of a running number, since a running number would reveal the total.

## How a bust is built

Everything rests on one decision: **all shaping happens on a small control cage, and the visible surface is computed from it.**

- **Base.** `tools/bake_bust.py` starts from MakeHuman's base mesh and targets, released as CC0. It builds three young adult heads, cuts one shared bust topology with a classical curved cut, keeps eyes, teeth and tongue, and closes the cut with soft rings.
- **Faces.** The busts begin as the artist's friends. `tools/fit_faces.py` takes 478 MediaPipe landmarks from each photograph and from a render of the base head, so each landmark has a known place on the mesh. It aligns them on the inner face, then solves a smooth bend of the whole cage along the skin: a biharmonic fit with the landmarks as soft targets. Nothing is left at a hard edge, and lips and lids stay separate. Landmark depth is trusted less than position. The Child's photograph is a three quarter view, so it is read on its near side, measured from the middle of the face, and mirrored. Only the resulting shape is kept. The photographs are not stored in the work.
- **Hair and brows.** `tools/bake_hair.py` traces strands over each fitted head: a straight bob with a centre parting, a shaggy mop in chunky locks, short spiral curls. Strands fall under gravity and the head keeps them out. They are gathered into one soft volume, turned into a mesh with marching cubes, and reduced to about 28,000 vertices per bust. The brows come from the photographs as raised ridges of clay. Each hair vertex is tied to three cage vertices, leaving out the jaw, so a raised brow lifts the fringe and an open mouth does not drag the hair. At rest the skin is smooth, because the friends are young. The wrinkles come with expression. Hair is part 4 of the mesh, a little deeper in tone than the skin.
- **Cage.** About 5,600 vertices, the same topology for all three. See `src/sculpture/bust.ts`.
- **Subdivision.** Catmull-Clark turns the cage into about 90,000 vertices in a few milliseconds. See `src/sculpture/subdivide.ts`.
- **Emotions.** All 34 MakeHuman expression units ship with the work. `src/data/expressions.ts` mixes them into feelings from a wide smile to a grimace, including one sided ones. Each bust moves slowly through its own sequence.
- **Mutations.** A contribution works on the cage the way hands work on clay: swell, press a thumb in, pinch, drag, twist, push further, melt together. The cage cannot tear and every result stays smooth. See `src/sculpture/mutations.ts`.
- **Time.** Every six contributions the difference from the original fades a little and spreads to its neighbours, the mouth is pulled back towards working order, and displacement is capped. Old traces fade and merge, and the head stays a head.
- **Wrinkles.** `tools/bake_wrinkles.py` draws real anatomical strokes onto an unwrapped head: forehead lines, frown lines, crow's feet, folds from nose to mouth, lip lines, neck rings, thousands of fine crepe lines and pores. One layer is always present and depends on age. The other layer appears where the skin is actually compressed: each baked surface measures how much every vertex shrinks compared with rest, so a smile deepens the crow's feet by itself, and so does any mutation that squeezes the skin.
- **Plasticine.** `src/scene/plasticine.ts` paints seamless grain tiles on the GPU at load, sharp down to very close range. Eyes get a carved iris and pupil, as on a classical bust.
- **Rendering.** Two baked surfaces per bust sit on the GPU and a vertex shader blends them, so emotions, contributions, the archive slider and "compare with today" all use the same morph. See `src/sculpture/shaders.ts`.

This is the hybrid the brief asks for: facial analysis picks parameters, procedural geometry does the work. No image generator is involved, because none produces a production ready, cumulative, topology stable mesh.

**Voice.** A visitor can leave up to 10 seconds of voice for one bust, after a photograph or on its own. In the browser the recording is reduced to 16 kHz mono and packed as 8 bit mu-law, about 210 KB, so it fits in one database document and needs no audio hosting. It goes to `inbox/<viewer id>`, one waiting message per person, which only the owner can read. The owner's Inbox view has Listen, Approve and Reject. Approving copies the sound to `voiceAudio` and a small index entry to `voices`, with no link to the sender, and deletes the original. Rejecting deletes it. Clicking a bust plays a random approved message for that bust, without repeats until all have played, and the jaw follows the loudness of the sound. See `src/services/voice.ts`.

Access rules declared on the page: `contributions` read view, write interact; `inbox` and `removals` read and write owner, with `{self}` subtrees writable at interact; `voices` and `voiceAudio` read view, write owner.

In the artifact viewer the browser refuses the microphone, so people attach a voice memo or a video and only its sound is kept. On a site of its own the Record button appears and works directly.

**Event sourced state.** The contribution log is the source of truth and each bust is a deterministic fold over it. The same log gives the same bust on any device. A past week is the fold up to its close, so history cannot change. Withdrawing a contribution means refolding without it.

## Production system

```
Browser (Next.js, React Three Fiber)
  1. Consent, then MediaPipe Face Landmarker runs on the device
  2. Sends a contribution: figure, deformation vector, consent version
  The photograph never leaves the device
        |
API (Next.js route or small service)
  Validates and clamps, rate limits, adds to a queue
        |
Worker (one writer per figure)
  Loads latest checkpoint, applies mutation, writes new cage, notifies clients
        |
Postgres: contributions, voice queue, archive_weeks, withdrawal tokens
Object storage: cage checkpoints, GLB, previews, approved audio
        |
Weekly job, Sundays 23:59 Europe/Berlin
  Freezes all three cages, bakes GLB, renders the preview, writes the archive row
```

**Why analysis belongs on the device.** It removes the hardest problem. If photographs never reach a server there is nothing to breach, nothing to delete and no images to moderate. The trade-off is that a client can lie about its deformation vector. That matters little, since the server clamps every value, each contribution is one bounded mutation, and rate limiting handles volume. Add a bot check such as Cloudflare Turnstile. If you ever need to process on a server, use Python with MediaPipe, keep the image in memory only, and publish a deletion window.

**From landmarks to geometry.**

1. MediaPipe returns 478 landmarks. Align them to the canonical model with a rigid Procrustes fit, which removes head pose and scale.
2. Measure each region against canonical: eye width and aperture, nose length and width, mouth width, lip height, jaw taper, cheekbone width, forehead height, left to right asymmetry.
3. Use a secret random draw, weighted towards the regions that deviate most from the average, to pick one.
4. Turn the measurement into one operation with a few numbers, such as `bloat(eye, 0.31)`. Those numbers are the deformation vector.
5. Discard the landmarks. Only the vector goes to the server, and it is not stored with the region name in a form the interface can read.

The regions in `mutations.ts` are named after the same anatomy that MediaPipe reports, so step 4 is a lookup. The swap happens behind one interface, `FaceAnalyser` in `src/services/analysis.ts`.

**Scale.** The prototype refolds in the browser, which is fine for thousands of contributions. In production the worker keeps checkpoints and clients download the latest cage, about 30 KB, so load time does not grow with history.

**Weekly job detail.** Run the cron at both 21:59 and 22:59 UTC on Sundays and let the job check the local time in Europe/Berlin, or use a scheduler that understands time zones. Store each entry under a content hash and never overwrite it.

**Suggested schema.**

```sql
contributions(id uuid pk, number bigint unique, figure text, op jsonb, created_at timestamptz,
              consent_version text, withdrawal_hash text, withdrawn_at timestamptz)
archive_weeks(week int pk, closed_at timestamptz, counts jsonb, preview_url text,
              mother_glb text, father_glb text, child_glb text, cage_urls jsonb)
```

## Privacy

- Explicit consent before anything is read, recorded as a consent version with no identity attached.
- No identification, no matching, no embeddings stored.
- Photographs processed on the device and never transmitted.
- Only a bounded deformation vector and an anonymous code are kept.
- A voice can identify a person, so messages need their own consent, are reviewed before anyone hears them, and can be withdrawn with their code.
- A withdrawal token is shown once and stored as a hash.
- The archive preserves sculptures, never photographs.

Decide one thing before launch: **a withdrawn trace leaves the living sculpture, but archived weeks are immutable.** The two promises conflict, so the privacy text must state it plainly.

Facial geometry can count as biometric data under GDPR even without identification, so have a data protection lawyer review the consent text and retention policy, and run a data protection impact assessment. This document is not legal advice. The public site also needs an Impressum and a named contact.

## Studio

A page for cutting pieces out of portraits and building a new face by hand. It was brought over from a separate Next.js prototype and keeps its way of working: freehand cut, canvas, layers, PNG at 1024 by 1024, native share with a download fallback, saved mixes in the browser.

All portraits are bent onto one template built from their own landmarks, so a piece lands where it belongs on any other face. The average of the six is a sharp face. Ready made cuts (forehead, brows, eyes, nose, mouth, chin) come from the same template, and a visitor's own photo is fitted to it by tapping the two eyes and the mouth. The base face stays put until someone chooses another one, where the prototype changed it with every cut.

Two things changed, because this site is one static page with no server and promises that photographs are never uploaded or stored. The OpenAI retouch became `blendPieces` in `src/studio/mix.ts`: Laplacian pyramid blending at seven levels, in the browser. A piece keeps its features and skin texture and takes broad tone and light from the face underneath. It costs nothing and no image leaves the device, but it matches tone and cannot rebuild a face as a generative model can. The shared portrait library became a local photo that lives only in page memory. Saved mixes drop any piece of it. A shared library would need a server, consent tied to a person, withdrawal, moderation and limits, and it would need a change to the promise in About, so it is left out until that is decided.

The busts stop rendering while the Studio is open.

## Portrait library

On the public site people can give their portrait to the Studio. The site is static on Vercel. Everything that has to be kept lives in a Supabase project in Frankfurt.

**In the browser, before anything is sent.** `src/studio/prepare.ts` runs MediaPipe Face Mesh and Selfie Segmentation from the site's own files. It checks that there is one face, close enough, looking straight on, level, eyes open, with enough even light, and sharp. If not, it says what to change, one thing at a time. Then it makes the background white and bends the face onto the same template as the starting portraits with a thin plate spline, so a visitor's face fits everyone else's.

**On the server.** The Edge Function `portraits` asks for a signed in user, allows six tries a day per person and 400 a day in all, so nobody can run the bill up, and refuses a second portrait or the exact same file. Claude Haiku then answers whether the prepared photo can be used. It gets no identity task and is told not to say who anyone is. A refusal goes back as one sentence on what to change. An accepted portrait goes to the public bucket `portraits`. When the library passes 500, the oldest leave with their e-mail, except the ones marked Kept in the Inbox.

**One e-mail, one photo.** People sign in with a link. The address exists only to keep one portrait per person, and it is deleted with the portrait. An address that never led to a portrait is deleted after seven days by a scheduled job. Faces are never compared with each other.

**Traces and voices.** They moved to the same database. A code is hashed in the browser, so withdrawing works from any device. Writes are capped per minute for the whole work.

**Not done yet.** A public launch needs a custom SMTP sender, because Supabase's built-in one only reaches members of the project's team. It also needs an Impressum and a privacy text. See the list at the end of the conversation that set this up, and treat the consent wording as a draft until a lawyer has read it.

## What is real in this prototype

**Working:** three subdivided busts, 15 emotions, dynamic wrinkles, the close-up viewer, the contribution flow with consent, real cumulative geometry changes, GPU morphs, persistence, the Sunday 23:59 Berlin clock, the archive with timeline, morphing, comparison and rendered previews, GLB export of each week, voice messages with owner approval, speaking busts, withdrawal, desktop and phone layouts.

**Simulated:** the facial analysis. No face is detected. The photograph is reduced to a 48 by 48 brightness pattern, mixed with random noise, and that number seeds the mutation. The interface says so.

**Simulation:** the living family is the friends' faces plus real contributions only. The archive shows twelve simulated weeks (08.11.2026 to 24.01.2027) so there is something to see before anyone has taken part. They are generated from invented contributions on a separate run of the clay, and the interface marks them. Each real week takes the place of the simulated week with its number as it closes. Remove the simulation at launch and the archive starts empty.

**Storage in this prototype:** contributions go to the artifact's shared database for people you give access to. Anyone without write access, including visitors on a public link, keeps their contribution in their own browser. The stored fields are an id, the figure, a seed, a strength and a time.

**Missing for a public launch:** MediaPipe integration, the API and worker, Postgres and storage, the server side weekly job, bot and rate protection, legal review, and your own portrait as a starting identity.

## Blender

Each archive week downloads as GLB files with UVs, ready to open in Blender. To sculpt your own starting forms, change the base in `tools/bake_bust.py` and rerun it, keeping the vertex order of the cage.
