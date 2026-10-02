import {
  splitMessages,
  parseFields,
  parseGrid,
  parseProduct,
  decodeFieldValues,
  nearestGridpoint,
} from '@azohra/meteo.grib';
import { createNodeJ2kDecoder } from '@azohra/meteo.grib/j2k-node';
import { localInstant } from '../domain/time';
import type { UvForecast, UvPoint } from '../domain/types';

const base = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/uvi/prod/';
const hourMs = 3_600_000;
const decoder = createNodeJ2kDecoder();
let active = 0;
const queue: Array<() => void> = [];

async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 3) {
    if (queue.length >= 24) throw new Error('NOAA request capacity reached.');
    await new Promise<void>((resolve, reject) => {
      const admit = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        const index = queue.indexOf(admit);
        if (index !== -1) queue.splice(index, 1);
        reject(new Error('NOAA request wait expired.'));
      }, 20_000);
      queue.push(admit);
    });
  } else active++;
  try {
    return await work();
  } finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}
function directory(run: number): string {
  return `${base}uvi.${new Date(run).toISOString().slice(0, 10).replaceAll('-', '')}/`;
}
async function available(run: number): Promise<Set<number>> {
  const response = await fetch(directory(run), {
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('NOAA run unavailable.');
  return new Set(
    [...(await response.text()).matchAll(/href="uv\.t12z\.grbf(\d{2,3})\.grib2"/g)].map((match) =>
      Number(match[1]),
    ),
  );
}

export function uvIndex(irradiance: number): number | null {
  // NOAA parameter 196 is W/m², despite its UVI abbreviation. Missing is never zero.
  return Number.isFinite(irradiance) && irradiance >= 0 && irradiance !== 9999
    ? irradiance * 40
    : null;
}
async function sample(
  run: number,
  lead: number,
  latitude: number,
  longitude: number,
): Promise<UvPoint> {
  const at = new Date(run + lead * hourMs).toISOString();
  return limited(async () => {
    const url = `${directory(run)}uv.t12z.grbf${String(lead).padStart(2, '0')}.grib2`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (!response.ok) throw new Error(`NOAA UV HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 8_000_000) throw new Error('Unexpected NOAA file size.');
    const field = splitMessages(bytes)
      .flatMap(parseFields)
      .find((candidate) => {
        const p = parseProduct(candidate.section4);
        return candidate.discipline === 0 && p.parameterCategory === 7 && p.parameterNumber === 196;
      });
    if (!field) throw new Error('NOAA UV field missing.');
    const product = parseProduct(field.section4);
    const id = field.identification;
    const actualRun = Date.UTC(id.year, id.month - 1, id.day, id.hour, id.minute, id.second);
    if (
      product.indicatorOfUnitOfTimeRange !== 1 ||
      actualRun !== run ||
      product.forecastTime !== lead ||
      product.typeOfFirstFixedSurface !== 1
    )
      throw new Error('Unexpected NOAA forecast metadata.');
    const grid = parseGrid(field.section3);
    const { values } = decodeFieldValues(field, { decodeJ2k: await decoder });
    const point = nearestGridpoint(grid, latitude, longitude);
    return { at, index: uvIndex(values[point.index]) };
  });
}

export async function getUv(
  latitude: number,
  longitude: number,
  date: string,
  timezone: string,
  sunset: string | null,
): Promise<UvForecast> {
  const retrievedAt = new Date().toISOString();
  const empty = (status: UvForecast['status']): UvForecast => ({
    status,
    points: [],
    modelRun: null,
    retrievedAt,
    sourceUrl: base,
  });
  const start =
    Math.floor(
      (sunset ? Date.parse(sunset) - 3 * hourMs : localInstant(date, timezone, 16)) / hourMs,
    ) * hourMs;
  if (start > Date.now() + 120 * hourMs) return empty('outside-horizon');
  const current = new Date();
  const latest = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate(),
    12,
  );
  const runs = [latest, latest - 24 * hourMs, latest - 48 * hourMs].filter(
    (run) => run <= Date.now(),
  );
  const hours = Array.from({ length: 8 }, (_, i) => start + i * hourMs);
  const candidates = await Promise.all(
    runs.map(async (run) => {
      try {
        return { run, hours: await available(run) };
      } catch {
        return { run, hours: new Set<number>() };
      }
    }),
  );
  // One model run per chart keeps issue-time provenance clear and avoids mixing forecasts.
  const scored = candidates.map((candidate) => ({
    ...candidate,
    count: hours.filter((at) => candidate.hours.has((at - candidate.run) / hourMs)).length,
  }));
  const chosen =
    scored.find((candidate) => candidate.count === hours.length) ??
    scored.sort((a, b) => b.count - a.count || b.run - a.run)[0];
  if (!chosen?.count) {
    const anyRun = candidates.find((candidate) => candidate.hours.size);
    if (anyRun && start > Math.max(...anyRun.hours) * hourMs + anyRun.run)
      return empty('outside-horizon');
    return empty('unavailable');
  }
  const points = await Promise.all(
    hours.map(async (at) => {
      const lead = (at - chosen.run) / hourMs;
      if (!chosen.hours.has(lead)) return { at: new Date(at).toISOString(), index: null };
      try {
        return await sample(chosen.run, lead, latitude, longitude);
      } catch {
        return { at: new Date(at).toISOString(), index: null };
      }
    }),
  );
  const count = points.filter((point) => point.index !== null).length;
  return {
    status: count === hours.length ? 'available' : count ? 'partial' : 'unavailable',
    points,
    modelRun: new Date(chosen.run).toISOString(),
    retrievedAt,
    sourceUrl: directory(chosen.run),
  };
}
