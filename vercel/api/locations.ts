import { kv } from '@vercel/kv';

const ALLOWED_ORIGIN = 'https://h-zhichao-w.github.io';

export async function GET(request: Request) {
  try {
    const keys: string[] = await kv.smembers('loc-index');
    const locations: Array<{
      lat: number;
      lon: number;
      city: string;
      country: string;
      count: number;
    }> = [];

    for (const key of keys) {
      const data = await kv.hgetall<{
        lat: string;
        lon: string;
        city: string;
        country: string;
        count: string;
      }>(key);
      if (!data) continue;
      locations.push({
        lat: Number(data.lat),
        lon: Number(data.lon),
        city: data.city || '',
        country: data.country || '',
        count: Number(data.count) || 0,
      });
    }

    return new Response(JSON.stringify({ locations }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': ALLOWED_ORIGIN,
        'cache-control': 'no-store',
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ locations: [] }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': ALLOWED_ORIGIN,
        },
      },
    );
  }
}