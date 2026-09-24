// Pages Function: POST /api/transcript
// 上游转写通道密钥只存在于服务端环境变量，绝不写入代码 / 前端 / 仓库。
//
// 需要的环境变量（Pages 项目 Settings 里配置）：
//   SUPADATA_API_KEY    Supadata API 密钥（x-api-key 头）
//   SUPADATA_URL        上游地址（可选，默认 https://api.supadata.ai/v1/transcript）
//   PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET   PayPal（Pro 通行证核销用）
//   QUOTA_ADMIN_KEY     /api/usage 查看用量用的管理密钥
// 需要的 KV 绑定（Pages 项目 Settings 里配置）：
//   QUOTA               每日配额计数 + Pro 通行证（未绑定时配额逻辑自动旁路）
//
// 免费档口径（2026-09-14 与站长定稿）：
//   每访客每天 3 次成功转写；每天 30 credits 量闸；单次 ≤10 分钟；
//   无字幕(206) 不扣用户次数/额度，但每访客每天最多放过 3 次；
//   全站每天 120 credits 上限（仅约束免费请求）；所有上游消耗计入访客 credit 量闸。
// Pro 档（$5 / 30 天卡）：
//   300 credits；单次 ≤60 分钟；不受全站日上限与免费双闸约束。
//   通行证 = 服务端签发的随机 token（localStorage 存储，x-pass 头上送），无账号体系。
//   记账方式：两段式请求（native→空字幕(206 或 200 空 content)→generate），上游响应不含 mode 字段，事后无法区分计费口径。

const FREE_USES = 3;            // 成功次数/天
const FREE_CREDITS = 30;        // credit 量闸/天
const FREE_MAX_SEC = 600;       // 免费单次时长上限（10 分钟）
const MISS_FREE = 3;            // 206 免计次放过次数/天
const SITE_DAILY_CREDITS = 120; // 全站每日 credit 上限（仅免费请求受约束）

const PRO_CREDITS = 300;        // Pro 通行证总额度
const PRO_MAX_SEC = 3600;       // Pro 单次时长上限（60 分钟）

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body', code: 'bad_request' }, 400);
  }

  const url = (body.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return json({ error: 'Please provide a valid link', code: 'bad_request' }, 400);
  }

  if (!env.SUPADATA_API_KEY) {
    return json({ error: 'Transcription channel is not configured', code: 'config' }, 503);
  }

  const KV = env.QUOTA || null;
  // 额度日界线按北京时间零点算：UTC+8 之后的日期即北京日历日。
  const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const siteKey = 'site:' + day;
  const site = (KV && (await KV.get(siteKey, 'json'))) || { credits: 0 };

  // ---- Pro 通行证通道 ----
  const pass = request.headers.get('x-pass') || '';
  let pro = null;
  if (pass) {
    if (!KV) return json({ error: 'Pass cannot be validated right now', code: 'config' }, 503);
    if (!/^[a-f0-9]{48}$/.test(pass)) return json({ error: 'Pass not recognized', code: 'bad_pass' }, 403);
    pro = await KV.get('pass:' + pass, 'json');
    if (!pro) return json({ error: 'Pass not recognized', code: 'bad_pass' }, 403);
    if (Date.now() > Date.parse(pro.expires)) {
      return json({ error: 'Your Pro pass has expired. Renew for another 30 days to continue.', code: 'pass_expired', upgrade: true }, 403);
    }
    if ((pro.credits || 0) >= PRO_CREDITS) {
      return json({ error: 'Your 300 Pro credits are used up. Renew for another 30 days to continue.', code: 'paid_quota', upgrade: true }, 429);
    }
  }

  // ---- 免费档双闸 ----
  const ipHash = await sha256((clientIp(request) || 'unknown') + ':' + day);
  const userKey = 'u:' + day + ':' + ipHash;
  const rec = (KV && !pro && (await KV.get(userKey, 'json'))) || { uses: 0, credits: 0, misses: 0 };

  if (!pro && site.credits >= SITE_DAILY_CREDITS) {
    return json({ error: 'Today\'s free capacity is used up site-wide. Please try again tomorrow.', code: 'busy' }, 429);
  }
  if (!pro && (rec.uses >= FREE_USES || rec.credits >= FREE_CREDITS)) {
    return json({
      error: 'You\'ve used today\'s free quota (3 transcriptions or 30 credits per day). Pro gives you 300 credits for 30 days.',
      code: 'quota', upgrade: true,
    }, 429);
  }

  // ---- 两段式上游调用：native→(206 或 200 空字幕)→generate ----
  // 上游对"视频存在但没有原生字幕"有两种表现（2026-09-14 实测）：
  //   206，或 200 + content:[]（Dramatic Chipmunk y8Kyi0WNg40）。两种都必须转 generate。
  // Supadata 免费档限 1 请求/秒：两段之间强制间隔 1.1s，任一请求撞 429 等 1.2s 重试一次。
  const base = (env.SUPADATA_URL || 'https://api.supadata.ai/v1/transcript') +
    '?url=' + encodeURIComponent(url) + '&mode=';
  const upFetch = async (u) => {
    let rr = await fetch(u, { headers: { 'x-api-key': env.SUPADATA_API_KEY } });
    if (rr.status === 429) {
      await new Promise(res => setTimeout(res, 1200));
      rr = await fetch(u, { headers: { 'x-api-key': env.SUPADATA_API_KEY } });
    }
    return rr;
  };
  let r, generated = false, probeCost = 0, parsed = null;
  try {
    r = await upFetch(base + 'native');
    if (r.ok) parsed = await r.json().catch(() => null);
    const nativeEmpty = r.status === 206 ||
      (r.ok && (!parsed || !Array.isArray(parsed.content) || parsed.content.length === 0));
    if (nativeEmpty) {
      probeCost = 1; // 原生探测已消耗 1 credit
      generated = true;
      parsed = null;
      await new Promise(res => setTimeout(res, 1100));
      r = await upFetch(base + 'generate');
    }
  } catch (e) {
    return json({ error: 'Transcription failed: ' + (e.message || 'network error'), code: 'upstream' }, 502);
  }

  if (r.ok && !parsed) parsed = await r.json().catch(() => null);

  // 彻底无转写（连 AI 生成也拿不到/没有语音）。免费用户：不扣次数/额度，每访客每天最多放过 3 次。
  // Pro 用户：同样不扣 credits（探测成本站长认）。
  // 注意：只认 206 或 200+空内容；404/5xx 等非正常响应走下面的上游错误分支，不算 miss。
  const noTranscript = r.status === 206 ||
    (r.ok && (!parsed || ((!Array.isArray(parsed.content) || parsed.content.length === 0) && !parsed.text)));
  if (noTranscript) {
    // 探测/生成尝试的上游消耗（probeCost）计入全站账，免费 miss 不扣用户但全站要记真钱。
    if (KV) { site.credits += probeCost; await KV.put(siteKey, JSON.stringify(site), { expirationTtl: 172800 }); }
    if (pro) {
      // Pro：通行证额度不动
    } else {
      const freeMiss = rec.misses < MISS_FREE;
      if (freeMiss) rec.misses += 1; else { rec.uses += 1; rec.credits += 1; }
      if (KV) { await KV.put(userKey, JSON.stringify(rec), { expirationTtl: 172800 }); }
    }
    return json({
      error: 'No captions or spoken words were found for this link.' +
        (!pro ? ' This did not use your daily quota.' : ''),
      code: 'nocaptions',
    }, 422);
  }

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return json({ error: 'Upstream error (HTTP ' + r.status + ') ' + t.slice(0, 200), code: 'upstream' }, 502);
  }

  let up = parsed;
  if (!up) {
    return json({ error: 'Upstream returned an unreadable response', code: 'upstream' }, 502);
  }

  const out = normalize(up);
  const maxEnd = out.segments.reduce((m, s) => Math.max(m, s.end || 0), 0);

  // credit 记账：原生 1 credit；AI 生成 2 credits/分钟（外加原生探测的 1 credit）。
  const minutes = Math.max(1, Math.ceil(maxEnd / 60));
  const cost = generated ? 1 + 2 * minutes : 1;
  const maxSec = pro ? PRO_MAX_SEC : FREE_MAX_SEC;

  // 时长闸：超长不给结果，上游已花的 credit 照记（免费记访客量闸，Pro 记通行证额度），防刷。
  if (maxEnd > maxSec) {
    if (pro) pro.credits = (pro.credits || 0) + cost; else rec.credits += cost;
    site.credits += cost;
    if (KV) {
      if (pro) await KV.put('pass:' + pass, JSON.stringify(pro), { expirationTtl: 172800 });
      else await KV.put(userKey, JSON.stringify(rec), { expirationTtl: 172800 });
      await KV.put(siteKey, JSON.stringify(site), { expirationTtl: 172800 });
    }
    return json({
      error: 'This video is ' + Math.round(maxEnd / 60) + ' minutes long. ' +
        (pro ? 'Pro allows up to 60 minutes per video.' :
        'Free use is limited to 10 minutes per video — Pro allows up to 60 minutes.'),
      code: pro ? 'length_paid' : 'length', upgrade: !pro,
    }, 422);
  }

  // ---- 计费入库 ----
  let leftUses, leftCredits;
  if (pro) {
    pro.credits = (pro.credits || 0) + cost;
    leftCredits = Math.max(0, PRO_CREDITS - pro.credits);
    if (KV) await KV.put('pass:' + pass, JSON.stringify(pro), { expirationTtl: 172800 });
  } else {
    rec.uses += 1;
    rec.credits += cost;
    leftUses = Math.max(0, FREE_USES - rec.uses);
    leftCredits = Math.max(0, FREE_CREDITS - rec.credits);
    if (KV) await KV.put(userKey, JSON.stringify(rec), { expirationTtl: 172800 });
  }
  site.credits += cost;
  if (KV) await KV.put(siteKey, JSON.stringify(site), { expirationTtl: 172800 });

  return json({
    lang: out.lang,
    text: out.text,
    segments: out.segments,
    pro: !!pro,
    left_uses: leftUses,
    left_credits: leftCredits,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function clientIp(request) {
  return request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
}

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
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
