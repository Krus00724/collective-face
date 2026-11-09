import { useEffect, useState } from 'react';
import { useStore, type View } from '../store';

const ITEMS: [View, string][] = [['family', 'Family'], ['contribute', 'Contribute'], ['studio', 'Studio'], ['archive', 'Archive'], ['about', 'About']];

/** A thin bar with the menu on the left and the name in the middle. The menu opens over the whole page. */
export function Nav() {
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const pick = useStore((s) => s.pick);
  const busy = useStore((s) => s.phase === 'becoming');
  const owner = useStore((s) => s.owner);
  const waiting = useStore((s) => s.pending.length + s.removals.length);
  const [open, setOpen] = useState(false);
  const items: [View, string][] = owner ? [...ITEMS, ['review', waiting ? `Inbox ${waiting}` : 'Inbox']] : ITEMS;

  useEffect(() => { setOpen(false); }, [view]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [open]);

  return (
    <>
      <header className={`bar${busy ? ' withdrawn' : ''}${open ? ' open' : ''}`}>
        <button id="menu" type="button" className="burger" aria-expanded={open} aria-controls="menu-list" aria-label={open ? 'Close the menu' : 'Open the menu'} onClick={() => setOpen(!open)}>
          <i /><i />
        </button>
        <button id="home" type="button" className="mark" onClick={() => { setOpen(false); go('family'); pick(null); }}>Collective Face</button>
      </header>
      {open && (
        <nav id="menu-list" className="menu-list" aria-label="Main">
          <ul>
            {items.map(([id, label]) => (
              <li key={id}>
                <button id={`nav-${id}`} type="button" className={view === id ? 'here' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => { setOpen(false); go(id); }}>
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}
