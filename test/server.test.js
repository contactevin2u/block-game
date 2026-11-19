// Starts the real server with mock payments and console email, then exercises the API end to end.
// Run: node test/server.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const dbPath = path.join(os.tmpdir(), 'bg-test-' + Date.now() + '.db');
const port = 3456 + Math.floor(Math.random() * 500);
const base = 'http://127.0.0.1:' + port;
const env = Object.assign({}, process.env, { PORT: String(port), DB_PATH: dbPath, PAYMENT_PROVIDER: 'mock', PAYMENTS_ENABLED: 'true', EMAIL_PROVIDER: 'console', BASE_URL: base, SESSION_DAYS: '30', CORS_ORIGIN: 'https://game.example.test' });
delete env.RENDER; delete env.NODE_ENV;
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let cookie = '';
let fails = 0;
function check(name, cond) { if (!cond) { fails++; console.log('FAIL ' + name); } else console.log('ok   ' + name); }
async function call(method, p, body) {
  const r = await fetch(base + '/api' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) { const m = sc.match(/sid=([^;]*)/); if (m) cookie = m[1] ? 'sid=' + m[1] : ''; }
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch (e) {} await sleep(250); }
  check('health', (await call('GET', '/health')).d.ok === true);
  check('env.js says server', (await (await fetch(base + '/env.js')).text()).includes('"mode":"server"'));
  check('index served', (await (await fetch(base + '/')).text()).includes('api-backend.js'));
  // Cross-site front end (Vercel) support
  let pre = await fetch(base + '/api/me', { method: 'OPTIONS', headers: { Origin: 'https://game.example.test', 'Access-Control-Request-Method': 'GET' } });
  check('CORS preflight for allowed origin', pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://game.example.test' && pre.headers.get('access-control-allow-credentials') === 'true');
  pre = await fetch(base + '/api/me', { headers: { Origin: 'https://evil.example.test' } });
  check('CORS refused for other origins', !pre.headers.get('access-control-allow-origin'));

  check('me as guest', (await call('GET', '/me')).d.user === null);
  let r = await call('POST', '/auth/signup', { email: 'bad', password: 'short' });
  check('signup validates', r.status === 400);
  r = await call('POST', '/auth/signup', { email: 'Player@Example.com', password: 'password1', guest: { coins: 30, adventure: { unlocked: 3, stages: { 1: { stars: 3 } } }, runs: [{ mode: 'classic', score: 900, lines: 4, level: 1, time: 50 }] } });
  check('signup ok + cookie', r.status === 200 && r.d.user && r.d.user.email === 'player@example.com' && cookie.length > 10);
  check('guest data migrated', r.d.user.coins === 30 && r.d.user.adventure.unlocked === 3);
  r = await call('GET', '/me'); check('session restores user', r.d.user && r.d.user.email === 'player@example.com' && r.d.sessions === 1);
  r = await call('POST', '/auth/signup', { email: 'player@example.com', password: 'password1' }); check('duplicate email refused', r.status === 400);

  r = await call('PATCH', '/me', { settings: { appearance: 'dark', theme: 'classic' }, coins: 100, rating: 1024 });
  check('patch me', r.d.user.settings.appearance === 'dark' && r.d.user.coins === 100 && r.d.user.rating === 1024);
  r = await call('POST', '/runs', { mode: 'classic', score: 12000, lines: 40, level: 5, time: 200, coins: 40 });
  check('run credits coins and best', r.d.user.coins === 140 && r.d.user.bestScore === 12000 && r.d.user.gamesPlayed === 1);
  r = await call('GET', '/runs'); check('runs listed (migrated + new)', r.d.runs.length === 2 && r.d.runs[0].score === 12000);

  // Forgot / reset via dev inbox
  const savedCookie = cookie;
  r = await call('POST', '/auth/forgot', { email: 'player@example.com' }); check('forgot ok', r.d.ok === true);
  r = await call('POST', '/auth/forgot', { email: 'nobody@example.com' }); check('forgot unknown email same answer', r.d.ok === true);
  let mails = (await call('GET', '/dev/emails')).d.emails;
  const resetMail = mails.find((m) => /Reset/.test(m.subject));
  check('reset email with link', !!resetMail && resetMail.link.includes('/#/reset/'));
  const token = resetMail.link.split('/').pop();
  check('token ok', (await call('GET', '/auth/token/' + token + '?type=reset')).d.status === 'ok');
  r = await call('POST', '/auth/reset', { token, password: 'password2' }); check('reset ok', r.d.email === 'player@example.com');
  check('token now invalid', (await call('GET', '/auth/token/' + token + '?type=reset')).d.status === 'invalid');
  cookie = savedCookie; r = await call('GET', '/me'); check('old session revoked after reset', r.d.user === null);
  r = await call('POST', '/auth/login', { email: 'player@example.com', password: 'password1' }); check('old password rejected', r.status === 400);
  r = await call('POST', '/auth/login', { email: 'player@example.com', password: 'password2' }); check('new password works', r.status === 200 && r.d.user);

  // Change password keeps this session, logs out others
  const first = cookie; cookie = '';
  await call('POST', '/auth/login', { email: 'player@example.com', password: 'password2' }); const second = cookie;
  cookie = first; r = await call('POST', '/auth/change-password', { current: 'password2', password: 'password3' });
  check('change password logs out 1 other', r.d.others === 1);
  cookie = second; check('other session gone', (await call('GET', '/me')).d.user === null);
  cookie = first; check('this session kept', (await call('GET', '/me')).d.user !== null);

  // Change email with confirmation
  r = await call('POST', '/auth/change-email', { email: 'new@example.com', password: 'password3' }); check('email change requested', r.d.ok === true);
  mails = (await call('GET', '/dev/emails')).d.emails;
  const confirmMail = mails.find((m) => m.to === 'new@example.com');
  check('confirmation sent to new address', !!confirmMail);
  r = await call('POST', '/auth/confirm-email', { token: confirmMail.link.split('/').pop() }); check('email confirmed', r.d.email === 'new@example.com');
  check('login with new email', (await call('POST', '/auth/login', { email: 'new@example.com', password: 'password3' })).status === 200);

  // Orders through the mock gateway: grant only after confirmation, idempotent
  r = await call('POST', '/orders', { type: 'theme', id: 'neon' });
  check('order created', r.status === 200 && r.d.order.status === 'pending' && r.d.checkoutUrl.includes('/#/checkout/'));
  const oid = r.d.order.id;
  r = await call('POST', '/orders/' + oid + '/mock', { action: 'choose', method: 'tng' }); check('mock choose', r.d.order.status === 'authorizing');
  r = await call('POST', '/orders/' + oid + '/mock', { action: 'approve' }); check('mock approve -> processing', r.d.order.status === 'processing');
  check('not granted yet', !(await call('GET', '/me')).d.user.purchases.themes.includes('neon'));
  await sleep(2000);
  r = await call('GET', '/orders/' + oid); check('order paid and theme granted', r.d.order.status === 'paid' && r.d.user.purchases.themes.includes('neon'));
  r = await call('POST', '/orders', { type: 'theme', id: 'neon' }); check('cannot rebuy owned theme', r.status === 400);
  r = await call('POST', '/orders', { type: 'coins', id: 'coins-s' }); const cid = r.d.order.id;
  await call('POST', '/orders/' + cid + '/mock', { action: 'choose', method: 'fpx' }); await call('POST', '/orders/' + cid + '/mock', { action: 'approve' }); await sleep(2000);
  r = await call('GET', '/orders/' + cid); check('coin pack credited', r.d.order.status === 'paid' && r.d.user.coins === 140 + 1000);
  r = await call('POST', '/orders', { type: 'bundle', id: 'bundle' }); const bid = r.d.order.id;
  await call('POST', '/orders/' + bid + '/mock', { action: 'cancel' }); r = await call('GET', '/orders/' + bid); check('cancelled order stays unpaid', r.d.order.status === 'cancelled' && !r.d.user.purchases.removeAds);
  mails = (await call('GET', '/dev/emails')).d.emails; check('receipt emailed', mails.some((m) => /Receipt/.test(m.subject)));

  // Rate limit on login
  let limited = false;
  for (let i = 0; i < 25; i++) { const x = await call('POST', '/auth/login', { email: 'new@example.com', password: 'wrong' }); if (x.status === 429) { limited = true; break; } }
  check('login rate limited', limited);

  r = await call('POST', '/auth/logout-all'); check('logout all', (await call('GET', '/me')).d.user === null);

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  if (fails) console.log('--- server log ---\n' + serverLog);
  server.kill(); try { fs.unlinkSync(dbPath); fs.unlinkSync(dbPath + '-wal'); fs.unlinkSync(dbPath + '-shm'); } catch (e) {}
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); console.log(serverLog); server.kill(); process.exit(1); });
