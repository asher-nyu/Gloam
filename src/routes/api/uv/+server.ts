import { json } from '@sveltejs/kit';
import { requestSchema } from '$lib/domain/validation';
import { dateInZone, nextYear } from '$lib/domain/time';
import { getUv } from '$lib/server/noaa';
import { getEvening } from '$lib/server/usno';

export async function GET({ url }) {
  const parsed = requestSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success)
    return json({ error: 'Choose a valid city, date, and time zone.' }, { status: 400 });
  const { latitude, longitude, timezone, date } = parsed.data;
  const today = dateInZone(Date.now(), timezone);
  if (date < today || date > nextYear(today))
    return json({ error: 'Date outside planning range.' }, { status: 400 });
  let sunset: string | null = null;
  try {
    sunset = (await getEvening(latitude, longitude, date, timezone)).events[0].at;
  } catch {
    /* UV remains independent of an astronomy outage. */
  }
  const forecast = await getUv(latitude, longitude, date, timezone, sunset);
  return json(forecast, {
    headers: {
      'Cache-Control': forecast.status === 'unavailable' ? 'no-store' : 'public, max-age=600',
    },
  });
}
