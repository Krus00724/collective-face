import { useEffect, useRef, useState } from 'react';
import type { FigureId } from './data/figures';
import { debug } from './debug';
import type { Family } from './sculpture/family';
import { Stage } from './scene/Stage';
import { connectStore, openDb, type ContributionStore } from './services/persistence';
import { watchAccount } from './services/remote';
import { connectVoices, voiceHub } from './services/voice';
import { useStore, type View } from './store';
import { Nav } from './ui/Nav';
import { FamilyView } from './ui/FamilyView';
import { ContributeView } from './ui/ContributeView';
import { ArchiveView } from './ui/ArchiveView';
import { AboutView } from './ui/AboutView';
import { ReviewView } from './ui/ReviewView';
import { StudioView } from './ui/StudioView';

const VIEWS: View[] = ['family', 'contribute', 'studio', 'archive', 'about', 'review'];
const hasWebGL2 = () => {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
};

function deviceTier(): 'high' | 'low' {
  if (debug.on) return debug.high ? 'high' : 'low';
  const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  return !mobile && memory >= 4 ? 'high' : 'low';
}

export function App() {
  const [family, setFamily] = useState<Family | null>(null);
  const [supported] = useState(hasWebGL2);
  const storeRef = useRef<ContributionStore | null>(null);
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [tier] = useState(deviceTier);

  useEffect(() => { debug.expose({ __store: useStore }); watchAccount(); }, []);

  useEffect(() => {
    if (!family) return;
    let cancelled = false;
    debug.expose({ __family: family, __voice: voiceHub });
    voiceHub.family = family;
    openDb().then(connectVoices).then((voices) => {
      if (cancelled || !voices) return;
      voiceHub.store = voices;
      voices.listen();
    });
    connectStore().then((store) => {
      if (cancelled) return;
      storeRef.current = store;
      useStore.getState().set({ storage: store.mode });
      let first = true;
      store.subscribe((live) => {
        family.syncLive(live, !first);
        first = false;
      });
    });
    return () => { cancelled = true; };
  }, [family]);

  useEffect(() => {
    const route = () => {
      const h = location.hash.slice(1);
      if (h === 'mother' || h === 'father' || h === 'child') useStore.getState().pick(h as FigureId);
      else if (VIEWS.includes(h as View)) useStore.getState().go(h as View);
    };
    route();
    addEventListener('hashchange', route);
    return () => removeEventListener('hashchange', route);
  }, [ready]);

  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => setReduced(mq.matches);
    mq.addEventListener('change', onMq);
    const fit = () => useStore.getState().set({ close: innerWidth / Math.max(1, innerHeight) < 0.85 });
    addEventListener('resize', fit);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.getState().pick(null); };
    addEventListener('keydown', esc);
    return () => { mq.removeEventListener('change', onMq); removeEventListener('keydown', esc); removeEventListener('resize', fit); };
  }, []);

  if (!supported) {
    return (
      <main className="fallback">
        <h1>Collective Face</h1>
        <p>This work needs WebGL 2, which this browser does not offer. Try a current version of Chrome, Firefox or Safari.</p>
      </main>
    );
  }

  return (
    <>
      <Stage family={family} onFamily={setFamily} quality={tier} reduced={reduced} />
      <Nav />
      {view === 'family' && <FamilyView />}
      {view === 'contribute' && family && <ContributeView family={family} store={storeRef} reduced={reduced} />}
      {view === 'studio' && <StudioView />}
      {view === 'archive' && family && <ArchiveView family={family} />}
      {view === 'about' && <AboutView store={storeRef} />}
      {view === 'review' && <ReviewView />}
      <div className={`veil${ready ? ' lifted' : ''}`} aria-hidden={ready}>
        <p>Collective Face</p>
      </div>
    </>
  );
}
