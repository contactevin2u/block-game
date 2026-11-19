/* Payment providers. PAYMENT_PROVIDER=chip uses CHIP (chip-in.asia) hosted checkout; =mock simulates it.
   Both expose: createCheckout(order, ctx) -> { checkoutUrl, providerRef } and verify(order) -> 'paid' | 'pending' | 'failed'. */
'use strict';

const PROVIDER = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();

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

const provider = PROVIDER === 'chip' ? chip : mock;
module.exports = { provider, PROVIDER };
