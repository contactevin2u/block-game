// Boost Connect provider against a FAKE Boost server. Never calls the real Boost. Run: node test/boost.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CLIENT_ID = 'testclient', SECRET = 'test-secret-do-not-use';
let fails = 0;
function check(name, cond) { if (!cond) { fails++; console.log('FAIL ' + name); } else console.log('ok   ' + name); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fake Boost ----
const inits = [];                 // every init received: { ref, body, authOk, pathSigned, created }
const refs = new Map();           // referenceId -> read-back record
let failInit = null;              // referenceId to answer 500 for
function expectedAuth(method, bodyBytes, pathToSign) {
  const mac = crypto.createHmac('sha256', SECRET).update(method + pathToSign + bodyBytes).digest('base64');
  return 'Basic ' + Buffer.from(CLIENT_ID + ':' + mac).toString('base64');
}
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;                             // e.g. /gateway/v1/payments/init
    const bare = path.replace(/^\/gateway/, '');           // what must be signed
    const auth = req.headers.authorization || '';
    const headersOk = req.headers.accept === 'application/json' && (req.method === 'GET' || req.headers['content-type'] === 'application/json');
    if (req.method === 'POST' && bare === '/v1/payments/init') {
      let b = null; try { b = JSON.parse(raw); } catch (e) {}
      const rec = { ref: b && b.referenceId, body: b, raw, authOk: auth === expectedAuth('POST', raw, bare), signedWithGateway: auth === expectedAuth('POST', raw, path), headersOk, created: b && b.created, amountText: (raw.match(/"amount":([0-9.]+)/) || [])[1] };
      inits.push(rec);
      if (!rec.authOk) { res.writeHead(401); res.end(); return; }
      if (failInit === 'next' || refs.has(b.referenceId)) { failInit = null; res.writeHead(500); res.end('duplicate'); return; }
      const uuid = 'uuid-' + crypto.randomBytes(4).toString('hex');
      refs.set(b.referenceId, { status: 'pending', uuid, amount: b.amount, currency: 'MYR', reversed: false });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ uuid, paymentUrl: 'https://pay.fake-boost.test/p/' + uuid, referenceId: b.referenceId }));
      return;
    }
    const m = bare.match(/^\/v1\/payments\/refs\/(.+)$/);
    if (req.method === 'GET' && m) {
      if (auth !== expectedAuth('GET', '', bare)) { res.writeHead(401); res.end(); return; }
      const rec = refs.get(decodeURIComponent(m[1]));
      if (!rec) { res.writeHead(404); res.end('{}'); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(rec)); return;
    }
    res.writeHead(404); res.end();
  });
});

function startServer(extraEnv) {
  const port = 4800 + Math.floor(Math.random() * 400);
  const dbPath = path.join(os.tmpdir(), 'bg-boost-' + Date.now() + '-' + port + '.db');
  const base = Object.assign({}, process.env);
  ['RENDER', 'NODE_ENV', 'PAYMENT_PROVIDER', 'PAYMENTS_ENABLED', 'DEMO_MODE', 'BCPG_BASE_URL', 'BCPG_CLIENT_ID', 'BCPG_CLIENT_SECRET'].forEach((k) => delete base[k]);
  const env = Object.assign(base, { PORT: String(port), DB_PATH: dbPath, EMAIL_PROVIDER: 'console', BASE_URL: 'https://game.test', API_URL: 'https://api.test', SESSION_DAYS: '30' }, extraEnv);
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

(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const fakeBase = 'http://127.0.0.1:' + fake.address().port + '/gateway';
  const boostEnv = { PAYMENT_PROVIDER: 'boost', BCPG_BASE_URL: fakeBase, BCPG_CLIENT_ID: CLIENT_ID, BCPG_CLIENT_SECRET: SECRET, PAYMENTS_ENABLED: 'true', PENDING_AGE_MS: '1000', RECHECK_INTERVAL_MS: '700', PENDING_EXPIRE_MS: '2500', EXPIRED_RECHECK_MS: '60000' };

  // ---- signature unit check against a fixed example ----
  process.env.BCPG_CLIENT_ID = CLIENT_ID; process.env.BCPG_CLIENT_SECRET = SECRET; process.env.BCPG_BASE_URL = fakeBase;
  const { boost } = require('../server/payments.js');
  const fixedBody = '{"referenceId":"LZ-ord_TEST-0123abcd","amount":12.90,"currency":"MYR"}';
  const mac = crypto.createHmac('sha256', SECRET).update('POST' + '/v1/payments/init' + fixedBody).digest('base64');
  check('signature matches the fixed example', boost.sign('POST', '/v1/payments/init', fixedBody) === 'Basic ' + Buffer.from(CLIENT_ID + ':' + mac).toString('base64'));
  check('GET signature uses an empty body', boost.sign('GET', '/v1/payments/refs/LZ-x', '') === 'Basic ' + Buffer.from(CLIENT_ID + ':' + crypto.createHmac('sha256', SECRET).update('GET/v1/payments/refs/LZ-x').digest('base64')).toString('base64'));
  const fakeOrder = { id: 'ord_ABCDEFGH', reference_id: 'LZ-ord_ABCDEFGH-00ff00ff', price_cents: 1290, name: 'Neon Grid theme & more!', method: 'tng' };
  const body = boost.initBody(fakeOrder, { baseUrl: 'https://game.test', apiUrl: 'https://api.test' });
  const parsed = JSON.parse(body);
  check('amount is a JSON number with two decimals', /"amount":12\.90,/.test(body) && parsed.amount === 12.9);
  check('description keeps letters, digits, space, dot, hyphen only', parsed.description === 'Neon Grid theme more' || parsed.description === 'Neon Grid theme  more'.replace(/\s+/g, ' '));
  const age = Date.now() - new Date(parsed.created).getTime();
  check('created is about 10 s in the past, ISO with milliseconds', /\.\d{3}Z$/.test(parsed.created) && age >= 9500 && age <= 12000);
  check('returnUrl on the game address, callbackUrl on the API address', parsed.returnUrl.startsWith('https://game.test/api/payments/boost/return?ref=LZ-') && parsed.callbackUrl === 'https://api.test/api/payments/boost/callback');
  check('reference is LZ-<order id without underscore>-<8 HEX>, letters digits hyphens only', /^LZ-ORDZZZZ1234-[0-9A-F]{8}$/.test(boost.reference('ord_ZZZZ1234')));
  delete process.env.BCPG_CLIENT_ID; delete process.env.BCPG_CLIENT_SECRET; delete process.env.BCPG_BASE_URL;

  // ---- start guard ----
  let s = startServer({ RENDER: 'true', PAYMENT_PROVIDER: 'boost', BCPG_BASE_URL: fakeBase, BCPG_CLIENT_ID: CLIENT_ID });
  check('boost refuses to start without the secret', (await exitCode(s)) === 1 && /BCPG_CLIENT_SECRET/.test(s.log())); s.stop();

  // ---- switch off ----
  s = startServer(Object.assign({}, boostEnv, { PAYMENTS_ENABLED: 'false' }));
  check('server up with payments off', await waitUp(s));
  let call = client(s);
  await call('POST', '/auth/signup', { email: 'off@example.com', password: 'password1' });
  check('orders refused while the switch is off', (await call('POST', '/orders', { type: 'theme', id: 'neon', method: 'boost' })).status === 403);
  s.stop();

  // ---- main flow ----
  s = startServer(boostEnv);
  check('server up with boost against the fake', await waitUp(s));
  call = client(s);
  await call('POST', '/auth/signup', { email: 'buyer@example.com', password: 'password1' });

  let r = await call('POST', '/orders', { type: 'theme', id: 'neon' });
  check('a method is required', r.status === 400);
  r = await call('POST', '/orders', { type: 'theme', id: 'neon', method: 'tng', price: 0.01, amount: '0.01' });
  check('order created, price from the catalogue, sent to Boost page', r.status === 200 && r.d.order.item.price === 12.99 && r.d.checkoutUrl.startsWith('https://pay.fake-boost.test/'));
  const order = r.d.order;
  const init = inits[inits.length - 1];
  check('init signed over the bare path, not /gateway', init.authOk && !init.signedWithGateway);
  check('headers Accept and Content-Type are application/json', init.headersOk);
  check('signed bytes equal sent bytes (fake verified the raw body)', init.authOk);
  check('init carried the catalogue amount with two decimals', init.amountText === '12.99');
  check('init created is 10 s in the past', (Date.now() - new Date(init.created).getTime()) >= 9500);
  check('referenceId stored and starts with LZ-', /^LZ-/.test(order.referenceId) && init.ref === order.referenceId);

  // every attempt gets a fresh reference
  const before = inits.length;
  r = await call('POST', '/orders', { type: 'theme', id: 'paper', method: 'fpx' });
  const okOrder = r.d.order;
  check('each attempt uses a fresh reference', inits.length === before + 1 && inits[before].ref !== order.referenceId);

  // a duplicate-reference 500 is not retried: the fake answers 500 to the next init, and the server must send
  // that reference exactly once and report failure to the player; the next Buy gets a new reference.
  failInit = 'next';
  const initsBefore = inits.length;
  r = await call('POST', '/orders', { type: 'theme', id: 'lcd', method: 'card' });
  const failedRef = inits[inits.length - 1].ref;
  check('init 500 is reported, not retried', r.status === 502 && inits.length === initsBefore + 1 && inits.filter((i) => i.ref === failedRef).length === 1);
  // the order was saved BEFORE Boost was asked, and a failed init leaves it failed (AutoCount's portal rule)
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(s.dbPath); const row = d.prepare('SELECT status, last_error FROM orders WHERE reference_id = ?').get(failedRef); d.close();
    check('order row existed before init and is failed after the 500', !!row && row.status === 'failed' && /Boost init/.test(row.last_error || '')); }
  failInit = null;
  r = await call('POST', '/orders', { type: 'theme', id: 'lcd', method: 'card' });
  check('the next attempt uses a new reference and succeeds', r.status === 200 && r.d.order.referenceId !== failedRef);

  // a callback alone grants nothing
  r = await call('POST', '/payments/boost/callback', { referenceId: order.referenceId }, true);
  let st = (await call('GET', '/orders/' + order.id)).d;
  check('callback replies 200 and grants nothing while Boost says pending', r.status === 200 && st.order.status === 'pending' && !st.user.purchases.themes.includes('neon'));

  // success: read-back agrees on everything
  refs.get(order.referenceId).status = 'succeeded';
  r = await call('POST', '/payments/boost/callback', { referenceId: order.referenceId }, true);
  await sleep(300);
  st = (await call('GET', '/orders/' + order.id)).d;
  check('success grants once after the read-back', st.order.status === 'paid' && st.user.purchases.themes.includes('neon'));
  const receipts = s.log().split('Receipt').length - 1;
  r = await call('POST', '/payments/boost/callback', { referenceId: order.referenceId }, true);
  await sleep(300);
  st = (await call('GET', '/orders/' + order.id)).d;
  check('duplicate callbacks change nothing', st.order.status === 'paid' && st.user.purchases.themes.length === 1 && (s.log().split('Receipt').length - 1) === receipts);

  // return page: read back, then redirect to the result page
  r = await call('GET', '/payments/boost/return?ref=' + encodeURIComponent(okOrder.referenceId));
  check('return page redirects to the game result page', r.status === 302 && (r.headers.get('location') || '').endsWith('/#/pay/return/' + okOrder.id));

  // REVIEW cases: succeeded but something disagrees
  async function reviewCase(name, mutate, themeId) {
    const o = (await call('POST', '/orders', { type: 'theme', id: themeId, method: 'boost' })).d.order;
    const rec = refs.get(o.referenceId); rec.status = 'succeeded'; mutate(rec);
    await call('POST', '/payments/boost/callback', { referenceId: o.referenceId }, true); await sleep(300);
    const after = (await call('GET', '/orders/' + o.id)).d;
    check(name + ' -> REVIEW, no grant', after.order.status === 'review' && !after.user.purchases.themes.includes(themeId));
    return o;
  }
  await reviewCase('wrong amount', (rec) => { rec.amount = 1.99; }, 'glass');
  await reviewCase('wrong uuid', (rec) => { rec.uuid = 'uuid-other'; }, 'ember');
  // for currency and reversed we need fresh themes; use coins packs instead (never "owned")
  async function reviewCoins(name, mutate) {
    const coinsBefore = (await call('GET', '/me')).d.user.coins;
    const o = (await call('POST', '/orders', { type: 'coins', id: 'coins-s', method: 'boost' })).d.order;
    const rec = refs.get(o.referenceId); rec.status = 'succeeded'; mutate(rec);
    await call('POST', '/payments/boost/callback', { referenceId: o.referenceId }, true); await sleep(300);
    const after = (await call('GET', '/orders/' + o.id)).d;
    check(name + ' -> REVIEW, no grant', after.order.status === 'review' && after.user.coins === coinsBefore);
  }
  await reviewCoins('wrong currency', (rec) => { rec.currency = 'USD'; });
  await reviewCoins('reversed', (rec) => { rec.reversed = true; });
  // read-back shapes AutoCount's portal accepts: no currency field, amount as a string
  async function paidCoins(name, mutate) {
    const coinsBefore = (await call('GET', '/me')).d.user.coins;
    const o = (await call('POST', '/orders', { type: 'coins', id: 'coins-s', method: 'boost' })).d.order;
    const rec = refs.get(o.referenceId); rec.status = 'succeeded'; mutate(rec);
    await call('POST', '/payments/boost/callback', { referenceId: o.referenceId }, true); await sleep(300);
    const after = (await call('GET', '/orders/' + o.id)).d;
    check(name + ' -> paid once', after.order.status === 'paid' && after.user.coins === coinsBefore + 1000);
  }
  await paidCoins('read-back without a currency field', (rec) => { delete rec.currency; });
  await paidCoins('amount as a string "9.99"', (rec) => { rec.amount = '9.99'; });
  await paidCoins('reversed: false as text', (rec) => { rec.reversed = 'false'; });
  await reviewCoins('reversed given as a date', (rec) => { rec.reversed = '2026-11-19T10:00:00Z'; });
  check('review reasons are logged', /REVIEW/.test(s.log()) && /amount mismatch/.test(s.log()) && /uuid mismatch/.test(s.log()) && /currency mismatch/.test(s.log()) && /reversed/.test(s.log()));

  // cancelled -> no grant
  const cancelled = (await call('POST', '/orders', { type: 'coins', id: 'coins-m', method: 'fpx' })).d.order;
  refs.get(cancelled.referenceId).status = 'cancelled';
  await call('POST', '/payments/boost/callback', { referenceId: cancelled.referenceId }, true); await sleep(300);
  st = (await call('GET', '/orders/' + cancelled.id)).d;
  check('cancelled -> failed, no grant', st.order.status === 'failed');

  // expired then late success -> granted once by the background job
  const coinsBefore = (await call('GET', '/me')).d.user.coins;
  const late = (await call('POST', '/orders', { type: 'coins', id: 'coins-l', method: 'card' })).d.order;
  await sleep(4500); // past PENDING_EXPIRE_MS (2.5 s) with the fake still saying pending
  st = (await call('GET', '/orders/' + late.id)).d;
  check('expired after the page life ends', st.order.status === 'expired' && st.user.coins === coinsBefore);
  refs.get(late.referenceId).status = 'succeeded';
  await sleep(2000); // the job re-reads expired orders
  st = (await call('GET', '/orders/' + late.id)).d;
  check('late success on an expired order is granted once', st.order.status === 'paid' && st.user.coins === coinsBefore + 3200);
  await sleep(1500);
  check('and only once', (await call('GET', '/me')).d.user.coins === coinsBefore + 3200);

  s.stop(); fake.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
