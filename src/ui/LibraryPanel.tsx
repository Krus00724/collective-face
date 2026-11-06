import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { library as call, loadLibrary, portraitUrl, remote } from '../services/remote';
import { prepare, Retake } from '../studio/prepare';
import { useStore } from '../store';

const CONSENT = 'library-v1';

/** Joining the shared library: one e-mail, one photo, and a way back out. */
export function LibraryPanel({ onClose }: { onClose: () => void }) {
  const account = useStore((s) => s.account);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState<string | null | undefined>(undefined);
  const [photo, setPhoto] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!account) return;
    call({ action: 'mine' }).then((r) => setMine(r.portrait ? portraitUrl(r.portrait.path) : null));
  }, [account]);

  const link = async (event: FormEvent) => {
    event.preventDefault();
    if (!remote) return;
    setBusy('Sending');
    setNote('');
    const { error } = await remote.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy('');
    if (error) setNote('The e-mail could not be sent. Check the address, or try again later.');
    else setSent(true);
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhoto('');
    setAgreed(false);
    setNote('');
    setBusy('Getting your photo ready, on your device');
    try {
      setPhoto(await prepare(file));
    } catch (error) {
      setNote(error instanceof Retake ? error.message : 'This photo could not be prepared. Try again.');
    } finally {
      setBusy('');
    }
  };

  const send = async () => {
    setBusy('Checking your photo');
    setNote('');
    const r = await call({ action: 'submit', consent: CONSENT, image: photo.split(',')[1] });
    setBusy('');
    if (r.retake) {
      setPhoto('');
      setAgreed(false);
      setNote(r.retake);
      return;
    }
    if (r.error) {
      setNote(r.error);
      return;
    }
    setPhoto('');
    setMine(r.portrait ? portraitUrl(r.portrait.path) : null);
    setNote('Your face is in the library.');
    loadLibrary();
  };

  const leave = async () => {
    setBusy('Removing');
    const r = await call({ action: 'withdraw' });
    setBusy('');
    if (r.error) { setNote(r.error); return; }
    await remote?.auth.signOut();
    setMine(undefined);
    setNote('Your photo and your e-mail are gone.');
    loadLibrary();
  };

  const signOut = async () => {
    await remote?.auth.signOut();
    setMine(undefined);
    setPhoto('');
  };

  return (
    <div className="voice library">
      {!account ? (
        sent ? (
          <p className="small">Open the link we sent to {email.trim()}. It brings you back here.</p>
        ) : (
          <form onSubmit={link}>
            <p className="small">Your photo joins a shared library that anyone can cut into new faces. One e-mail, one photo. The address is used for nothing else.</p>
            <label className="sr" htmlFor="library-email">Your e-mail</label>
            <input id="library-email" type="email" required autoComplete="email" placeholder="Your e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button id="library-link" type="submit" className="action" disabled={!!busy}>Send me a link</button>
          </form>
        )
      ) : mine === undefined ? (
        <p className="small">One moment.</p>
      ) : mine ? (
        <>
          <img src={mine} alt="Your portrait in the library" />
          <div className="row">
            <button id="library-leave" type="button" className="inline" disabled={!!busy} onClick={leave}>Remove my photo and e-mail</button>
          </div>
        </>
      ) : photo ? (
        <>
          <img src={photo} alt="Your photo, ready for the library" />
          <label className="consent" htmlFor="library-consent">
            <input id="library-consent" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>This is a photo of me and I am 18 or older. I agree that it is checked by an AI, stored on the server of this work, shown publicly, and that anyone may cut it into new faces, download them and share them. I can remove it at any time, but faces others already made cannot be called back.</span>
          </label>
          <div className="row">
            <button id="library-send" type="button" className="action" disabled={!agreed || !!busy} onClick={send}>Add it to the library</button>
            <button id="library-again" type="button" className="inline" disabled={!!busy} onClick={() => input.current?.click()}>Take another</button>
          </div>
        </>
      ) : (
        <>
          <p className="small">Face the camera, in even light, on your own. We make the background white and line your face up with the others, here on your device.</p>
          <button id="library-pick" type="button" className="action" disabled={!!busy} onClick={() => input.current?.click()}>{note ? 'Take a new photo' : 'Take or choose a photo'}</button>
        </>
      )}
      <input ref={input} id="library-file" className="sr" type="file" accept="image/*" onChange={choose} tabIndex={-1} aria-hidden="true" />
      {busy && <p className="small" role="status">{busy}</p>}
      {note && <p className="error" role="alert">{note}</p>}
      <div className="row">
        <button id="library-close" type="button" className="inline" onClick={onClose}>Close</button>
        {account && !mine && <button id="library-out" type="button" className="inline" onClick={signOut}>Sign out</button>}
      </div>
    </div>
  );
}
