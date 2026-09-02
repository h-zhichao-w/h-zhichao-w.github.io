import { Redis } from '@upstash/redis';

const ALLOWED_ORIGIN = 'https://h-zhichao-w.github.io';

const redis = Redis.fromEnv();

function decodeStoredValue(value: string): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
        // 兼容修复前已写入 Redis 的 Council%20Bluffs 等 URL 编码城市名
        city: decodeStoredValue(data.city || ''),
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
