// Pages Function: POST /api/pro-create-order
// 创建一笔 $5 的一次性 PayPal 订单（igscript Pro 30 天卡）。
// 中国跨境商户账户未开通 Subscriptions API，先卖 30 天卡，后续可换订阅。

const PRICE = '5.00';
const DESC = 'igscript Pro - 30 days';

export async function onRequestPost({ env }) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    return json({ error: 'Payments are not configured yet' }, 503);
  }
  try {
    const token = await ppToken(env);
    const r = await fetch('https://api-m.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: PRICE }, description: DESC }],
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.id) return json({ error: 'Payment initiation failed' }, 502);
    return json({ id: d.id });
  } catch {
    return json({ error: 'Payment initiation failed' }, 502);
  }
}

export async function ppToken(env) {
  const auth = btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET);
  const r = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('token failed');
  return d.access_token;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
