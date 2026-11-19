// Online battle: two real WebSocket clients against the real server. Run: node test/online.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const port = 5200 + Math.floor(Math.random() * 500);
const base = 'http://127.0.0.1:' + port;
const dbPath = path.join(os.tmpdir(), 'bg-online-' + Date.now() + '.db');
const env = Object.assign({}, process.env, { PORT: String(port), DB_PATH: dbPath, PAYMENT_PROVIDER: 'mock', EMAIL_PROVIDER: 'console', BASE_URL: base, QUEUE_TIMEOUT_MS: '1500', RECONNECT_GRACE_MS: '1500' });
delete env.RENDER; delete env.NODE_ENV;
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (d) => { log += d; }); server.stderr.on('data', (d) => { log += d; });

let fails = 0;
function check(name, cond) { if (!cond) { fails++; console.log('FAIL ' + name); } else console.log('ok   ' + name); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpClient() {
  let cookie = '';
  return async (method, p, body) => {
    const r = await fetch(base + '/api' + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/sid=([^;]*)/); if (m) cookie = 'sid=' + m[1]; }
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
}
// A socket client that records messages and lets the test wait for a given type.
async function socket(call, guestKey) {
  const { d } = await call('POST', '/ws-token', {});
  const ws = new WebSocket(d.wsUrl + '?token=' + encodeURIComponent(d.token) + (guestKey ? '&guest=' + guestKey : ''));
  const all = [], unread = [];
  const waiters = [];
  ws.on('message', (m) => {
    const j = JSON.parse(m); all.push(j);
    const i = waiters.findIndex((w) => w.t === j.t);
    if (i >= 0) { waiters[i].resolve(j); waiters.splice(i, 1); } else unread.push(j);
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return {
    ws, send: (m) => ws.send(JSON.stringify(m)),
    // Resolves with the next message of that type, including one that already arrived and was not yet read.
    next: (t, ms) => new Promise((resolve, reject) => {
      const i = unread.findIndex((m) => m.t === t);
      if (i >= 0) return resolve(unread.splice(i, 1)[0]);
      const w = { t, resolve }; waiters.push(w);
      setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error('timeout waiting for ' + t)); } }, ms || 5000);
    }),
    last: (t) => all.filter((m) => m.t === t).pop()
  };
}

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) {} await sleep(250); }
  const A = httpClient(), Bc = httpClient();
  await A('POST', '/auth/signup', { email: 'alice@example.com', password: 'password1' });
  await Bc('POST', '/auth/signup', { email: 'bob@example.com', password: 'password1' });

  // ---- private room ----
  const a = await socket(A), b = await socket(Bc);
  const helloA = await a.next('hello'); await b.next('hello');
  check('hello carries the player name', helloA.you.name === 'alice');
  a.send({ t: 'create' });
  const room = await a.next('room');
  check('room created with a 6-character code', /^[A-Z0-9]{6}$/.test(room.code) && room.players[0].host);
  b.send({ t: 'join', code: 'ZZZZZZ' });
  const err = await b.next('error');
  check('joining a wrong code is refused', /No room/.test(err.msg));
  b.send({ t: 'join', code: room.code });
  const roomB = await b.next('room');
  check('second player sees both players', roomB.players.length === 2);
  a.send({ t: 'start' });
  const notReady = await a.next('error');
  check('cannot start before everyone is ready', /Ready/.test(notReady.msg));
  a.send({ t: 'ready', on: true }); b.send({ t: 'ready', on: true });
  await sleep(200);
  a.send({ t: 'start' });
  const sA = await a.next('start'), sB = await b.next('start');
  check('both players get the same seed and each other as opponent', sA.match.seed === sB.match.seed && sA.match.opp.name === 'bob' && sB.match.opp.name === 'alice' && sA.match.ranked === false);

  // live relay
  a.send({ t: 'state', g: 'I'.repeat(220), s: 1200, l: 4, lv: 1, h: 'T', n: ['O', 'S'] });
  const st = await b.next('state');
  check('board state is relayed to the opponent', st.g.length === 220 && st.s === 1200 && st.h === 'T');
  a.send({ t: 'attack', n: 4 });
  const atk = await b.next('attack');
  check('attack is relayed with its line count', atk.n === 4);
  a.send({ t: 'attack', n: 99 });
  const atk2 = await b.next('attack');
  check('attack is capped', atk2.n === 10);

  // bob tops out: alice wins, friendly match so no rating change
  b.send({ t: 'topout' });
  const rA = await a.next('result'), rB = await b.next('result');
  check('server decides the result', rA.won === true && rB.won === false && rA.reason === 'topout');
  check('friendly match changes no rating', rA.delta === 0 && rB.delta === 0 && rA.ranked === false);
  const runsA = (await A('GET', '/runs')).d.runs;
  check('battle recorded in history with lines sent', runsA.length === 1 && runsA[0].mode === 'battle' && runsA[0].result === 'win' && runsA[0].attackSent === 14 && runsA[0].opponent === 'bob');

  // rematch: both press it, a new match starts with a new seed
  a.send({ t: 'rematch' });
  const rw = await b.next('rematch_wait');
  check('opponent is told about the rematch request', rw.t === 'rematch_wait');
  b.send({ t: 'rematch' });
  const s2A = await a.next('start'), s2B = await b.next('start');
  check('rematch starts a new match for both', s2A.match.seed === s2B.match.seed && s2A.match.seed !== sA.match.seed);
  a.send({ t: 'quit' });
  const qb = await b.next('result'), qa = await a.next('result');
  check('quitting gives the win to the opponent', qb.won === true && qb.reason === 'quit' && qa.won === false);

  // ---- quick match ----
  a.send({ t: 'leave' }); b.send({ t: 'leave' }); await sleep(100);
  a.send({ t: 'queue' });
  const q = await a.next('queued');
  check('queued while waiting', q.t === 'queued');
  const nm = await a.next('nomatch', 4000);
  check('no match within the timeout offers the computer', nm.t === 'nomatch');
  a.send({ t: 'queue' }); await sleep(100); b.send({ t: 'queue' });
  const qA = await a.next('start'), qB = await b.next('start');
  check('two waiting players are matched, ranked', qA.match.ranked === true && qA.match.seed === qB.match.seed);
  const ratingBefore = (await A('GET', '/me')).d.user.rating;
  b.send({ t: 'topout' });
  const r2A = await a.next('result'), r2B = await b.next('result');
  check('ranked win raises rating, loss lowers it', r2A.delta > 0 && r2B.delta < 0 && r2A.rating === ratingBefore + r2A.delta);
  check('rating stored on the account', (await A('GET', '/me')).d.user.rating === r2A.rating && (await A('GET', '/me')).d.user.battles.w === 2 && (await A('GET', '/me')).d.user.battles.l === 1);

  // ---- disconnect grace ----
  a.send({ t: 'rematch' }); b.send({ t: 'rematch' });
  await a.next('start'); await b.next('start');
  b.ws.close();
  const away = await a.next('opp_away');
  check('opponent sees the reconnect window', away.seconds === 1.5);
  const r3 = await a.next('result', 5000);
  check('no return within the grace period forfeits the match', r3.won === true && r3.reason === 'disconnect');

  // ---- guests ----
  const G = httpClient();
  const g = await socket(G, 'testguest1');
  const hg = await g.next('hello');
  check('guest can connect without an account', /^Guest/.test(hg.you.name) && hg.guestKey === 'testguest1');

  // ---- bad token ----
  const bad = new WebSocket((await A('POST', '/ws-token', {})).d.wsUrl + '?token=nope');
  const code = await new Promise((res) => { bad.on('close', (c) => res(c)); bad.on('error', () => {}); });
  check('bad token is refused', code === 4001);

  const stats = await (await fetch(base + '/api/online')).json();
  check('stats endpoint answers', typeof stats.clients === 'number');

  a.ws.close(); g.ws.close(); server.kill();
  try { fs.unlinkSync(dbPath); fs.unlinkSync(dbPath + '-wal'); fs.unlinkSync(dbPath + '-shm'); } catch (e) {}
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  if (fails) console.log(log);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); console.log(log); server.kill(); process.exit(1); });
