/**
 * 访客足迹统计 Worker
 * - 只记录 Cloudflare 提供的粗粒度地理位置（城市级经纬度），不存储任何 IP
 * - 同一访客每天只计一次（以 SALT + IP + 日期的哈希判断，哈希不可逆）
 * - GET /collect  : 页面上的像素信号，记录一次访问（无响应体）
 * - GET /locations: 返回聚合后的位置列表（仅允许站点域名跨域读取）
 *
 * 部署后需绑定：
 *   KV 命名空间 -> 变量名 VISITS
 *   Secret      -> SALT（任意随机字符串，用于哈希脱敏）
 */

const ALLOWED_ORIGIN = 'https://h-zhichao-w.github.io';
const UNIQUE_TTL = 172800; // 访客去重记录保留 2 天

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/locations') {
      const locations = await aggregate(env);
      return new Response(JSON.stringify({ locations }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': ALLOWED_ORIGIN,
          'cache-control': 'no-store',
        },
      });
    }

    if (url.pathname === '/collect') {
      try { await recordVisit(request, env); } catch (e) { /* 统计失败不影响页面 */ }
      return new Response(null, { status: 204 });
    }

    return new Response('not found', { status: 404 });
  },
};

async function recordVisit(request, env) {
  const cf = request.cf || {};
  if (cf.latitude == null || cf.longitude == null) return;

  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('cf-connecting-ip') || '';
  const hash = await sha256Hex((env.SALT || '') + ip + day);

  const uniqueKey = `u:${day}:${hash}`;
  const seen = await env.VISITS.get(uniqueKey);
  if (seen) return; // 该访客今天已统计过

  await env.VISITS.put(uniqueKey, '1', { expirationTtl: UNIQUE_TTL });

  const lat = Number(cf.latitude).toFixed(2);   // 只保留约公里级精度
  const lon = Number(cf.longitude).toFixed(2);
  const key = `v:${day}:${lat}:${lon}`;
  const cur = JSON.parse((await env.VISITS.get(key)) || '{"count":0}');
  cur.count += 1;
  cur.city = cf.city || '';
  cur.country = cf.country || '';
  await env.VISITS.put(key, JSON.stringify(cur));
}

async function aggregate(env) {
  const byLoc = {};
  let cursor;
  do {
    const page = await env.VISITS.list({ prefix: 'v:', cursor });
    for (const k of page.keys) {
      const raw = await env.VISITS.get(k.name);
      if (!raw) continue;
      const val = JSON.parse(raw);
      const [, , lat, lon] = k.name.split(':');
      const id = `${lat}:${lon}`;
      if (!byLoc[id]) {
        byLoc[id] = { lat: Number(lat), lon: Number(lon), city: val.city, country: val.country, count: 0 };
      }
      byLoc[id].count += val.count;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return Object.values(byLoc);
}

async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
