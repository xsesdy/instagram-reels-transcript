// Pages Function: POST /api/transcript
// 上游转写通道密钥只存在于服务端环境变量，绝不写入代码 / 前端 / 仓库。
//
// 需要的环境变量（Pages 项目 Settings 里配置）：
//   SUPADATA_API_KEY   Supadata API 密钥（x-api-key 头）
//   SUPADATA_URL       上游地址（可选，默认 https://api.supadata.ai/v1/transcript）

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const url = (body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return json({ error: 'Please provide a valid link' }, 400);
  }

  if (!env.SUPADATA_API_KEY) {
    return json({ error: 'Transcription channel is not configured' }, 503);
  }

  try {
    const r = await fetch((env.SUPADATA_URL || 'https://api.supadata.ai/v1/transcript') + '?url=' + encodeURIComponent(url), {
      headers: { 'x-api-key': env.SUPADATA_API_KEY },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('Upstream error (HTTP ' + r.status + ') ' + t.slice(0, 200));
    }
    const up = await r.json();
    return json(normalize(up));
  } catch (e) {
    return json({ error: e.message || 'Transcription failed' }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// ---- 归一化输出：text + segments（start/end/text，秒）----
// Supadata 返回：{ lang, availableLangs, content: [{ text, offset(ms), duration(ms) }] }
function normalize(up) {
  const content = Array.isArray(up.content) ? up.content : [];
  const segments = content.map(s => ({
    start: (s.offset || 0) / 1000,
    end: ((s.offset || 0) + (s.duration || 0)) / 1000,
    text: s.text || '',
  }));
  const text = typeof up.text === 'string' && up.text
    ? up.text
    : segments.map(s => s.text).join(' ').trim();
  return { lang: up.lang || '', text, segments };
}
