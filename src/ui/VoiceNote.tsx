import { useEffect, useRef, useState } from 'react';
import { FIGURES, type FigureId } from '../data/figures';
import { newCode, rememberMine } from '../services/persistence';
import { MAX_SECONDS, prepare, voiceHub, VoiceProblem } from '../services/voice';

type State = 'idle' | 'recording' | 'reading' | 'ready' | 'sending' | 'sent';

/** Leave up to 10 seconds of voice. It is heard only after the artist has approved it. */
export function VoiceNote({ figure, onClose }: { figure: FigureId; onClose: () => void }) {
  const [state, setState] = useState<State>('idle');
  const [left, setLeft] = useState(MAX_SECONDS);
  const [data, setData] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  // the artifact viewer refuses the microphone outright, so the button only shows where it can work
  const [micBlocked, setMicBlocked] = useState(!navigator.mediaDevices?.getUserMedia || 'claude' in window);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef(0);
  const name = FIGURES[figure].name;

  useEffect(() => () => { clearInterval(timer.current); recorder.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const read = async (blob: Blob) => {
    setState('reading');
    setError('');
    try {
      const result = await prepare(blob);
      setData(result.data);
      setState('ready');
    } catch (e) {
      setError(e instanceof VoiceProblem ? e.message : 'This recording could not be read. Try another file.');
      setState('idle');
    }
  };

  const record = async () => {
    setError('');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setMicBlocked(true);
      setError('This view cannot reach your microphone. Record a voice memo on your phone and attach it instead.');
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    recorder.current = rec;
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer.current);
      read(new Blob(chunks, { type: rec.mimeType }));
    };
    rec.start();
    setState('recording');
    setLeft(MAX_SECONDS);
    const started = Date.now();
    timer.current = window.setInterval(() => {
      const remain = MAX_SECONDS - (Date.now() - started) / 1000;
      setLeft(Math.max(0, Math.ceil(remain)));
      if (remain <= 0) rec.stop();
    }, 100);
  };

  const send = async () => {
    setState('sending');
    const id = newCode() + newCode();
    const c = newCode();
    try {
      await voiceHub.store?.send(figure, id, data, c);
      rememberMine(c, { kind: 'voice', id });
      setCode(c);
      setState('sent');
    } catch {
      setError('The message could not be sent. Try again in a moment.');
      setState('ready');
    }
  };

  if (state === 'sent') {
    return (
      <div className="voice" role="status">
        <h3>Your message is waiting to be heard.</h3>
        <p className="small">Nobody will hear it until it has been reviewed. Keep this code to take it back: <b>#{code}</b></p>
        <button id="voice-done" type="button" className="inline" onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <div className="voice">
      <h3>Leave a message</h3>
      <p className="small">Up to {MAX_SECONDS} seconds, in your own voice, in English only. Do not share private information, yours or anyone else's. People who choose {name} may hear it.</p>
      {state === 'recording' ? (
        <button id="voice-stop" type="button" className="action" onClick={() => recorder.current?.stop()}>Stop, {left} seconds left</button>
      ) : state === 'ready' || state === 'sending' ? (
        <>
          <div className="row">
            <button id="voice-listen" type="button" className="inline" onClick={() => voiceHub.preview(data)}>Listen back</button>
            <button id="voice-again" type="button" className="inline" onClick={() => { setData(''); setState('idle'); }}>Try again</button>
          </div>
          <label className="consent" htmlFor="voice-consent">
            <input id="voice-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>This is my own voice, it is in English, it contains no private information, and I am 16 or older. I agree that, once approved, it may be played to anyone who visits this work, and that I am responsible for what I say.</span>
          </label>
          <button id="voice-send" type="button" className="action" disabled={!consent || state === 'sending'} onClick={send}>Send for review</button>
        </>
      ) : (
        <div className="row">
          {!micBlocked && <button id="voice-record" type="button" className="action" disabled={state === 'reading'} onClick={record}>Record</button>}
          <label className="inline picker" htmlFor="voice-file">{state === 'reading' ? 'Reading the recording' : 'Attach a voice memo'}</label>
          <input
            id="voice-file" className="sr" type="file" accept="audio/*,video/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }}
          />
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <button id="voice-close" type="button" className="inline" onClick={onClose}>Not now</button>
    </div>
  );
}
