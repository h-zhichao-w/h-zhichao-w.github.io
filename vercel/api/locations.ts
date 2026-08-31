import { Redis } from '@upstash/redis';

const ALLOWED_ORIGIN = 'https://h-zhichao-w.github.io';

const redis = Redis.fromEnv();

// 与 collect.ts 保持一致的归一化映射，纠正历史数据中可能遗留的缩写
const CITY_NORMALIZE: Record<string, string> = {
  SG: 'Singapore',
  HK: 'Hong Kong',
  TW: 'Taipei',
  MO: 'Macau',
  KR: 'Seoul',
  JP: 'Tokyo',
  US: 'United States',
  GB: 'London',
  DE: 'Berlin',
  FR: 'Paris',
  AE: 'Dubai',
};

function normalizeCity(city: string, country: string): string {
  const c = city.trim();
  if (!c) return country;
  if (/^[A-Z]{2,3}$/.test(c) && c === country && CITY_NORMALIZE[c]) {
    return CITY_NORMALIZE[c];
  }
  return c;
}

export async function GET(_request: Request) {
  try {
    const keys: string[] = await redis.smembers('loc-index');
    const locations: Array<{
      lat: number;
      lon: number;
      city: string;
      country: string;
      count: number;
    }> = [];

    for (const key of keys) {
      const data = await redis.hgetall<{
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
        city: normalizeCity(data.city || '', data.country || ''),
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