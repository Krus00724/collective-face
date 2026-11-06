import { useStore, type View } from '../store';

const ITEMS: [View, string][] = [['family', 'The Family'], ['contribute', 'Contribute'], ['studio', 'Studio'], ['archive', 'Archive'], ['about', 'About']];

export function Nav() {
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const busy = useStore((s) => s.phase === 'becoming');
  const owner = useStore((s) => s.owner);
  const waiting = useStore((s) => s.pending.length + s.removals.length);
  const items: [View, string][] = owner ? [...ITEMS, ['review', waiting ? `Inbox ${waiting}` : 'Inbox']] : ITEMS;
  return (
    <nav className={`nav${busy ? ' withdrawn' : ''}`} aria-label="Main">
      {items.map(([id, label]) => (
        <button key={id} id={`nav-${id}`} type="button" className={view === id ? 'here' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => go(id)}>
          {label === 'The Family' ? <><span className="the">The </span>Family</> : label}
        </button>
      ))}
    </nav>
  );
}
