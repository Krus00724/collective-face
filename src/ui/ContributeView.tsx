import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { FIGURES, FIGURE_IDS } from '../data/figures';
import type { Family } from '../sculpture/family';
import { analyser, RefusedPhoto } from '../services/analysis';
import { newCode, rememberMine, type ContributionStore } from '../services/persistence';
import { VoiceNote } from './VoiceNote';
import { useStore } from '../store';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export function ContributeView({ family, store, reduced }: { family: Family; store: MutableRefObject<ContributionStore | null>; reduced: boolean }) {
  const selected = useStore((s) => s.selected);
  const phase = useStore((s) => s.phase);
  const lastCode = useStore((s) => s.lastCode);
  const canSend = useStore((s) => s.canSend);
  const pick = useStore((s) => s.pick);
  const hover = useStore((s) => s.hover);
  const go = useStore((s) => s.go);
  const set = useStore((s) => s.set);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // the visitor's image exists as an object URL only until it is analysed or replaced
  const clearPhoto = () => {
    setFile(null);
    setPreview((p) => { if (p) URL.revokeObjectURL(p); return null; });
    if (input.current) input.current.value = '';
  };
  useEffect(() => clearPhoto, []);
  useEffect(() => { setConsent(false); setError(''); clearPhoto(); }, [selected]);

  const choose = (f: File | undefined | null) => {
    if (!f) return;
    setError('');
    if (!f.type.startsWith('image/')) { setError('That file is not an image. Choose a JPEG or PNG portrait.'); return; }
    setPreview((p) => { if (p) URL.revokeObjectURL(p); return URL.createObjectURL(f); });
    setFile(f);
  };

  const submit = async () => {
    if (!file || !consent || !selected) return;
    const figure = selected;
    const photo = file;
    set({ phase: 'becoming' });
    const started = performance.now();
    let result;
    try {
      result = await analyser.analyse(photo);
    } catch (e) {
      set({ phase: 'form' });
      setError(e instanceof RefusedPhoto ? e.message : 'The photograph could not be analysed. Try another one.');
      return;
    } finally {
      clearPhoto();
      setConsent(false);
    }
    await wait(Math.max(0, (reduced ? 1200 : 3400) - (performance.now() - started)));
    const c = { id: newId(), figure, seed: result.seed, strength: result.strength, t: Date.now() };
    const code = newCode();
    await new Promise<void>((resolve) => {
      family.contribute(c, reduced ? 1800 : 9500, resolve);
      store.current?.add(c, code);
    });
    rememberMine(code, { kind: 'contribution', id: c.id });
    setNote(false);
    set({ lastCode: code, phase: 'done' });
  };

  if (!selected) {
    return (
      <section className="panel choose" aria-labelledby="choose-title">
        <h2 id="choose-title">Become part of the family</h2>
        <p className="lede">Choose a face. Leave a trace.</p>
        <ul className="names">
          {FIGURE_IDS.map((id) => (
            <li key={id}>
              <button
                id={`choose-${id}`} type="button"
                onPointerEnter={() => hover(id)} onPointerLeave={() => hover(null)} onFocus={() => hover(id)} onBlur={() => hover(null)}
                onClick={() => pick(id)}
              >{FIGURES[id].name}</button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const name = FIGURES[selected].name;

  if (phase === 'becoming') {
    return <p className="becoming" role="status">You are becoming part of something.</p>;
  }

  if (phase === 'done') {
    return (
      <section className="panel finished" role="status">
        <h2>Your contribution is now part of the collective.</h2>
        <p className="number">CONTRIBUTION #{lastCode}</p>
        <p className="small">Keep this code. It is the only way to ask for your trace to be removed.</p>
        {note ? <VoiceNote figure={selected} onClose={() => setNote(false)} /> : (
          <div className="row">
            <button id="return-family" type="button" className="action" onClick={() => go('family')}>Return to the family</button>
            {canSend && <button id="add-message" type="button" className="inline" onClick={() => setNote(true)}>Leave a message</button>}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="panel form" aria-labelledby="become-title">
      <h2 id="become-title">Become part of the family</h2>
      <p className="lede">Choose a face. Leave a trace.</p>

      <div
        className={`drop${drag ? ' over' : ''}${file ? ' filled' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files[0]); }}
      >
        {preview && <img src={preview} alt="Your chosen photograph" />}
        <label htmlFor="portrait">{file ? 'Choose a different portrait' : 'Upload a clear portrait of your own face'}</label>
        <input ref={input} id="portrait" type="file" accept="image/*" onChange={(e) => choose(e.target.files?.[0])} />
      </div>

      <label className="consent" htmlFor="consent">
        <input id="consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          This is a photograph of me and I am 16 or older. I agree that it is analysed to make one anonymous,
          permanent change to {name}, a public sculpture that anyone can see and that is archived every week.
        </span>
      </label>

      <p className="small">
        The photograph stays in this browser and is deleted as soon as the analysis ends. You will not be told what changed.
        Prototype: the facial analysis is simulated here, and your photograph only produces a random number.{' '}
        <button id="read-privacy" type="button" className="inline" onClick={() => go('about')}>How your photograph is handled</button>
      </p>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="row">
        <button id="give-face" type="button" className="action" disabled={!file || !consent} onClick={submit}>Give this face to {name}</button>
        <button id="change-figure" type="button" className="inline" onClick={() => pick(null)}>Choose another face</button>
      </div>
    </section>
  );
}
