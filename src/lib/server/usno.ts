import { getEvening as calculateEvening } from '../usno/evening';
import { requestUsnoTable } from './usno-request';
import type { Evening } from '../domain/types';

export { sourceUrl } from '../usno/evening';

export function getEvening(
  latitude: number,
  longitude: number,
  date: string,
  timezone: string,
): Promise<Evening> {
  return calculateEvening(latitude, longitude, date, timezone, requestUsnoTable);
}
