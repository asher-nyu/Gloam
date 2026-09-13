import { json } from '@sveltejs/kit';
import { waitUntil } from '@vercel/functions';
import { cityCatalog } from '$lib/server/cities';

export async function GET({ url }) {
  // Each request reaches the catalog so due refreshes and new records are visible.
  const headers = { 'Cache-Control': 'no-store' };
  if (url.searchParams.has('id')) {
    const input = url.searchParams.get('id') ?? '';
    const id = Number(input);
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(id) || id <= 0) {
      return json({ city: null }, { status: 400, headers });
    }
    return json({ city: await cityCatalog.find(id) }, { headers });
  }
  return json(
    {
      cities: await cityCatalog.search(
        url.searchParams.get('q') ?? '',
        process.env.VERCEL === '1' ? waitUntil : undefined,
      ),
    },
    { headers },
  );
}
