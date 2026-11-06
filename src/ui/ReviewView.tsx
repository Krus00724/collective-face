import { useEffect, useState } from 'react';
import { FIGURES, FIGURE_IDS } from '../data/figures';
import { library as call, loadLibrary, remote } from '../services/remote';
import { voiceHub, type PendingVoice } from '../services/voice';
import { useStore } from '../store';

const when = (t: number) => new Date(t).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });

/** The artist's desk: nothing reaches the public before it has passed through here. */
export function ReviewView() {
  const owner = useStore((s) => s.owner);
  const pending = useStore((s) => s.pending);
  const removals = useStore((s) => s.removals);
  const voices = useStore((s) => s.voices);
  const library = useStore((s) => s.library);
  const [note, setNote] = useState('');
  useEffect(() => { loadLibrary(); }, []);
  if (!owner) return <article className="about"><div className="column"><p>This page is only for the artist.</p></div></article>;

  const store = voiceHub.store;
  const act = async (fn: () => Promise<void> | undefined, done: string) => {
    try { await fn(); setNote(done); } catch { setNote('That did not work. Try again.'); }
  };
  const approved = FIGURE_IDS.flatMap((id) => voices[id]).sort((a, b) => b.t - a.t);

  const preview = async (id: string) => {
    const data = await store?.audio(id);
    if (data) voiceHub.preview(data);
  };

  return (
    <article className="about">
      <div className="column">
        <h2>Messages</h2>
        {!pending.length && <p>Nothing is waiting for you.</p>}
        <ul className="queue">
          {pending.map((p: PendingVoice) => (
            <li key={p.id}>
              <span>{FIGURES[p.figure].name}, {when(p.t)}</span>
              <div className="row">
                <button id={`hear-${p.id}`} type="button" className="inline" onClick={() => voiceHub.preview(p.data)}>Listen</button>
                <button id={`approve-${p.id}`} type="button" className="action" onClick={() => act(() => store?.approve(p), 'Approved. It can now be heard.')}>Approve</button>
                <button id={`reject-${p.id}`} type="button" className="inline" onClick={() => act(() => store?.reject(p), 'Rejected and deleted.')}>Reject</button>
              </div>
            </li>
          ))}
        </ul>
        {!!removals.length && <p><b>Removal requests.</b> These people want their message taken down.</p>}
        <ul className="queue">
          {removals.map((r) => (
            <li key={r.from}>
              <span>Message {r.id.slice(0, 6)}, {when(r.t)}</span>
              <div className="row">
                <button id={`remove-${r.id}`} type="button" className="action" onClick={() => act(async () => { await store?.remove(r.id); await store?.clearRemoval(r); }, 'Message removed.')}>Remove it</button>
              </div>
            </li>
          ))}
        </ul>
        {!!approved.length && <p><b>Approved messages.</b></p>}
        <ul className="queue">
          {approved.map((r) => (
            <li key={r.id}>
              <span>{FIGURES[r.figure].name}, {when(r.t)}</span>
              <div className="row">
                <button id={`play-${r.id}`} type="button" className="inline" onClick={() => preview(r.id)}>Listen</button>
                <button id={`drop-${r.id}`} type="button" className="inline" onClick={() => act(() => store?.remove(r.id), 'Message removed.')}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
        {remote && !!library.length && <p><b>Portraits.</b> The oldest leave when the library is full. Kept ones stay.</p>}
        <ul className="faces">
          {remote && library.map((p) => {
            const id = p.id.slice(4);
            return (
              <li key={p.id}>
                <img src={p.src} alt="" loading="lazy" />
                <div className="row">
                  <button type="button" className="inline" onClick={() => act(async () => { await call({ action: 'keep', id, keep: !p.keep }); await loadLibrary(); }, p.keep ? 'It can leave again.' : 'Kept.')}>{p.keep ? 'Kept' : 'Keep'}</button>
                  <button type="button" className="inline" onClick={() => act(async () => { await call({ action: 'remove', id }); await loadLibrary(); }, 'Removed, with its e-mail.')}>Remove</button>
                </div>
              </li>
            );
          })}
        </ul>
        {note && <p className="small" role="status">{note}</p>}
      </div>
    </article>
  );
}
