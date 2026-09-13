import type { City } from '$lib/domain/types';
import { downloadCities, MIN_CITY_COUNT, validateCityRows } from './city-data.mjs';
import type { CityRow } from './city-data.mjs';

export const CITY_REFRESH_MS = 24 * 60 * 60 * 1000;
export const CITY_RETRY_MS = 15 * 60 * 1000;
export interface CitySnapshot {
  version: 1;
  checkedAt: number;
  rows: CityRow[];
}
export function validateCitySnapshot(
  value: unknown,
  { minCount = MIN_CITY_COUNT, previousCount = 0, now = Date.now() } = {},
): CitySnapshot {
  const snapshot = value as Partial<CitySnapshot> | null;
  if (
    !snapshot ||
    snapshot.version !== 1 ||
    typeof snapshot.checkedAt !== 'number' ||
    !Number.isFinite(snapshot.checkedAt) ||
    snapshot.checkedAt < 0 ||
    snapshot.checkedAt > now + 300_000
  )
    throw new Error('Invalid city cache metadata.');
  return {
    version: 1,
    checkedAt: snapshot.checkedAt,
    rows: validateCityRows(snapshot.rows, { minCount, previousCount }),
  };
}
interface CatalogOptions {
  fallback: CityRow[];
  download?: () => Promise<CityRow[]>;
  load?: () => Promise<unknown>;
  save?: (snapshot: CitySnapshot) => Promise<void>;
  reloadOnRefresh?: boolean;
  now?: () => number;
  minCount?: number;
  report?: (message: string, error: unknown) => void;
}
const countries = new Intl.DisplayNames(['en'], { type: 'region' });
const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
function indexRows(rows: CityRow[]) {
  return rows.map(
    ([id, name, region, countryCode, latitude, longitude, timezone, population, ascii]) => {
      const city: City = {
        id,
        name,
        region,
        countryCode,
        country: countries.of(countryCode) ?? countryCode,
        latitude,
        longitude,
        timezone,
      };
      return {
        city,
        population,
        name: normalize(name),
        search: normalize(`${name} ${ascii}`),
        area: normalize(`${region} ${city.country} ${countryCode}`),
      };
    },
  );
}

/** One catalog per Node process; readers keep the last valid index during refresh. */
export class CityCatalog {
  private records;
  private checkedAt: number | null = null;
  private nextAttemptAt = 0;
  private failures = 0;
  private initialization: Promise<void> | undefined;
  private pending: Promise<void> | undefined;
  private readonly now;
  private readonly minCount;
  private readonly report;

  constructor(private readonly options: CatalogOptions) {
    this.now = options.now ?? Date.now;
    this.minCount = options.minCount ?? MIN_CITY_COUNT;
    this.report = options.report ?? ((message, error) => console.warn(message, error));
    this.records = indexRows(validateCityRows(options.fallback, { minCount: this.minCount }));
  }

  private async restore() {
    if (!this.options.load) return;
    try {
      const value = await this.options.load();
      if (value == null) return;
      const snapshot = validateCitySnapshot(value, {
        minCount: this.minCount,
        previousCount: this.records.length,
        now: this.now(),
      });
      if (this.checkedAt !== null && snapshot.checkedAt <= this.checkedAt) return;
      this.records = indexRows(snapshot.rows);
      this.checkedAt = snapshot.checkedAt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.report('Could not restore the city catalog; keeping the last valid cities.', error);
      }
    }
  }

  private initialize() {
    return (this.initialization ??= this.restore());
  }

  private isFresh() {
    return this.checkedAt !== null && this.now() < this.checkedAt + CITY_REFRESH_MS;
  }

  async refreshIfDue() {
    const initialized = this.initialization !== undefined;
    await this.initialize();
    if (this.pending) return this.pending;
    if (this.isFresh() || this.now() < this.nextAttemptAt) return;
    this.pending = (async () => {
      // Assign the shared promise before even a synchronous downloader failure.
      await Promise.resolve();
      try {
        // Another instance may have refreshed the regional cache since this one loaded it.
        if (initialized && this.options.reloadOnRefresh) await this.restore();
        if (this.isFresh()) {
          this.failures = 0;
          this.nextAttemptAt = 0;
          return;
        }
        const rows = validateCityRows(await (this.options.download ?? downloadCities)(), {
          minCount: this.minCount,
          previousCount: this.records.length,
        });
        const records = indexRows(rows);
        const checkedAt = this.now();
        // The whole replacement is prepared before a reader can observe it.
        this.records = records;
        this.checkedAt = checkedAt;
        this.failures = 0;
        this.nextAttemptAt = 0;
        try {
          await this.options.save?.({ version: 1, checkedAt, rows });
        } catch (error) {
          this.report('City catalog refreshed in memory; its cache could not be saved.', error);
        }
      } catch (error) {
        this.failures++;
        this.nextAttemptAt =
          this.now() + Math.min(CITY_RETRY_MS * 2 ** (this.failures - 1), 6 * 60 * 60 * 1000);
        this.report('City catalog refresh failed; keeping the last valid cities.', error);
      } finally {
        this.pending = undefined;
      }
    })();
    return this.pending;
  }

  async search(query: string, keepAlive?: (work: Promise<void>) => void): Promise<City[]> {
    const clean = query.trim().slice(0, 150);
    if (clean.length < 2) return [];
    const background = this.refreshIfDue();
    keepAlive?.(background);
    await this.initialize();
    const [name, qualifier = ''] = normalize(clean.toUpperCase() === 'NYC' ? 'New York' : clean)
      .split(',')
      .map((part) => part.trim());
    const tokens = name.split(/\s+/);
    return this.records
      .filter(
        (record) =>
          tokens.every((token) => record.search.includes(token)) &&
          (!qualifier || record.area.includes(qualifier)),
      )
      .sort(
        (a, b) =>
          Number(b.name === name) - Number(a.name === name) ||
          Number(b.search.startsWith(name)) - Number(a.search.startsWith(name)) ||
          b.population - a.population,
      )
      .slice(0, 12)
      .map((record) => record.city);
  }

  async find(id: number): Promise<City | null> {
    await this.refreshIfDue();
    return this.records.find((record) => record.city.id === id)?.city ?? null;
  }
}
