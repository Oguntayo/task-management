/** Timezone-aware date helpers. Dates are handled as local YYYY-MM-DD strings in the company timezone. */
export function toLocalDate(iso: string | Date, tz: string): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday 1 (Mon) .. 7 (Sun) */
export function isoWeekday(date: string): number {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

export function weekStart(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

export function weekEnd(date: string): string {
  return addDays(weekStart(date), 6);
}

export function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/** Number of working days in [from, to] inclusive. */
export function workingDays(from: string, to: string, workingWeekdays: number[] = [1, 2, 3, 4, 5]): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (workingWeekdays.includes(isoWeekday(d))) n++;
  return n;
}

export function daysBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
}

export function hoursBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;
}
