import { useEffect, useRef, useState } from 'react';
import type { Family } from '../sculpture/family';
import { exportWeek } from '../services/exportWeek';
import { formatDate, nextClose } from '../services/archive';
import { useStore } from '../store';

const pad = (n: number) => String(n).padStart(3, '0');

export function ArchiveView({ family }: { family: Family }) {
  const weeks = useStore((s) => s.weeks);
  const t = useStore((s) => s.archiveT);
  const compare = useStore((s) => s.compare);
  const previews = useStore((s) => s.previews);
  const set = useStore((s) => s.set);
  const [saving, setSaving] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const index = Math.min(weeks.length - 1, Math.round(t));
  const week = weeks[index];

  useEffect(() => {
    const node = list.current?.querySelector('.here');
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [index]);

  if (!week) return null;
  const next = nextClose('2026-11-08', Date.now());

  const save = async () => {
    setSaving('Preparing the geometry');
    try {
      await new Promise((r) => setTimeout(r, 30));
      await exportWeek(family, family.weeks[index], previews[week.iso]);
      setSaving('');
    } catch (e) {
      const declined = (e as { code?: string }).code === 'declined';
      setSaving(declined ? '' : 'The download could not start. Try again.');
    }
  };

  return (
    <section className="archive" aria-labelledby="archive-title">
      <h2 id="archive-title" className="sr">A memory of faces</h2>
      <div className="reader">
        <div className="headline">
          <p className="current">
            {compare ? <>Today</> : <>WEEK {pad(week.number)}<span>{formatDate(week.iso)}</span></>}
          </p>
          {!compare && <p className="facts">{week.sample ? 'Simulation' : '23:59, Berlin'}</p>}
        </div>
        <div className="row">
          <button id="compare" type="button" className="inline" aria-pressed={compare} onClick={() => set({ compare: !compare })}>
            {compare ? `Back to week ${pad(week.number)}` : 'Compare with today'}
          </button>
          <button id="download-week" type="button" className="inline" onClick={save}>Download as 3D files</button>
        </div>
      </div>
      <label className="sr" htmlFor="timeline">Timeline, week by week</label>
      <input
        id="timeline" className="timeline" type="range" min={0} max={Math.max(1, weeks.length - 1)} step={0.01} value={t}
        onChange={(e) => set({ archiveT: Number(e.target.value), compare: false })}
        onPointerUp={() => set({ archiveT: Math.round(useStore.getState().archiveT) })}
        onKeyUp={() => set({ archiveT: Math.round(useStore.getState().archiveT) })}
      />
      <ol ref={list} className="ledger">
        {weeks.map((w, i) => (
          <li key={w.iso} className={i === index ? 'here' : ''}>
            <button id={`week-${w.number}`} type="button" aria-current={i === index} onClick={() => set({ archiveT: i, compare: false })}>
              {previews[w.iso] ? <img src={previews[w.iso]} alt="" /> : <i aria-hidden="true" />}
              <span>{pad(w.number)}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="small">
        {saving && <>{saving}. </>}
        {week.sample ? 'This week has not happened. It is a simulation of how the family could change, and a real week replaces it when it closes. ' : ''}
        The next entry closes on Sunday {formatDate(next)} at 23:59. Past weeks cannot be changed.
      </p>
    </section>
  );
}
