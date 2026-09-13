import { createHash } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { RuntimeCache } from '@vercel/functions';
import { validateCitySnapshot, type CitySnapshot } from './city-catalog';
import { MIN_CITY_COUNT } from './city-data.mjs';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
export const CITY_CACHE_CHUNK_CHARS = 1024 * 1024;
export const CITY_CACHE_MAX_JSON_BYTES = 25 * 1024 * 1024;
const maxCompressedBytes = 26 * 1024 * 1024;
const manifestKey = 'geonames-v1:manifest';
const retentionSeconds = 7 * 24 * 60 * 60;
type Cache = Pick<RuntimeCache, 'get' | 'set'>;
interface Manifest {
  version: 1;
  encoding: 'gzip-base64';
  revision: string;
  parts: number;
  compressedBytes: number;
  jsonBytes: number;
}
interface SharedCacheOptions {
  timeoutMs?: number;
  minCount?: number;
  now?: () => number;
}

/** Hobby accounts share storage across projects; never use an unscoped city key. */
export function cityCacheNamespace(environment: Record<string, string | undefined>): string {
  const project = environment.VERCEL_PROJECT_ID || environment.VERCEL_PROJECT_PRODUCTION_URL;
  if (!project) throw new Error('A Vercel project identifier is required for the city cache.');
  return `gloam:${project}:cities:v1`;
}

export const cityCacheKeyHash = (key: string) => createHash('sha256').update(key).digest('hex');
const partKey = (revision: string, index: number) => `geonames-v1:${revision}:${index}`;

function validateManifest(value: unknown): Manifest {
  const manifest = value as Partial<Manifest> | null;
  if (
    !manifest ||
    manifest.version !== 1 ||
    manifest.encoding !== 'gzip-base64' ||
    typeof manifest.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.revision) ||
    !Number.isSafeInteger(manifest.jsonBytes) ||
    manifest.jsonBytes! <= 0 ||
    manifest.jsonBytes! > CITY_CACHE_MAX_JSON_BYTES ||
    !Number.isSafeInteger(manifest.compressedBytes) ||
    manifest.compressedBytes! <= 0 ||
    manifest.compressedBytes! > maxCompressedBytes ||
    !Number.isSafeInteger(manifest.parts) ||
    manifest.parts !==
      Math.ceil((Math.ceil(manifest.compressedBytes! / 3) * 4) / CITY_CACHE_CHUNK_CHARS)
  )
    throw new Error('Invalid shared city cache manifest.');
  return manifest as Manifest;
}

/** Regional, evictable storage: only complete, verified snapshots are accepted. */
export class SharedCityCache {
  private readonly timeoutMs;
  private readonly minCount;
  private readonly now;

  constructor(
    private readonly getCache: () => Cache,
    options: SharedCacheOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.minCount = options.minCount ?? MIN_CITY_COUNT;
    this.now = options.now ?? Date.now;
  }

  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Shared city cache request timed out.')),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async load(): Promise<CitySnapshot | null> {
    const cache = this.getCache();
    const value = await this.bounded(cache.get(manifestKey));
    if (value == null) return null;
    const manifest = validateManifest(value);
    const parts = await this.bounded(
      Promise.all(
        Array.from({ length: manifest.parts }, (_, index) =>
          cache.get(partKey(manifest.revision, index)),
        ),
      ),
    );
    if (
      parts.some(
        (part, index) =>
          typeof part !== 'string' ||
          !part.length ||
          part.length > CITY_CACHE_CHUNK_CHARS ||
          (index < parts.length - 1 && part.length !== CITY_CACHE_CHUNK_CHARS),
      )
    ) {
      throw new Error('Shared city cache snapshot is incomplete.');
    }
    const encoded = parts.join('');
    if (encoded.length !== Math.ceil(manifest.compressedBytes / 3) * 4)
      throw new Error('Invalid shared city cache length.');
    const bytes = Buffer.from(encoded, 'base64');
    if (
      bytes.length !== manifest.compressedBytes ||
      bytes.toString('base64') !== encoded ||
      cityCacheKeyHash(bytes.toString('base64')) !== manifest.revision
    ) {
      throw new Error('Shared city cache checksum mismatch.');
    }
    const json = await decompress(bytes, { maxOutputLength: manifest.jsonBytes });
    if (json.length !== manifest.jsonBytes)
      throw new Error('Invalid shared city cache decompressed length.');
    const snapshot: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
    return validateCitySnapshot(snapshot, { minCount: this.minCount, now: this.now() });
  }

  async save(value: CitySnapshot): Promise<void> {
    const snapshot = validateCitySnapshot(value, { minCount: this.minCount, now: this.now() });
    const json = Buffer.from(JSON.stringify(snapshot));
    if (json.length > CITY_CACHE_MAX_JSON_BYTES)
      throw new Error('City snapshot exceeds the shared cache size limit.');
    const bytes = await compress(json);
    if (bytes.length > maxCompressedBytes)
      throw new Error('Compressed city snapshot exceeds the shared cache size limit.');
    const encoded = bytes.toString('base64');
    const revision = cityCacheKeyHash(encoded);
    const parts = Array.from(
      { length: Math.ceil(encoded.length / CITY_CACHE_CHUNK_CHARS) },
      (_, index) =>
        encoded.slice(index * CITY_CACHE_CHUNK_CHARS, (index + 1) * CITY_CACHE_CHUNK_CHARS),
    );
    const cache = this.getCache();
    await this.bounded(
      Promise.all(
        parts.map((part, index) =>
          cache.set(partKey(revision, index), part, {
            ttl: retentionSeconds + 24 * 60 * 60,
            name: 'Gloam city catalog chunk',
          }),
        ),
      ),
    );
    // A dropped write must not replace the pointer to the last complete snapshot.
    const stored = await this.bounded(
      Promise.all(parts.map((_part, index) => cache.get(partKey(revision, index)))),
    );
    if (stored.some((part, index) => part !== parts[index]))
      throw new Error('Shared city cache did not retain every chunk.');
    const manifest: Manifest = {
      version: 1,
      encoding: 'gzip-base64',
      revision,
      parts: parts.length,
      compressedBytes: bytes.length,
      jsonBytes: json.length,
    };
    await this.bounded(
      cache.set(manifestKey, manifest, { ttl: retentionSeconds, name: 'Gloam city catalog' }),
    );
  }
}
