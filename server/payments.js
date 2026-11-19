/* Payment providers. PAYMENT_PROVIDER=chip uses CHIP (chip-in.asia) hosted checkout; =mock simulates it.
   Both expose: createCheckout(order, ctx) -> { checkoutUrl, providerRef } and verify(order) -> 'paid' | 'pending' | 'failed'. */
'use strict';

// Production is any Render service (RENDER=true) or NODE_ENV=production. There, mock may never run and a real
// provider refuses to start without its keys. Unset in production means 'none': the server runs, purchases are closed.
const PRODUCTION = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const PROVIDER = (process.env.PAYMENT_PROVIDER || (PRODUCTION ? 'none' : 'mock')).toLowerCase();
const PAYMENTS_ENABLED = /^(1|true|yes|on)$/i.test(process.env.PAYMENTS_ENABLED || '');
function fatal(msg) { console.error('[payments] ' + msg); process.exit(1); }
if (PRODUCTION && PROVIDER === 'mock') fatal('PAYMENT_PROVIDER=mock is not allowed in production. Set it to none, ipay88 or chip.');
if (PROVIDER === 'chip' && !(process.env.CHIP_BRAND_ID && process.env.CHIP_SECRET_KEY)) fatal('PAYMENT_PROVIDER=chip needs CHIP_BRAND_ID and CHIP_SECRET_KEY.');
if (PROVIDER === 'ipay88' && !(process.env.IPAY88_MERCHANT_CODE && process.env.IPAY88_MERCHANT_KEY)) fatal('PAYMENT_PROVIDER=ipay88 needs IPAY88_MERCHANT_CODE and IPAY88_MERCHANT_KEY.');
if (!['mock', 'none', 'chip', 'ipay88'].includes(PROVIDER)) fatal('Unknown PAYMENT_PROVIDER "' + PROVIDER + '".');

const none = {
  name: 'none',
  async createCheckout() { throw new Error('Purchases are not open yet.'); },
  async verify() { return 'pending'; }
};

const mock = {
  name: 'mock',
  async createCheckout(order, ctx) { return { checkoutUrl: ctx.baseUrl + '/#/checkout/' + order.id, providerRef: 'mock_' + order.id }; },
  async verify() { return 'pending'; }
};

// CHIP: https://gate.chip-in.asia  (Collect API). Needs CHIP_BRAND_ID and CHIP_SECRET_KEY from the merchant portal.
const chip = {
  name: 'chip',
  base: process.env.CHIP_API_BASE || 'https://gate.chip-in.asia/api/v1',
  headers() { return { Authorization: `Bearer ${process.env.CHIP_SECRET_KEY}`, 'Content-Type': 'application/json' }; },
  async createCheckout(order, ctx) {
    if (!process.env.CHIP_BRAND_ID || !process.env.CHIP_SECRET_KEY) throw new Error('CHIP_BRAND_ID and CHIP_SECRET_KEY must be set');
    const body = {
      brand_id: process.env.CHIP_BRAND_ID,
      client: { email: ctx.email },
      purchase: { currency: 'MYR', products: [{ name: order.name, price: order.price_cents, quantity: 1 }] },
      reference: order.id,
      success_redirect: ctx.baseUrl + '/#/pay/return/' + order.id,
      failure_redirect: ctx.baseUrl + '/#/pay/return/' + order.id,
      cancel_redirect: ctx.baseUrl + '/#/pay/return/' + order.id,
      success_callback: (ctx.apiUrl || ctx.baseUrl) + '/api/payments/chip/callback'
    };
    const r = await fetch(this.base + '/purchases/', { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error('CHIP create failed ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const p = await r.json();
    return { checkoutUrl: p.checkout_url, providerRef: p.id };
  },
  // Always re-check with CHIP's API instead of trusting a callback body.
  async verify(order) {
    if (!order.provider_ref) return 'pending';
    const r = await fetch(this.base + '/purchases/' + order.provider_ref + '/', { headers: this.headers() });
    if (!r.ok) return 'pending';
    const p = await r.json();
    if (p.status === 'paid') return 'paid';
    if (['error', 'cancelled', 'expired', 'blocked'].includes(p.status)) return 'failed';
    return 'pending';
  }
};

// iPay88 (now ADAPTIS). The player is sent to iPay88's page by a browser form POST; iPay88 posts the result back to
// ResponseURL (browser) and BackendURL (server to server). Every result is verified by signature and by a re-query.
const crypto = require('crypto');
const ipay88 = {
  name: 'ipay88',
  entry: process.env.IPAY88_ENTRY_URL || 'https://payment.ipay88.com.my/ePayment/entry.asp',
  requery: process.env.IPAY88_REQUERY_URL || 'https://payment.ipay88.com.my/ePayment/enquiry.asp',
  algo: (process.env.IPAY88_SIG_ALGO || 'sha256').toLowerCase(),
  code() { return process.env.IPAY88_MERCHANT_CODE || ''; },
  key() { return process.env.IPAY88_MERCHANT_KEY || ''; },
  amount(cents) { return (cents / 100).toFixed(2); },
  sign(parts) { return crypto.createHash(this.algo).update(parts.join('')).digest('hex'); },
  requestSignature(order) { return this.sign([this.key(), this.code(), order.id, this.amount(order.price_cents).replace(/[.,]/g, ''), 'MYR']); },
  responseSignature(f) { return this.sign([this.key(), this.code(), f.PaymentId || '', f.RefNo || '', String(f.Amount || '').replace(/[.,]/g, ''), f.Currency || 'MYR', f.Status || '']); },
  validResponse(f) { const a = String(f.Signature || '').toLowerCase(), b = this.responseSignature(f).toLowerCase(); return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); },
  async createCheckout(order, ctx) {
    if (!this.code() || !this.key()) throw new Error('IPAY88_MERCHANT_CODE and IPAY88_MERCHANT_KEY must be set');
    // The start page lives on the game's own address (proxied to this server), so the player's session cookie is sent.
    return { checkoutUrl: ctx.baseUrl + '/api/payments/ipay88/start/' + order.id, providerRef: null };
  },
  // Hidden form that submits itself to iPay88.
  startForm(order, ctx) {
    const fields = {
      MerchantCode: this.code(), PaymentId: '', RefNo: order.id, Amount: this.amount(order.price_cents), Currency: 'MYR',
      ProdDesc: order.name, UserName: ctx.email.split('@')[0].slice(0, 100), UserEmail: ctx.email, UserContact: '-', Remark: 'tetris.io order ' + order.id,
      Lang: 'UTF-8', SignatureType: this.algo.toUpperCase(), Signature: this.requestSignature(order),
      ResponseURL: ctx.baseUrl + '/api/payments/ipay88/response', BackendURL: ctx.apiUrl + '/api/payments/ipay88/backend'
    };
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting to iPay88</title></head><body style="font-family:sans-serif;padding:40px;text-align:center">
<p>Taking you to the secure payment page</p>
<form id="f" method="post" action="${esc(this.entry)}">${Object.keys(fields).map((k) => `<input type="hidden" name="${esc(k)}" value="${esc(fields[k])}">`).join('')}
<noscript><button type="submit">Continue to payment</button></noscript></form>
<script>document.getElementById('f').submit();</script></body></html>`;
  },
  async verify(order) {
    const body = new URLSearchParams({ MerchantCode: this.code(), RefNo: order.id, Amount: this.amount(order.price_cents) });
    const r = await fetch(this.requery, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const t = (await r.text()).trim();
    if (t === '00') return 'paid';
    if (/fail|invalid|incorrect|not found|m88admin/i.test(t)) return t.toLowerCase().includes('not found') ? 'pending' : 'failed';
    return 'pending';
  }
};

// Exact cents from an iPay88 amount string such as "12.99". Returns null for anything else: no rounding, no guessing.
function amountToCents(s) { const m = String(s == null ? '' : s).trim().match(/^(\d+)\.(\d{2})$/); return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : null; }

const provider = PROVIDER === 'chip' ? chip : PROVIDER === 'ipay88' ? ipay88 : PROVIDER === 'none' ? none : mock;
module.exports = { provider, PROVIDER, PRODUCTION, PAYMENTS_ENABLED, ipay88, amountToCents };
