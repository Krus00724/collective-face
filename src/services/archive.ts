/** The weekly close: every Sunday at 23:59, Europe/Berlin. */

function berlinOffsetMinutes(utc: number) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(utc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return (local - Math.floor(utc / 6e4) * 6e4) / 6e4;
}

/** UTC time of 23:59 Berlin on a calendar date. Daylight saving is handled by asking Intl. */
export function closeOf(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 23, 59);
  return guess - berlinOffsetMinutes(guess) * 6e4;
}

export function isoDatePlus(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export const formatDate = (iso: string) => iso.split('-').reverse().join('.');

/** All Sundays from `first` whose close has already passed. */
export function closedWeeks(first: string, now: number) {
  const out: string[] = [];
  for (let iso = first; closeOf(iso) <= now; iso = isoDatePlus(iso, 7)) out.push(iso);
  return out;
}

export function nextClose(first: string, now: number) {
  let iso = first;
  while (closeOf(iso) <= now) iso = isoDatePlus(iso, 7);
  return iso;
}
