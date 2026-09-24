// Pages Function: POST /api/pro-activate   body: { orderID }
// 付款完成后激活 Pro 通行证：
//   1) 向 PayPal 核验订单确实已 COMPLETED 且金额为 $5.00
//   2) 一张订单只发一张通行证（防重复激活）
//   3) 通行证 = 随机 token，存 KV：{credits, activated, expires(+30天)}，无任何个人数据
// 前端把 token 存 localStorage，之后每次转写带 x-pass 头。

import { ppToken } from './pro-create-order.js';

const PRICE = '5.00';
const PASS_DAYS = 30;
const PASS_CREDITS = 300;

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const orderID = (body.orderID || '').trim();
  if (!/^[A-Z0-9]+$/.test(orderID)) return json({ error: 'Invalid order' }, 400);
  const KV = env.QUOTA;
  if (!KV || !env.PAYPAL_CLIENT_ID) return json({ error: 'Payments are not configured yet' }, 503);

  // 一单一生：该订单已激活过就直接拒绝
  if (await KV.get('order:' + orderID)) {
    return json({ error: 'This order has already been used' }, 409);
  }

  // 向 PayPal 核验订单
  let d;
  try {
    const token = await ppToken(env);
    const r = await fetch('https://api-m.paypal.com/v2/checkout/orders/' + encodeURIComponent(orderID), {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: 'Order verification failed' }, 502);
  } catch {
    return json({ error: 'Order verification failed' }, 502);
  }

  if (d.status !== 'COMPLETED') return json({ error: 'Payment is not completed yet' }, 402);
  const pu = (d.purchase_units || [])[0] || {};
  const amount = ((pu.payments || {}).captures || [])[0] || {};
  if (amount.amount && !(amount.amount.currency_code === 'USD' && amount.amount.value === PRICE)) {
    return json({ error: 'Unexpected payment amount' }, 402);
  }

  // 发通行证
  const tokenBytes = new Uint8Array(24);
  crypto.getRandomValues(tokenBytes);
  const pass = [...tokenBytes].map(b => b.toString(16).padStart(2, '0')).join('');
  const now = Date.now();
  const expires = now + PASS_DAYS * 24 * 3600 * 1000;
  await KV.put('pass:' + pass, JSON.stringify({
    credits: 0, activated: new Date(now).toISOString(), expires: new Date(expires).toISOString(),
  }), { expirationTtl: (PASS_DAYS + 7) * 24 * 3600 });
  await KV.put('order:' + orderID, pass, { expirationTtl: (PASS_DAYS + 7) * 24 * 3600 });

  return json({ pass, expires: new Date(expires).toISOString(), credits: PASS_CREDITS });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
