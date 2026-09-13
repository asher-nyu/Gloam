import { json } from '@sveltejs/kit';
import { requestSchema } from '$lib/domain/validation';
import { dateInZone, nextYear } from '$lib/domain/time';
import { getEvening } from '$lib/server/usno';

export async function GET({ url }) {
  const input = requestSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!input.success)
    return json({ error: 'Choose a valid city, date, and time zone.' }, { status: 400 });
  const { latitude, longitude, date, timezone } = input.data;
  const today = dateInZone(Date.now(), timezone);
  if (date < today || date > nextYear(today))
    return json(
      { error: 'Choose a date from today through the next twelve months.' },
      { status: 400 },
    );
  try {
    return json(await getEvening(latitude, longitude, date, timezone), {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    return json({ error: 'USNO isn’t responding right now. Please try again.' }, { status: 502 });
  }
}
