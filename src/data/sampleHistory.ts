import { FIGURE_IDS, type FigureId } from './figures';
import { prng } from '../sculpture/mutations';

/**
 * A simulation for the prototype: twelve invented weeks showing how the family could change, so the
 * archive has something to show before anyone has contributed. No real person is behind them and
 * the interface says so. Real weeks take their place as they close.
 */
export interface Contribution {
  id: string;
  figure: FigureId;
  seed: number;
  /** Multiplies the mutation. Reserved for real analysis. */
  strength?: number;
  /** Milliseconds since epoch. */
  t: number;
  sample?: boolean;
}

export const SAMPLE_TOTALS: Record<FigureId, number> = { mother: 214, father: 163, child: 104 };

/** The first twelve Sundays of the work, closing at 23:59 Europe/Berlin. */
export const SAMPLE_WEEKS = [
  '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13',
  '2026-12-20', '2026-12-27', '2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24',
];

export function sampleContributions(closes: number[]): Contribution[] {
  const r = prng(20261108);
  const out: Contribution[] = [];
  for (const figure of FIGURE_IDS) {
    for (let i = 0; i < SAMPLE_TOTALS[figure]; i++) {
      // contributions grow week on week, as they would once word spreads
      const week = Math.min(closes.length - 1, Math.floor(closes.length * Math.pow(r(), 0.72)));
      const start = week === 0 ? closes[0] - 7 * 864e5 : closes[week - 1];
      const t = start + r() * (closes[week] - start - 6e4);
      out.push({ id: `sample-${figure}-${i}`, figure, seed: Math.floor(r() * 2 ** 31), t, sample: true });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
