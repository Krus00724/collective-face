import { useState, type FormEvent, type MutableRefObject } from 'react';
import { findMine, forgetMine, type ContributionStore } from '../services/persistence';
import { remote } from '../services/remote';
import { voiceHub } from '../services/voice';
import { useStore } from '../store';

export function AboutView({ store }: { store: MutableRefObject<ContributionStore | null> }) {
  const storage = useStore((s) => s.storage);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');

  const withdraw = async (e: FormEvent) => {
    e.preventDefault();
    const code = value.replace(/[^0-9a-z]/gi, '').toUpperCase();
    if (remote) {
      const { data, error } = code ? await remote.rpc('withdraw', { code }) : { data: null, error: null };
      if (error) { setNote('That did not work. Try again in a moment.'); return; }
      if (!data) { setNote('Nothing here has that code.'); return; }
      forgetMine(code);
      setValue('');
      store.current?.refresh?.();
      setNote(data === 'voice' ? 'Your message is gone.' : `Contribution #${code} is withdrawn. The sculpture has gone back to the form it would have had without it.`);
      return;
    }
    const mine = code ? findMine(code) : null;
    if (!mine) {
      setNote('This browser has no trace with that code. In the public version a removal request will go through a form.');
      return;
    }
    if (mine.kind === 'voice') {
      await voiceHub.store?.cancelPending().catch(() => undefined);
      await voiceHub.store?.requestRemoval(mine.id).catch(() => undefined);
      forgetMine(code);
      setValue('');
      setNote('Your message has been taken out of the queue. If it was already approved, it will be removed by hand.');
      return;
    }
    await store.current?.remove(mine.id);
    forgetMine(code);
    setValue('');
    setNote(`Contribution #${code} is withdrawn. The sculpture has gone back to the form it would have had without it.`);
  };

  return (
    <article className="about">
      <div className="column">
        <h2>What happens to identity when it no longer belongs to one person?</h2>
        <p>
          Mother, Father and Child are three busts of plasticine. They begin as the faces of my friends. Over time,
          as strangers leave their traces, they are meant to become the faces of many different people. Each person
          who gives a photograph changes one of them in one hidden way. It works like mutation in living things:
          most changes are too small to see, a few are large, and they add up. No one is told what changed, and no one
          controls what the family becomes.
        </p>
        <p>
          The voices work the same way. The busts speak with messages from different people, none of whom have to know
          each other. Click a face and you hear one of them.
        </p>
        <p>
          The change stays. Older traces fade, merge or grow strange as new ones arrive, while the faces keep moving
          through every feeling they can reach. Every Sunday at 23:59, Berlin time, the family is frozen and added to the archive,
          so each week becomes a fixed moment in the history of a family of people who will never meet.
        </p>

        <p><b>This version is a prototype.</b> The sculptures, their deformation, the archive and the saved state are real.
          The analysis behind a trace is simulated: your photograph only produces a random number.
          The weeks now in the archive are a simulation of how the family could change, and a real week takes the place of each one as it closes.
          {storage === 'shared' ? ' New contributions here are shared with everyone who can open this page.' : ' New contributions here are kept in this browser.'}
        </p>

        <p><b>Your photograph.</b> When you leave a trace on a sculpture, nothing is read until you agree. The photo is processed inside your browser, never uploaded and never stored,
          and it is deleted from memory as soon as the analysis ends.</p>
        <p><b>What a trace keeps.</b> The sculpture you chose, the time, and the random number that shaped the change.
          No image, no facial measurements, no embeddings, no name, no account. How many people have taken part is never shown.</p>
        <p><b>Voice messages.</b> They are optional and last up to 10 seconds. Messages are accepted in English only.
          Do not share private information, yours or anyone else's. I listen to each one before anyone can hear it, and rejected ones are deleted.
          While it waits, a message is linked to an anonymous account id. Once approved, it is stored with no link to you, and it stays until you withdraw it.
          The people who speak are responsible for what they say, and I accept no legal responsibility for the content of the messages.</p>
        <p><b>The studio.</b> Cut pieces out of portraits and put a new face together. The six first portraits are generated and show no real person, and every portrait is bent onto one shared face, so each part lands where it belongs.
          A photo you only use in the studio stays on your device. It is not uploaded or stored, and it is gone when you leave the page. Use only photos of yourself or of people who agreed.
          Faces you save stay in this browser.</p>
        {remote && (
          <p><b>The portrait library.</b> You can give your portrait to a shared library, and then anyone can cut it into new faces, download them and share them.
            Your browser makes the background white and lines the face up first. The prepared photo then goes to the server of this work in the EU, and is checked by an AI, Anthropic's Claude, which looks at whether it can be used, not at who you are.
            Everything is kept until the library is full, then the oldest portraits leave, except ones I choose to keep. Your e-mail is used only to keep it to one photo per person.
            You can remove your photo and your e-mail yourself at any time in the studio, but faces other people already made cannot be called back.</p>
        )}
        <p><b>No identification.</b> The work does not recognise anyone, does not compare faces and does not check them against any database.</p>
        <p><b>The archive.</b> It preserves sculptures, never photographs. Anyone can see it and it is kept permanently.</p>

        {remote && <p><b>Impressum.</b> Krzysztof Wiatr, Neukölln, Berlin.</p>}

        <form onSubmit={withdraw}>
          <p><b>Withdrawing.</b> Enter your code and your trace is taken out of the living sculpture, or your message out of its voice.
            {remote ? ' It works from any device.' : ' In this prototype it works from the browser you used.'}</p>
          <label className="sr" htmlFor="withdraw-number">Your code</label>
          <div className="row">
            <input id="withdraw-number" type="text" autoCapitalize="characters" placeholder="#K7F3Q2" value={value} onChange={(e) => setValue(e.target.value)} />
            <button id="withdraw" type="submit" className="inline">Withdraw</button>
          </div>
          {note && <p className="small" role="status">{note}</p>}
        </form>
      </div>
    </article>
  );
}
