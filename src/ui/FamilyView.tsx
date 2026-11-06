import { useEffect, useState } from 'react';
import { FIGURES, FIGURE_IDS } from '../data/figures';
import { voiceHub } from '../services/voice';
import { useStore } from '../store';
import { VoiceNote } from './VoiceNote';

/** Nothing sits on the sculptures. Up close, the little text there is fades away by itself. */
export function FamilyView() {
  const selected = useStore((s) => s.selected);
  const go = useStore((s) => s.go);
  const pick = useStore((s) => s.pick);
  const canSend = useStore((s) => s.canSend);
  const heard = useStore((s) => (s.selected ? s.voices[s.selected].length > 0 : false));
  const [idle, setIdle] = useState(false);
  const [note, setNote] = useState(false);

  useEffect(() => { setNote(false); }, [selected]);
  useEffect(() => {
    if (!selected || note) { setIdle(false); document.body.classList.remove('undisturbed'); return; }
    let timer = 0;
    const wake = () => {
      setIdle(false);
      document.body.classList.remove('undisturbed');
      clearTimeout(timer);
      timer = window.setTimeout(() => { setIdle(true); document.body.classList.add('undisturbed'); }, 3200);
    };
    wake();
    addEventListener('pointermove', wake);
    addEventListener('pointerdown', wake);
    return () => {
      clearTimeout(timer);
      removeEventListener('pointermove', wake);
      removeEventListener('pointerdown', wake);
      document.body.classList.remove('undisturbed');
    };
  }, [selected, note]);

  if (selected) {
    return (
      <>
        {note && <section className="panel note"><VoiceNote figure={selected} onClose={() => setNote(false)} /></section>}
        <div className={`closeup${idle ? ' gone' : ''}`}>
          <p><span>{FIGURES[selected].name}</span></p>
          <div className="row">
            {heard && <button id="listen" type="button" className="inline" onClick={() => voiceHub.playRandom(selected)}>Listen</button>}
            <button id="leave-trace" type="button" className="inline" onClick={() => go('contribute')}>Leave a trace</button>
            {canSend && <button id="leave-message" type="button" className="inline" onClick={() => setNote(true)}>Leave a message</button>}
            <button id="back-row" type="button" className="inline" onClick={() => pick(null)}>All three</button>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <header className="caption">
        <h1>Collective Face</h1>
        <p>Three bodies. Countless identities. No final form.</p>
      </header>
      <ul className="sr-keys">
        {FIGURE_IDS.map((id) => (
          <li key={id}>
            <button id={`look-${id}`} type="button" onClick={() => { pick(id); voiceHub.playRandom(id); }}>Look at {FIGURES[id].name}</button>
          </li>
        ))}
      </ul>
    </>
  );
}
