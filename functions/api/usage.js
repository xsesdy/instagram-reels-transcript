// Pages Function: GET /api/usage?key=QUOTA_ADMIN_KEY
// 管理端点：返回当日全站用量汇总，供站长/告警脚本检查。
// 未配置密钥或密钥不对时一律 404，不暴露存在性。

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if (!env.QUOTA_ADMIN_KEY || key !== env.QUOTA_ADMIN_KEY) {
    return new Response('Not found', { status: 404 });
  }
  const KV = env.QUOTA;
  if (!KV) return json({ error: 'quota storage not bound' }, 503);

  // 与 transcript.js 同一日界线：北京时间零点（UTC+8）。
  const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  let users = 0, totalUses = 0, totalCredits = 0, totalMisses = 0;
  let cursor;
  do {
    const page = await KV.list({ prefix: 'u:' + day + ':', cursor });
    for (const k of page.keys) {
      const v = await KV.get(k.name, 'json');
      if (v) { users += 1; totalUses += v.uses || 0; totalCredits += v.credits || 0; totalMisses += v.misses || 0; }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const site = (await KV.get('site:' + day, 'json')) || { credits: 0 };
  return json({
    date: day,
    site_credits_today: site.credits || 0,
    site_daily_cap: 120,
    visitors: users,
    total_successful: totalUses,
    total_credits_spent: totalCredits,
    nocaption_misses: totalMisses,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
