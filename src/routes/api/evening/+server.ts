import { json } from '@sveltejs/kit';
import { requestSchema } from '$lib/domain/validation';
import { dateInZone, nextYear } from '$lib/domain/time';
import { getEvening } from '$lib/server/usno';

export async function GET({ url }) {
  const headers = { 'Cache-Control': 'no-store' };
  const input = requestSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!input.success)
    return json({ error: 'Choose a valid city, date, and time zone.' }, { status: 400, headers });
  const { latitude, longitude, date, timezone } = input.data;
  const today = dateInZone(Date.now(), timezone);
  if (date < today || date > nextYear(today))
    return json(
      { error: 'Choose a date from today through the next twelve months.' },
      { status: 400, headers },
    );
  try {
    return json(await getEvening(latitude, longitude, date, timezone), {
      headers,
    });
  } catch (error) {
    // Log bounded cause chains, including transport codes, without response bodies or event data.
    const failures = (error instanceof AggregateError ? error.errors : [error]).map(
      (failure: unknown) => {
        const causes = [];
        for (let depth = 0; depth < 4 && failure instanceof Error; depth++) {
          causes.push({
            name: failure.name,
            message: failure.message,
            code: 'code' in failure && typeof failure.code === 'string' ? failure.code : undefined,
          });
          failure = failure.cause;
        }
        return causes;
      },
    );
    console.error('USNO live request failed', JSON.stringify({ failures }));
    return json(
      { error: 'USNO isn’t responding right now. Please try again.' },
      { status: 502, headers },
    );
  }
}
