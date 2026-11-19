// Payment safety tests against a fake iPay88. Run: node test/payments.test.js
// Covers: price tampering, successful payment, duplicate callback, bad signature, wrong amount, wrong currency,
// failed payment, unknown order, the PENDING re-check job, the PAYMENTS_ENABLED switch, and the production guards.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CODE = 'M00001', KEY = 'testkey';
let fails = 0;
function check(name, cond) { if (!cond) { fails++; console.log('FAIL ' + name); } else console.log('ok   ' + name); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (parts) => crypto.createHash('sha256').update(parts.join('')).digest('hex');

// ---- fake iPay88: the enquiry endpoint answers per order id ----
const paidOrders = new Set();
const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const p = new URLSearchParams(body);
    if (req.url.startsWith('/enquiry')) { res.end(paidOrders.has(p.get('RefNo')) ? '00' : 'Record not found'); return; }
    res.end('fake entry');
  });
});

function startServer(extraEnv) {
  const port = 4200 + Math.floor(Math.random() * 500);
  const dbPath = path.join(os.tmpdir(), 'bg-pay-' + Date.now() + '-' + port + '.db');
  const base = Object.assign({}, process.env);
  delete base.RENDER; delete base.NODE_ENV; delete base.PAYMENT_PROVIDER; delete base.PAYMENTS_ENABLED;
  const env = Object.assign(base, { PORT: String(port), DB_PATH: dbPath, EMAIL_PROVIDER: 'console', BASE_URL: 'http://127.0.0.1:' + port, SESSION_DAYS: '30' }, extraEnv);
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const s = { proc, port, base: 'http://127.0.0.1:' + port, dbPath, code: null, log: () => log, stop() { proc.kill(); try { fs.unlinkSync(dbPath); fs.unlinkSync(dbPath + '-wal'); fs.unlinkSync(dbPath + '-shm'); } catch (e) {} } };
  proc.on('exit', (c) => { s.code = c; });
  return s;
}
async function waitUp(s) { for (let i = 0; i < 40; i++) { try { const r = await fetch(s.base + '/api/health'); if (r.ok) return true; } catch (e) {} await sleep(250); } return false; }
async function exitCode(s) { for (let i = 0; i < 32; i++) { if (s.code !== null) return s.code; await sleep(250); } return 'timeout'; }

function client(s) {
  let cookie = '';
  return async function call(method, p, body, form) {
    const headers = cookie ? { Cookie: cookie } : {};
    let payload;
    if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(s.base + '/api' + p, { method, headers, body: payload, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/sid=([^;]*)/); if (m) cookie = m[1] ? 'sid=' + m[1] : ''; }
    const text = await r.text(); let d = {}; try { d = JSON.parse(text); } catch (e) {}
    return { status: r.status, d, text, headers: r.headers };
  };
}
function callback(order, over) {
  const amount = over && over.Amount !== undefined ? over.Amount : (order.item.price).toFixed(2);
  const f = Object.assign({ MerchantCode: CODE, PaymentId: '2', RefNo: order.id, Amount: amount, Currency: 'MYR', Remark: '', TransId: 'T' + order.id, AuthCode: '', Status: '1', ErrDesc: '' }, over || {});
  if (!(over && over.Signature)) f.Signature = sha([KEY, CODE, f.PaymentId, f.RefNo, String(f.Amount).replace(/[.,]/g, ''), f.Currency, f.Status]);
  return f;
}

(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const fakeBase = 'http://127.0.0.1:' + fake.address().port;
  const ipayEnv = { PAYMENT_PROVIDER: 'ipay88', IPAY88_MERCHANT_CODE: CODE, IPAY88_MERCHANT_KEY: KEY, IPAY88_ENTRY_URL: fakeBase + '/entry', IPAY88_REQUERY_URL: fakeBase + '/enquiry', PAYMENTS_ENABLED: 'true', PENDING_AGE_MS: '1500', RECHECK_INTERVAL_MS: '1000', PENDING_EXPIRE_MS: '60000' };

  // ---- production guards ----
  let s = startServer({ RENDER: 'true', PAYMENT_PROVIDER: 'mock' });
  check('mock refuses to start in production', (await exitCode(s)) === 1 && /not allowed in production/.test(s.log())); s.stop();
  s = startServer({ RENDER: 'true', PAYMENT_PROVIDER: 'chip' });
  check('chip refuses to start without keys', (await exitCode(s)) === 1 && /CHIP_BRAND_ID/.test(s.log())); s.stop();
  s = startServer({ RENDER: 'true', PAYMENT_PROVIDER: 'ipay88' });
  check('ipay88 refuses to start without keys', (await exitCode(s)) === 1 && /IPAY88_MERCHANT_CODE/.test(s.log())); s.stop();
  s = startServer({ RENDER: 'true' });
  check('production with no provider starts with purchases closed', await waitUp(s) && (await (await fetch(s.base + '/api/health')).json()).provider === 'none'); s.stop();

  // ---- PAYMENTS_ENABLED off ----
  s = startServer(Object.assign({}, ipayEnv, { PAYMENTS_ENABLED: 'false' }));
  check('server up with payments off', await waitUp(s));
  let call = client(s);
  await call('POST', '/auth/signup', { email: 'off@example.com', password: 'password1' });
  let r = await call('POST', '/orders', { type: 'theme', id: 'neon' });
  check('orders refused while PAYMENTS_ENABLED is off', r.status === 403);
  check('env.js tells the game purchases are closed', (await (await fetch(s.base + '/env.js')).text()).includes('"paymentsEnabled":false'));
  s.stop();

  // ---- main iPay88 flow ----
  s = startServer(ipayEnv);
  check('server up with ipay88 sandbox', await waitUp(s));
  call = client(s);
  await call('POST', '/auth/signup', { email: 'buyer@example.com', password: 'password1' });

  // price tampering: the request carries a fake price and a fake amount; the server uses its own catalogue
  r = await call('POST', '/orders', { type: 'theme', id: 'neon', price: 0.01, amount: 1 });
  check('order created from catalogue price, not the request', r.status === 200 && r.d.order.item.price === 12.99 && r.d.checkoutUrl.includes('/api/payments/ipay88/start/'));
  const order = r.d.order;
  r = await call('GET', '/payments/ipay88/start/' + order.id);
  check('start page posts the catalogue amount to iPay88', r.status === 200 && r.text.includes('value="12.99"') && r.text.includes('name="Signature"') && !r.text.includes(KEY));

  // bad signature
  r = await call('POST', '/payments/ipay88/backend', callback(order, { Signature: 'deadbeef' }), true);
  let st = (await call('GET', '/orders/' + order.id)).d;
  check('bad signature: no grant, replies RECEIVEOK', r.text === 'RECEIVEOK' && st.order.status === 'pending' && !st.user.purchases.themes.includes('neon'));

  // wrong amount (correctly signed for the wrong amount, as a tampered return would be)
  r = await call('POST', '/payments/ipay88/backend', callback(order, { Amount: '1.99' }), true);
  st = (await call('GET', '/orders/' + order.id)).d;
  check('wrong amount: rejected, no grant', st.order.status === 'pending' && !st.user.purchases.themes.includes('neon'));
  check('wrong amount: logged on the order', /amount mismatch/.test(s.log()));

  // wrong currency
  r = await call('POST', '/payments/ipay88/backend', callback(order, { Currency: 'USD' }), true);
  st = (await call('GET', '/orders/' + order.id)).d;
  check('wrong currency: rejected, no grant', st.order.status === 'pending' && /currency mismatch/.test(s.log()));

  // valid callback but iPay88's status query does not confirm -> no grant
  r = await call('POST', '/payments/ipay88/backend', callback(order), true);
  st = (await call('GET', '/orders/' + order.id)).d;
  check('valid callback without status confirmation: no grant', st.order.status === 'pending' && !st.user.purchases.themes.includes('neon'));

  // successful payment: status query confirms
  paidOrders.add(order.id);
  r = await call('POST', '/payments/ipay88/backend', callback(order), true);
  st = (await call('GET', '/orders/' + order.id)).d;
  check('successful payment grants the item once', r.text === 'RECEIVEOK' && st.order.status === 'paid' && st.user.purchases.themes.includes('neon') && st.order.transactionId === 'T' + order.id);
  const receipts1 = s.log().split('Receipt').length - 1;

  // duplicate callback
  r = await call('POST', '/payments/ipay88/backend', callback(order), true);
  st = (await call('GET', '/orders/' + order.id)).d;
  check('duplicate callback changes nothing', r.text === 'RECEIVEOK' && st.order.status === 'paid' && st.user.purchases.themes.length === 1 && (s.log().split('Receipt').length - 1) === receipts1);

  // browser return redirects to the game's result page
  r = await call('POST', '/payments/ipay88/response', callback(order), true);
  check('browser return redirects to the result page', r.status === 302 && (r.headers.get('location') || '').includes('/#/pay/return/' + order.id));

  // unknown order
  r = await call('POST', '/payments/ipay88/backend', callback({ id: 'ord_NOPE', item: { price: 9.99 } }), true);
  check('callback for unknown order is rejected', r.status === 404 && r.text !== 'RECEIVEOK');

  // failed payment
  r = await call('POST', '/orders', { type: 'theme', id: 'ember' }); const failOrder = r.d.order;
  r = await call('POST', '/payments/ipay88/backend', callback(failOrder, { Status: '0', ErrDesc: 'Customer cancelled' }), true);
  st = (await call('GET', '/orders/' + failOrder.id)).d;
  check('failed payment: order failed, no grant', st.order.status === 'failed' && !st.user.purchases.themes.includes('ember'));

  // pending order settled by the background job (lost callback)
  r = await call('POST', '/orders', { type: 'coins', id: 'coins-s' }); const lost = r.d.order;
  const coinsBefore = (await call('GET', '/me')).d.user.coins;
  paidOrders.add(lost.id);
  await sleep(3500); // older than PENDING_AGE_MS, job runs every second
  const me = (await call('GET', '/me')).d.user;
  const lostNow = (await call('GET', '/orders/' + lost.id)).d.order;
  check('PENDING order older than the age limit is settled by the job', lostNow.status === 'paid' && me.coins === coinsBefore + 1000);

  s.stop(); fake.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
