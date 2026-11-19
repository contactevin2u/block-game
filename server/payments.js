/* Payment providers. PAYMENT_PROVIDER=chip uses CHIP (chip-in.asia) hosted checkout; =mock simulates it.
   Both expose: createCheckout(order, ctx) -> { checkoutUrl, providerRef } and verify(order) -> 'paid' | 'pending' | 'failed'. */
'use strict';
global.window = global.window || {}; require('../js/config.js');
const GAME_NAME = process.env.GAME_NAME || global.window.CONFIG.GAME_NAME;

// Production is any Render service (RENDER=true) or NODE_ENV=production. There, mock may never run and a real
// provider refuses to start without its keys. Unset in production means 'none': the server runs, purchases are closed.
const PRODUCTION = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const PROVIDER = (process.env.PAYMENT_PROVIDER || (PRODUCTION ? 'none' : 'mock')).toLowerCase();
const PAYMENTS_ENABLED = /^(1|true|yes|on)$/i.test(process.env.PAYMENTS_ENABLED || '');
// DEMO_MODE=true lets the simulated checkout run on a public server, clearly labelled, with no real money.
const DEMO_MODE = /^(1|true|yes|on)$/i.test(process.env.DEMO_MODE || '');
function fatal(msg) { console.error('[payments] ' + msg); process.exit(1); }
if (PRODUCTION && PROVIDER === 'mock' && !DEMO_MODE) fatal('PAYMENT_PROVIDER=mock is not allowed in production unless DEMO_MODE=true. Set it to none, ipay88 or chip.');
if (PROVIDER === 'chip' && !(process.env.CHIP_BRAND_ID && process.env.CHIP_SECRET_KEY)) fatal('PAYMENT_PROVIDER=chip needs CHIP_BRAND_ID and CHIP_SECRET_KEY.');
if (PROVIDER === 'ipay88' && !(process.env.IPAY88_MERCHANT_CODE && process.env.IPAY88_MERCHANT_KEY)) fatal('PAYMENT_PROVIDER=ipay88 needs IPAY88_MERCHANT_CODE and IPAY88_MERCHANT_KEY.');
if (PROVIDER === 'boost' && !(process.env.BCPG_BASE_URL && process.env.BCPG_CLIENT_ID && process.env.BCPG_CLIENT_SECRET)) fatal('PAYMENT_PROVIDER=boost needs BCPG_BASE_URL, BCPG_CLIENT_ID and BCPG_CLIENT_SECRET.');
if (!['mock', 'none', 'chip', 'ipay88', 'boost'].includes(PROVIDER)) fatal('Unknown PAYMENT_PROVIDER "' + PROVIDER + '".');

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
      ProdDesc: order.name, UserName: ctx.email.split('@')[0].slice(0, 100), UserEmail: ctx.email, UserContact: '-', Remark: (GAME_NAME + ' order ' + order.id).slice(0, 100),
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
function amountToCents(s) {
  if (typeof s === 'number') { if (!isFinite(s)) return null; const c = s * 100; return Math.abs(c - Math.round(c)) < 1e-6 ? Math.round(c) : null; }
  const m = String(s == null ? '' : s).trim().match(/^(\d+)\.(\d{2})$/); return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : null;
}

// Boost's amount in cents: a number or a numeric string ("12.9", "12.90", 12.9). AutoCount's centsOf does the same.
function boostCents(a) {
  if (a === null || a === undefined || typeof a === 'boolean' || String(a).trim() === '') return null;
  const n = Number(a);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
// Any value Boost puts in "reversed" counts (true, a date, an id), except an explicit false.
function isReversed(v) {
  if (v === undefined || v === null || v === false || v === 0) return false;
  const t = String(v).trim().toLowerCase();
  return !(t === '' || t === 'false' || t === '0' || t === 'null');
}

// Boost Connect (BCPG). Production only, no sandbox: tests run against a fake server set by BCPG_BASE_URL.
// Rules followed exactly as given: Basic auth over an HMAC of METHOD + bare path + the exact body bytes;
// init with a fresh LZ- reference each attempt; the read-back is the only thing that decides a payment.
const boost = {
  name: 'boost',
  METHODS: ['boost', 'tng', 'fpx', 'card'],
  base() { return (process.env.BCPG_BASE_URL || '').replace(/\/+$/, ''); },
  // The signed path is the bare /v1/... path, without the /gateway part of the base URL.
  sign(method, path, body) {
    const mac = crypto.createHmac('sha256', process.env.BCPG_CLIENT_SECRET || '').update(method + path + body).digest('base64');
    return 'Basic ' + Buffer.from((process.env.BCPG_CLIENT_ID || '') + ':' + mac).toString('base64');
  },
  async call(method, path, body) {
    const bytes = body === undefined ? '' : body;
    const r = await fetch(this.base() + path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: this.sign(method, path, bytes) }, body: method === 'GET' ? undefined : bytes, signal: AbortSignal.timeout(parseInt(process.env.BCPG_TIMEOUT_MS || '15000', 10)) });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) {}
    return { status: r.status, json, text };
  },
  // Same shape as the references AutoCount's portal has used live on this merchant (B2B-118-520FCFBB):
  // letters, digits and hyphens only. The order id's underscore is dropped.
  reference(orderId) { return 'LZ-' + String(orderId).replace(/[^A-Za-z0-9]/g, '').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase(); },
  description(name) { return String(name || 'Linezu purchase').replace(/[^A-Za-z0-9 .-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Linezu purchase'; },
  // Body is built by hand so the amount keeps two decimals as a JSON number, and so the signed bytes are the sent bytes.
  initBody(order, ctx) {
    const created = new Date(Date.now() - 10000).toISOString(); // Boost's clock runs 8-9 s behind
    return '{"referenceId":' + JSON.stringify(order.reference_id) +
      ',"amount":' + (order.price_cents / 100).toFixed(2) +
      ',"currency":"MYR","created":' + JSON.stringify(created) +
      ',"description":' + JSON.stringify(this.description(order.name)) +
      ',"paymentMethod":' + JSON.stringify(order.method) +
      ',"returnUrl":' + JSON.stringify(ctx.baseUrl + '/api/payments/boost/return?ref=' + encodeURIComponent(order.reference_id)) +
      ',"callbackUrl":' + JSON.stringify(ctx.apiUrl + '/api/payments/boost/callback') + '}';
  },
  async createCheckout(order, ctx) {
    if (!this.METHODS.includes(order.method)) throw new Error('Pick Boost, Touch \'n Go, Online banking or Card.');
    if (!/^https:\/\//.test(ctx.baseUrl) || !/^https:\/\//.test(ctx.apiUrl)) throw new Error('BASE_URL and API_URL must be https for Boost');
    order.reference_id = order.reference_id || this.reference(order.id);
    if (order.price_cents <= 0) throw new Error('Amount must be more than 0');
    const body = this.initBody(order, ctx);
    const r = await this.call('POST', '/v1/payments/init', body); // never retried with the same reference
    if (r.status !== 200 || !r.json) throw new Error('Boost init failed ' + r.status + (r.text ? ': ' + r.text.slice(0, 200) : ' (no body)'));
    if (r.json.referenceId !== order.reference_id) throw new Error('Boost returned a different referenceId');
    if (!/^https:\/\//.test(String(r.json.paymentUrl || ''))) throw new Error('Boost paymentUrl is not https');
    if (!r.json.uuid) throw new Error('Boost reply has no uuid');
    return { checkoutUrl: r.json.paymentUrl, providerRef: String(r.json.uuid), referenceId: order.reference_id };
  },
  // Read-back. Returns 'paid' only when everything agrees; 'review' when Boost says succeeded but something does not.
  async verify(order) {
    this.lastReason = '';
    if (!order.reference_id) return 'pending';
    const r = await this.call('GET', '/v1/payments/refs/' + encodeURIComponent(order.reference_id));
    if (r.status === 404) return 'pending';
    if (r.status !== 200 || !r.json) throw new Error('Boost read-back failed ' + r.status);
    const p = r.json, st = String(p.status || '').toLowerCase();
    if (st === 'succeeded') {
      const problems = [];
      if (String(p.uuid || '') !== String(order.provider_ref || '')) problems.push('uuid mismatch');
      const cents = boostCents(p.amount);
      if (cents === null || cents !== order.price_cents) problems.push('amount mismatch: got ' + p.amount + ', expected ' + (order.price_cents / 100).toFixed(2));
      // A missing currency is MYR, as in AutoCount's portal; only a different currency is a problem.
      if (String(p.currency || 'MYR').trim().toUpperCase() !== 'MYR') problems.push('currency mismatch: ' + p.currency);
      if (isReversed(p.reversed)) problems.push('reversed (' + String(p.reversed).slice(0, 60) + ')');
      if (problems.length) { this.lastReason = problems.join('; '); return 'review'; }
      return 'paid';
    }
    if (['canceled', 'cancelled', 'expired', 'failed', 'denied', 'error'].includes(st)) { this.lastReason = 'Boost status ' + st; return 'failed'; }
    return 'pending';
  }
};

const provider = PROVIDER === 'chip' ? chip : PROVIDER === 'ipay88' ? ipay88 : PROVIDER === 'boost' ? boost : PROVIDER === 'none' ? none : mock;
module.exports = { provider, PROVIDER, PRODUCTION, PAYMENTS_ENABLED, DEMO_MODE: DEMO_MODE && PROVIDER === 'mock', ipay88, boost, amountToCents };
