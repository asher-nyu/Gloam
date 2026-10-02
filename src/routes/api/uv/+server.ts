import { json } from '@sveltejs/kit';
import { Temporal } from '@js-temporal/polyfill';
import { requestSchema } from '$lib/domain/validation';
import { dateInZone, nextYear } from '$lib/domain/time';
import { getUv } from '$lib/server/noaa';

export async function GET({ url }) {
  const headers = { 'Cache-Control': 'no-store' };
  const parsed = requestSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success)
    return json({ error: 'Choose a valid city, date, and time zone.' }, { status: 400, headers });
  const { latitude, longitude, timezone, date } = parsed.data;
  const today = dateInZone(Date.now(), timezone);
  if (date < today || date > nextYear(today))
    return json({ error: 'Date outside planning range.' }, { status: 400, headers });
  let sunset: string | null = null;
  const suppliedSunset = url.searchParams.get('sunset');
  if (suppliedSunset !== null) {
    try {
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
          suppliedSunset,
        )
      )
        throw new Error('Invalid sunset instant.');
      const instant = Temporal.Instant.from(suppliedSunset);
      if (dateInZone(instant.epochMilliseconds, timezone) !== date)
        throw new Error('Sunset does not belong to the selected date.');
      sunset = instant.toString({ smallestUnit: 'millisecond' });
    } catch {
      return json(
        { error: 'Choose a valid sunset time for the selected date and city.' },
        { status: 400, headers },
      );
    }
  }
  const forecast = await getUv(latitude, longitude, date, timezone, sunset);
  return json(forecast, {
    headers,
  });
}
