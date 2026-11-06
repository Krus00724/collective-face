import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { blendPieces, centerOf, FEATHER, fitPhoto, flatten, ownPhoto, roundedOutline, toPng, type Piece, type Point } from '../studio/mix';
import { loadLibrary, remote } from '../services/remote';
import { PORTRAITS, type Portrait } from '../studio/portraits';
import { prepare, Retake } from '../studio/prepare';
import { CUTS } from '../studio/template';
import { useStore } from '../store';
import { LibraryPanel } from './LibraryPanel';

interface Work { id: string; name: string; pieces: Piece[]; base?: string }

const TAPS = ['Tap the eye on the left.', 'Tap the eye on the right.', 'Tap the middle of the mouth.'];

const KEY = 'collective-face.studio.v1';
const trail = (path: Point[]) => path.map(({ x, y }) => `${x},${y}`).join(' ');
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

function readWorks(): Work[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Work[]) : [];
  } catch {
    return [];
  }
}

function coordinates(event: PointerEvent<SVGSVGElement>): Point {
  const point = event.currentTarget.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const { x, y } = point.matrixTransform(event.currentTarget.getScreenCTM()!.inverse());
  return { x, y };
}

async function hand(blob: Blob, filename: string) {
  const claude = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  const downloads = claude?.use ? ((await claude.use('downloads').catch(() => null)) as { save(r: { filename: string; data: Blob }): Promise<unknown> } | null) : null;
  if (downloads) {
    await downloads.save({ filename, data: blob });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Cut pieces out of portraits by hand and put one new face together. */
export function StudioView() {
  const [own, setOwn] = useState<Portrait[]>([]);
  const library = useStore((state) => state.library);
  const open_ = useStore((state) => state.libraryOpen);
  const set = useStore((state) => state.set);
  const all = useMemo(() => [...PORTRAITS, ...library, ...own], [library, own]);
  const sources = useMemo(() => new Map(all.map((p) => [p.id, p.src])), [all]);
  const [portrait, setPortrait] = useState('1');
  const [outline, setOutline] = useState<Point[]>([]);
  const drawing = useRef<{ pointer: number; path: Point[] } | null>(null);
  const drag = useRef<{ id: string; pointer: number; offset: Point } | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [selected, select] = useState<string | null>(null);
  const [workId, setWorkId] = useState<string | null>(null);
  const [name, setName] = useState('Untitled face');
  const [saved, setSaved] = useState<Work[]>(readWorks);
  const [base, setBase] = useState('1');
  /** A photo of your own, waiting to be laid over the template. */
  const [fitting, setFitting] = useState<{ src: string; taps: Point[] } | null>(null);
  const [status, setStatus] = useState('');
  const [blended, setBlended] = useState<{ url: string; pieces: Piece[] } | null>(null);
  const [showBlend, setShowBlend] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = pieces.find((p) => p.id === selected);
  const preview = showBlend && blended?.pieces === pieces ? blended.url : null;
  const named = (id: string) => (id.startsWith('own') ? 'your photo' : id.startsWith('lib') ? 'a visitor' : `portrait ${id}`);
  const title = (p: Piece) => (p.label ? `${p.label}, ${named(p.portrait)}` : `Piece of ${named(p.portrait)}`);

  useEffect(() => () => { if (blended) URL.revokeObjectURL(blended.url); }, [blended]);
  useEffect(() => { loadLibrary(); }, []);

  const update = (id: string, changes: Partial<Piece>) => {
    setPieces((list) => list.map((p) => (p.id === id ? { ...p, ...changes } : p)));
    setStatus('');
  };

  const beginCut = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || drawing.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const path = [coordinates(event)];
    drawing.current = { pointer: event.pointerId, path };
    setOutline(path);
  };

  const trace = (event: PointerEvent<SVGSVGElement>) => {
    const current = drawing.current;
    if (!current || current.pointer !== event.pointerId) return;
    const point = coordinates(event);
    const last = current.path[current.path.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) < 2) return;
    current.path = [...current.path, { x: Math.max(0, Math.min(360, point.x)), y: Math.max(0, Math.min(360, point.y)) }];
    setOutline(current.path);
  };

  const finishCut = (event: PointerEvent<SVGSVGElement>) => {
    const current = drawing.current;
    if (!current || current.pointer !== event.pointerId) return;
    drawing.current = null;
    setOutline([]);
    if (event.type !== 'pointerup' || current.path.length < 3) return;
    const area = current.path.reduce((sum, p, i) => {
      const n = current.path[(i + 1) % current.path.length];
      return sum + p.x * n.y - p.y * n.x;
    }, 0);
    if (Math.abs(area) < 100) {
      setStatus('Draw around a larger part of the face.');
      return;
    }
    place(current.path);
  };

  const place = (shape: Point[], label?: string) => {
    const id = uid();
    setPieces((list) => [...list, { id, portrait, outline: shape, x: 0, y: 0, rotation: 0, scale: 1, label }]);
    select(id);
    setStatus('');
  };

  const tap = async (event: PointerEvent<SVGSVGElement>) => {
    if (!fitting) return;
    const taps = [...fitting.taps, coordinates(event)];
    if (taps.length < TAPS.length) {
      setFitting({ ...fitting, taps });
      return;
    }
    try {
      addPortrait(await fitPhoto(fitting.src, taps));
      setFitting(null);
    } catch (error) {
      setFitting({ ...fitting, taps: [] });
      setStatus((error as Error).message);
    }
  };

  const addPortrait = (src: string) => {
    const id = `own-${uid()}`;
    setOwn((list) => [...list, { id, src, own: true }]);
    setPortrait(id);
    setStatus('');
  };

  const reorder = (direction: number) => {
    if (!active) return;
    const i = pieces.indexOf(active);
    const t = i + direction;
    if (t < 0 || t >= pieces.length) return;
    const next = [...pieces];
    [next[i], next[t]] = [next[t], next[i]];
    setPieces(next);
    setStatus('');
  };

  const blend = async () => {
    if (!pieces.length || busy) return;
    setBusy(true);
    setStatus('Melting the pieces into one face');
    try {
      const canvas = await blendPieces(base, pieces, sources);
      setBlended({ url: URL.createObjectURL(await toPng(canvas)), pieces });
      setShowBlend(true);
      setStatus('');
    } catch {
      setStatus('The edges could not be melted. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const finished = async () => {
    if (preview) return (await fetch(preview)).blob();
    return toPng(await flatten(base, pieces, sources));
  };

  const deliver = async (share: boolean) => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      const blob = await finished();
      const filename = 'collective-face.png';
      const file = new File([blob], filename, { type: 'image/png' });
      if (share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Collective Face' });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
      await hand(blob, filename);
      if (share) setStatus('Saved as a PNG. Add it to Instagram, Facebook or TikTok from your device.');
    } catch (error) {
      const declined = (error as { code?: string }).code === 'declined';
      setStatus(declined ? '' : 'The picture could not be prepared. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const id = workId ?? uid();
    const title = name.trim() || 'Untitled face';
    const keep = pieces.filter((p) => !p.portrait.startsWith('own'));
    const left = base.startsWith('own') ? '1' : base;
    const next = [{ id, name: title, pieces: keep, base: left }, ...saved.filter((w) => w.id !== id)];
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setWorkId(id);
      setName(title);
      setSaved(next);
      setStatus(keep.length < pieces.length ? 'Saved in this browser, without the pieces of your own photo.' : 'Saved in this browser.');
    } catch {
      setStatus('This browser would not keep the face. Download it instead.');
    }
  };

  const open = (work?: Work) => {
    const known = work?.pieces.filter((p) => sources.has(p.portrait)) ?? [];
    setWorkId(work?.id ?? null);
    setName(work?.name ?? 'Untitled face');
    setPieces(known);
    setBase(work?.base && sources.has(work.base) ? work.base : '1');
    select(null);
    setStatus(known.length < (work?.pieces.length ?? 0) ? 'Some pieces are gone, because their portraits have left the library.' : '');
  };

  const addOwn = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (remote) {
        setStatus('Getting your photo ready, on your device');
        try {
          addPortrait(await prepare(file));
          return;
        } catch (error) {
          if (error instanceof Retake) { setStatus(error.message); return; }
        }
      }
      setFitting({ src: await ownPhoto(file), taps: [] });
      setStatus('');
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const source = fitting?.src ?? sources.get(portrait)!;

  return (
    <section className="studio" aria-labelledby="studio-title">
      <h2 id="studio-title" className="sr">Studio</h2>
      <div className="studio-grid">
        <div className="studio-side">
          <div className="thumbs">
            {all.map((p, i) => (
              <button key={p.id} id={`portrait-${i + 1}`} type="button" aria-pressed={p.id === portrait} aria-label={named(p.id)} onClick={() => { setPortrait(p.id); setFitting(null); }}>
                <img src={p.src} alt="" />
              </button>
            ))}
          </div>
          <svg
            className="cut" viewBox="0 0 360 360" role="img" aria-label={fitting ? TAPS[fitting.taps.length] : 'Draw around part of this face'}
            onPointerDown={fitting ? tap : beginCut} onPointerMove={fitting ? undefined : trace} onPointerUp={fitting ? undefined : finishCut} onPointerCancel={fitting ? undefined : finishCut} onLostPointerCapture={fitting ? undefined : finishCut}
          >
            <image href={source} width="360" height="360" preserveAspectRatio="xMidYMid slice" />
            <polygon points={trail(outline)} fill="#cd256f30" stroke="#cd256f" strokeWidth="2" strokeDasharray="5 3" />
            {fitting?.taps.map((t, i) => <circle key={i} cx={t.x} cy={t.y} r="5" fill="none" stroke="#cd256f" strokeWidth="2" />)}
          </svg>
          {fitting ? (
            <>
              <p id="studio-tap" className="small">{TAPS[fitting.taps.length]} Then this face lines up with the others.</p>
              <div className="row">
                <button id="studio-skip" type="button" className="inline" onClick={() => { addPortrait(fitting.src); setFitting(null); }}>Use it as it is</button>
              </div>
            </>
          ) : (
            <>
              <div className="row cuts">
                {Object.keys(CUTS).map((name) => (
                  <button key={name} id={`cut-${name}`} type="button" className="inline" onClick={() => place(CUTS[name], name)}>{name}</button>
                ))}
              </div>
              <p className="small">Take a part of this face, or draw around any part by hand. It lands where it belongs on the face you are making.</p>
              <div className="row">
                {portrait !== base && <button id="studio-base" type="button" className="inline" onClick={() => { setBase(portrait); setStatus(''); }}>Start from this face</button>}
                <label className="inline picker" htmlFor="studio-photo">Use your own photo</label>
                <input id="studio-photo" className="sr" type="file" accept="image/*" onChange={addOwn} />
                {remote && !open_ && <button id="library-open" type="button" className="inline" onClick={() => set({ libraryOpen: true })}>Add your face to the library</button>}
              </div>
            </>
          )}
          {open_ && <LibraryPanel onClose={() => set({ libraryOpen: false })} />}
          {own.length > 0 && <p className="small">Your photo stays on this device. It is not uploaded or stored, and it is gone when you leave the page.</p>}
        </div>

        <div className="studio-main">
          <svg
            id="studio-canvas" className="sheet" viewBox="0 0 360 360" role="img" aria-label="The face you are making"
            onPointerDown={() => select(null)}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.pointer !== event.pointerId) return;
              const p = coordinates(event);
              update(current.id, { x: p.x - current.offset.x, y: p.y - current.offset.y });
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onLostPointerCapture={() => { drag.current = null; }}
          >
            <defs>
              <filter id="soft-edge" x="-40" y="-40" width="440" height="440" filterUnits="userSpaceOnUse">
                <feGaussianBlur stdDeviation={FEATHER} />
              </filter>
              {pieces.map((piece) => (
                <mask key={piece.id} id={`cut-${piece.id}`} maskUnits="userSpaceOnUse" x="-720" y="-720" width="1800" height="1800">
                  <path d={roundedOutline(piece.outline)} fill="white" filter="url(#soft-edge)" />
                </mask>
              ))}
            </defs>
            <image href={sources.get(base)} width="360" height="360" pointerEvents="none" />
            {pieces.map((piece) => {
              const c = centerOf(piece.outline);
              return (
                <g key={piece.id} transform={`translate(${piece.x} ${piece.y}) translate(${c.x} ${c.y}) rotate(${piece.rotation}) scale(${piece.scale}) translate(${-c.x} ${-c.y})`}>
                  <image href={sources.get(piece.portrait)} width="360" height="360" preserveAspectRatio="xMidYMid slice" mask={`url(#cut-${piece.id})`} pointerEvents="none" />
                  <path
                    className="handle" d={roundedOutline(piece.outline)} fill="transparent" stroke={piece.id === selected ? '#cd256f' : 'none'} vectorEffect="non-scaling-stroke" strokeDasharray="4 3"
                    onPointerDown={(event) => {
                      if (event.button !== 0 || drag.current) return;
                      event.stopPropagation();
                      const svg = event.currentTarget.ownerSVGElement!;
                      svg.setPointerCapture(event.pointerId);
                      const point = svg.createSVGPoint();
                      point.x = event.clientX;
                      point.y = event.clientY;
                      const local = point.matrixTransform(svg.getScreenCTM()!.inverse());
                      drag.current = { id: piece.id, pointer: event.pointerId, offset: { x: local.x - piece.x, y: local.y - piece.y } };
                      select(piece.id);
                    }}
                  />
                </g>
              );
            })}
            {preview && <image href={preview} width="360" height="360" onPointerDown={(event) => event.stopPropagation()} />}
          </svg>
          <div className="row">
            <button id="studio-blend" type="button" className="inline" disabled={!pieces.length || busy} onClick={blend}>Melt into one face</button>
            {blended?.pieces === pieces && (
              <button id="studio-toggle" type="button" className="inline" onClick={() => setShowBlend(!showBlend)}>{preview ? 'Back to the pieces' : 'Show the melted face'}</button>
            )}
            <button id="studio-download" type="button" className="inline" disabled={!pieces.length || busy} onClick={() => deliver(false)}>Download PNG</button>
            <button id="studio-share" type="button" className="inline" disabled={!pieces.length || busy} onClick={() => deliver(true)}>Share</button>
          </div>
          <p id="studio-status" className="small" role="status">{status}</p>
        </div>

        <div className="studio-side">
          {pieces.length > 0 && (
            <ol className="layers">
              {[...pieces].reverse().map((piece) => (
                <li key={piece.id}>
                  <button type="button" aria-pressed={piece.id === selected} onClick={() => select(piece.id)}>{title(piece)}</button>
                </li>
              ))}
            </ol>
          )}
          {active && (
            <div className="controls">
              <label>
                <span>Turn {active.rotation}°</span>
                <input id="studio-turn" className="timeline" type="range" min="-180" max="180" value={active.rotation} onChange={(e) => update(active.id, { rotation: Number(e.target.value) })} />
              </label>
              <label>
                <span>Size {Math.round(active.scale * 100)}%</span>
                <input id="studio-size" className="timeline" type="range" min="25" max="300" value={Math.round(active.scale * 100)} onChange={(e) => update(active.id, { scale: Number(e.target.value) / 100 })} />
              </label>
              <div className="row">
                <button type="button" className="inline" disabled={active === pieces[pieces.length - 1]} onClick={() => reorder(1)}>Forward</button>
                <button type="button" className="inline" disabled={active === pieces[0]} onClick={() => reorder(-1)}>Back</button>
                <button id="studio-remove" type="button" className="inline" onClick={() => { setPieces(pieces.filter((p) => p.id !== selected)); select(null); }}>Remove</button>
              </div>
            </div>
          )}
          <div className="works">
            <label className="sr" htmlFor="studio-name">Name of this face</label>
            <input id="studio-name" type="text" value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setStatus(''); }} />
            <div className="row">
              <button id="studio-save" type="button" className="inline" disabled={!pieces.length} onClick={save}>Save</button>
              <button id="studio-new" type="button" className="inline" onClick={() => open()}>New</button>
            </div>
            {saved.length > 0 && (
              <ul>
                {saved.map((work) => (
                  <li key={work.id}><button type="button" aria-pressed={work.id === workId} onClick={() => open(work)}>{work.name}</button></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
