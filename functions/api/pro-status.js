// Pages Function: POST /api/pro-status   body: { pass }
// 前端查询通行证状态：是否有效、剩余 credits、到期时间。

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const pass = (body.pass || '').trim();
  if (!/^[a-f0-9]{48}$/.test(pass) || !env.QUOTA) return json({ valid: false });

  const rec = await env.QUOTA.get('pass:' + pass, 'json');
  if (!rec) return json({ valid: false });
  if (Date.now() > Date.parse(rec.expires)) return json({ valid: false, expired: true });

  return json({ valid: true, credits_left: Math.max(0, 300 - (rec.credits || 0)), expires: rec.expires });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
