import { Redis } from '@upstash/redis';
import { createHash } from 'crypto';

const ALLOWED_ORIGIN = 'https://h-zhichao-w.github.io';
const UNIQUE_TTL = 7200; // 2 小时，去重标记过期时间（同一访客每小时只计一次）

// 从环境变量自动读取 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN
const redis = Redis.fromEnv();

async function handle(request: Request) {
  try {
    const lat = request.headers.get('x-vercel-ip-latitude');
    const lon = request.headers.get('x-vercel-ip-longitude');
    if (!lat || !lon) {
      return new Response(null, { status: 204 });
    }

    const hour = new Date().toISOString().slice(0, 13); // 如 "2026-08-31T13"
    const ip = request.headers.get('x-forwarded-for') || '';
    const salt = process.env.SALT || '';
    const hash = createHash('sha256').update(salt + ip + hour).digest('hex');

    // 同一访客这一小时内是否已统计
    const uniqueKey = `u:${hour}:${hash}`;
    const seen = await redis.get(uniqueKey);
    if (seen) {
      return new Response(null, { status: 204 });
    }
    await redis.set(uniqueKey, '1', { ex: UNIQUE_TTL });

    const roundedLat = Number(lat).toFixed(2);
    const roundedLon = Number(lon).toFixed(2);
    const rawCity = request.headers.get('x-vercel-ip-city') || '';
    const country = request.headers.get('x-vercel-ip-country') || '';
    // Vercel 偶将城市名返回为 2 字母国家代码（如 SG），归一化为完整名称
    const CITY_ALIAS: Record<string, string> = {
      'SG': 'Singapore',
      'HK': 'Hong Kong',
      'MO': 'Macau',
      'TW': 'Taiwan',
      'MY': 'Malaysia',
      'TH': 'Thailand',
      'ID': 'Indonesia',
      'PH': 'Philippines',
      'VN': 'Vietnam',
      'JP': 'Japan',
      'KR': 'South Korea',
      'US': 'United States',
      'GB': 'United Kingdom',
      'DE': 'Germany',
      'FR': 'France',
      'AU': 'Australia',
      'CA': 'Canada',
      'BR': 'Brazil',
      'IN': 'India',
    };
    const city = CITY_ALIAS[rawCity] || rawCity;
    const locKey = `loc:${roundedLat}:${roundedLon}`;

    // 原子递增计数 & 更新元数据
    await redis.hincrby(locKey, 'count', 1);
    await redis.hset(locKey, {
      lat: String(roundedLat),
      lon: String(roundedLon),
      city,
      country,
    });
    // 把位置 key 加入索引集合，方便 /locations 遍历
    await redis.sadd('loc-index', locKey);

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}

export const GET = handle;
export const POST = handle;