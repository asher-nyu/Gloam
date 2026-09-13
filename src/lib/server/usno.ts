import { AsyncCache } from './cache';
import { parseUsnoTable, type TableDay } from './usno-parser';
import { localInstant, shiftDate } from '../domain/time';
import { phases, type Evening, type EveningEvent, type EventKind } from '../domain/types';

const tables = new AsyncCache<{ days: TableDay[]; fetched: string }>(128, 24 * 3_600_000);
const tasks: Record<EventKind, number> = { sunset: 0, civil: 2, nautical: 3, astronomical: 4 };
const base = 'https://aa.usno.navy.mil/calculated/rstt/year';

export function sourceUrl(
  latitude: number,
  longitude: number,
  year: number,
  kind: EventKind = 'astronomical',
): string {
  return `${base}?${new URLSearchParams({ ID: 'AA', year: String(year), task: String(tasks[kind]), lat: latitude.toFixed(4), lon: longitude.toFixed(4), tz: '0', tz_sign: '1' })}`;
}
async function table(latitude: number, longitude: number, year: number, kind: EventKind) {
  const url = sourceUrl(latitude, longitude, year, kind);
  return tables.get(url, async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(18_000),
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) throw new Error(`USNO HTTP ${response.status}`);
    const days = parseUsnoTable(await response.text(), year);
    return { days, fetched: new Date().toISOString() };
  });
}

export async function getEvening(
  latitude: number,
  longitude: number,
  date: string,
  timezone: string,
): Promise<Evening> {
  const start = localInstant(date, timezone, 0);
  const end = localInstant(shiftDate(date, 1), timezone, 0);
  const nextDayEnd = localInstant(shiftDate(date, 2), timezone, 0);
  // UTC years may differ from the selected city's calendar year at either end.
  const years = [
    ...new Set([new Date(start).getUTCFullYear(), new Date(nextDayEnd - 1).getUTCFullYear()]),
  ];
  const results = await Promise.allSettled(
    phases.map(async (phase) => {
      const values = await Promise.all(
        years.map((year) => table(latitude, longitude, year, phase.kind)),
      );
      return {
        kind: phase.kind,
        days: values.flatMap((v) => v.days),
        fetched: values.map((v) => v.fetched).sort()[0],
      };
    }),
  );
  if (results.every((result) => result.status === 'rejected'))
    throw new Error('Evening times could not be retrieved from USNO.');
  const sunsetResult = results[0].status === 'fulfilled' ? results[0].value : null;
  const sunsets = sunsetResult?.days.flatMap((day) => day.setting).sort() ?? [];
  const sunset = sunsets.filter((at) => Date.parse(at) >= start && Date.parse(at) < end).at(-1);
  const fallback = results.slice(1).flatMap((result) => {
    if (result.status !== 'fulfilled') return [];
    const at = result.value.days
      .flatMap((day) => day.setting)
      .sort()
      .filter((at) => Date.parse(at) >= start && Date.parse(at) < end)
      .at(-1);
    return at ? [at] : [];
  })[0];
  const anchorEvent = sunset ?? fallback;
  const anchor = anchorEvent ? Date.parse(anchorEvent) : start;
  const sunrise = sunset
    ? sunsetResult?.days
        .flatMap((day) => day.rising)
        .sort()
        .find((at) => Date.parse(at) > anchor)
    : null;
  const limit = anchorEvent
    ? sunrise
      ? Math.min(Date.parse(sunrise), nextDayEnd)
      : nextDayEnd
    : end;
  const events: EveningEvent[] = results.map((result, index) => {
    const kind = phases[index].kind;
    if (result.status === 'rejected') return { kind, at: null, status: 'unavailable' };
    const at = result.value.days
      .flatMap((day) => day.setting)
      .sort()
      .find((at) => Date.parse(at) >= anchor && Date.parse(at) < limit);
    if (at) return { kind, at, status: 'occurs' };
    // A continuous-state marker is a statement about a whole UTC day, not a service failure.
    const relevant = result.value.days.filter((day) => {
      const midnight = Date.parse(`${day.date}T00:00:00Z`);
      return midnight < end && midnight + 86_400_000 > start;
    });
    const middayUtcDate = new Date(localInstant(date, timezone)).toISOString().slice(0, 10);
    const state = relevant.find((day) => day.date === middayUtcDate)?.status ?? 'no-crossing';
    return { kind, at: null, status: state };
  });
  const fetched = results
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value.fetched] : []))
    .sort()[0];
  return {
    date,
    events,
    retrievedAt: fetched,
    source: 'USNO',
    sourceUrl: sourceUrl(latitude, longitude, new Date(start).getUTCFullYear()),
  };
}
