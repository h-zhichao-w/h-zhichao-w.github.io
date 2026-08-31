import { kv } from '@vercel/kv';
import { createHash } from 'crypto';

const ALLOWED_ORIGIN = 'https://h-zhichao-w.github.io';
const UNIQUE_TTL = 172800; // 2 天，同一访客每天只计一次

export async function GET(request: Request) {
  try {
    const lat = request.headers.get('x-vercel-ip-latitude');
    const lon = request.headers.get('x-vercel-ip-longitude');
    if (!lat || !lon) {
      return new Response(null, { status: 204 });
    }

    const day = new Date().toISOString().slice(0, 10);
    const ip = request.headers.get('x-forwarded-for') || '';
    const salt = process.env.SALT || '';
    const hash = createHash('sha256').update(salt + ip + day).digest('hex');

    // 同一访客今天是否已统计
    const uniqueKey = `u:${day}:${hash}`;
    const seen = await kv.get(uniqueKey);
    if (seen) {
      return new Response(null, { status: 204 });
    }
    await kv.set(uniqueKey, '1', { ex: UNIQUE_TTL });

    const roundedLat = Number(lat).toFixed(2);
    const roundedLon = Number(lon).toFixed(2);
    const city = request.headers.get('x-vercel-ip-city') || '';
    const country = request.headers.get('x-vercel-ip-country') || '';
    const locKey = `loc:${roundedLat}:${roundedLon}`;

    // 原子递增计数 & 更新元数据
    await kv.hincrby(locKey, 'count', 1);
    await kv.hset(locKey, {
      lat: String(roundedLat),
      lon: String(roundedLon),
      city,
      country,
    });
    // 把位置 key 加入索引集合，方便 /locations 遍历
    await kv.sadd('loc-index', locKey);

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}