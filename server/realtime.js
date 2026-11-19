/* Online battle: WebSocket matchmaking, private rooms, live board relay, results and rating.
   Each player's game runs on their own device with a shared seed; this server pairs players, relays
   board states and garbage, decides the result when someone tops out, and updates ratings. */
'use strict';
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const { row, run } = require('./db');

const QUEUE_TIMEOUT_MS = parseInt(process.env.QUEUE_TIMEOUT_MS || '20000', 10);
const RECONNECT_GRACE_MS = parseInt(process.env.RECONNECT_GRACE_MS || '20000', 10);
const ROOM_IDLE_MS = 10 * 60000;
const K = 24;

const tokens = new Map();    // ws token -> { user, expiresAt }
const clients = new Map();   // playerKey -> client
const rooms = new Map();     // code -> room
const matches = new Map();   // matchId -> match
let queue = [];              // waiting clients for quick match

function id(n) { return crypto.randomBytes(n || 6).toString('base64url'); }
function roomCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += a[crypto.randomInt(a.length)]; return rooms.has(s) ? roomCode() : s; }
function send(c, msg) { if (c && c.ws && c.ws.readyState === 1) { try { c.ws.send(JSON.stringify(msg)); } catch (e) {} } }
function pub(c) { return { id: c.key, name: c.name, rating: c.rating, ready: !!c.ready, host: !!c.host, connected: !!(c.ws && c.ws.readyState === 1) }; }

// Called by the HTTP API: a logged-in (or guest) player asks for a short-lived token to open the socket with.
function issueToken(user) {
  const t = id(24);
  tokens.set(t, { user, expiresAt: Date.now() + 60000 });
  return t;
}
setInterval(() => { const now = Date.now(); for (const [t, v] of tokens) if (v.expiresAt < now) tokens.delete(t); }, 30000).unref();

function elo(a, b, aWon) {
  const ea = 1 / (1 + Math.pow(10, (b - a) / 400));
  const da = Math.round(K * ((aWon ? 1 : 0) - ea));
  return { a: a + da, b: b - da, da, db: -da };
}

function attach(server, deps) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://x');
    const tok = tokens.get(url.searchParams.get('token') || '');
    if (!tok || tok.expiresAt < Date.now()) { ws.close(4001, 'bad token'); return; }
    tokens.delete(url.searchParams.get('token'));
    const u = tok.user;
    const key = u.guest ? 'guest:' + (url.searchParams.get('guest') || id(6)) : 'user:' + u.id;
    let c = clients.get(key);
    if (c) {
      // Reconnect: same player, new socket. Cancel the grace timer and resume.
      if (c.ws && c.ws !== ws) { try { c.ws.close(4002, 'replaced'); } catch (e) {} }
      c.ws = ws; clearTimeout(c.graceTimer); c.graceTimer = null;
      if (c.match) { const o = other(c.match, c); send(o, { t: 'opp_back' }); send(c, { t: 'resume', match: matchInfo(c.match, c) }); }
      if (c.room) sendRoom(c.room);
    } else {
      c = { key, ws, userId: u.guest ? null : u.id, name: u.guest ? 'Guest ' + key.slice(6, 10).toUpperCase() : u.email.split('@')[0].slice(0, 16), rating: u.rating || 1000, ready: false, host: false, room: null, match: null, queuedAt: 0, graceTimer: null };
      clients.set(key, c);
    }
    send(c, { t: 'hello', you: pub(c), guestKey: key.startsWith('guest:') ? key.slice(6) : null });
    ws.on('message', (data) => { let m; try { m = JSON.parse(data); } catch (e) { return; } try { handle(c, m); } catch (e) { console.error('[ws]', e.message); } });
    ws.on('close', () => { if (c.ws !== ws) return; onDisconnect(c); });
  });

  function handle(c, m) {
    // A finished match lingers only for a possible rematch; any other action ends it.
    if (c.match && c.match.done && m.t !== 'rematch' && m.t !== 'ping') endMatch(c.match);
    switch (m.t) {
      case 'ping': send(c, { t: 'pong' }); break;
      case 'queue': enqueue(c); break;
      case 'cancel': dequeue(c); send(c, { t: 'idle' }); break;
      case 'create': createRoom(c); break;
      case 'join': joinRoom(c, String(m.code || '').toUpperCase().trim()); break;
      case 'leave': leaveRoom(c); send(c, { t: 'idle' }); break;
      case 'ready': if (c.room) { c.ready = !!m.on; sendRoom(c.room); } break;
      case 'start': startRoom(c); break;
      case 'state': relay(c, { t: 'state', g: String(m.g || '').slice(0, 260), s: m.s | 0, l: m.l | 0, lv: m.lv | 0, h: m.h || null, n: Array.isArray(m.n) ? m.n.slice(0, 5) : [] }); break;
      case 'attack': { const n = Math.max(0, Math.min(10, m.n | 0)); if (n) relay(c, { t: 'attack', n }); if (c.match) c.match.sent[c.key] = (c.match.sent[c.key] || 0) + n; break; }
      case 'topout': finishMatch(c.match, other(c.match, c), c, 'topout'); break;
      case 'rematch': rematch(c); break;
      case 'quit': if (c.match) finishMatch(c.match, other(c.match, c), c, 'quit'); else leaveRoom(c); break;
    }
  }

  // ---- quick match -------------------------------------------------------------------
  function enqueue(c) {
    if (c.match || c.room) return;
    if (!queue.includes(c)) { c.queuedAt = Date.now(); queue.push(c); }
    send(c, { t: 'queued', waiting: queue.length - 1 });
    // Pair with the closest rating among those waiting.
    const others = queue.filter((x) => x !== c);
    if (others.length) {
      others.sort((a, b) => Math.abs(a.rating - c.rating) - Math.abs(b.rating - c.rating));
      const o = others[0];
      queue = queue.filter((x) => x !== c && x !== o);
      startMatch([c, o], true);
      return;
    }
    setTimeout(() => { if (queue.includes(c)) { dequeue(c); send(c, { t: 'nomatch' }); } }, QUEUE_TIMEOUT_MS).unref();
  }
  function dequeue(c) { queue = queue.filter((x) => x !== c); }

  // ---- rooms ------------------------------------------------------------------------------
  function createRoom(c) {
    if (c.match) return; leaveRoom(c); dequeue(c);
    const room = { code: roomCode(), players: [c], createdAt: Date.now(), lastActive: Date.now() };
    rooms.set(room.code, room); c.room = room; c.host = true; c.ready = false;
    sendRoom(room);
  }
  function joinRoom(c, code) {
    const room = rooms.get(code);
    if (!room) return send(c, { t: 'error', msg: 'No room with that code. Check it with your friend.' });
    if (room.players.length >= 2 && !room.players.includes(c)) return send(c, { t: 'error', msg: 'That room is full.' });
    if (c.match) return; leaveRoom(c); dequeue(c);
    if (!room.players.includes(c)) room.players.push(c);
    c.room = room; c.host = false; c.ready = false; room.lastActive = Date.now();
    sendRoom(room);
  }
  function leaveRoom(c) {
    const room = c.room; if (!room) return;
    room.players = room.players.filter((x) => x !== c); c.room = null; c.ready = false; c.host = false;
    if (!room.players.length) rooms.delete(room.code);
    else { if (!room.players.some((p) => p.host)) room.players[0].host = true; sendRoom(room); }
  }
  function sendRoom(room) { const msg = { t: 'room', code: room.code, players: room.players.map(pub) }; room.players.forEach((p) => send(p, msg)); }
  function startRoom(c) {
    const room = c.room; if (!room || !c.host) return;
    if (room.players.length < 2) return send(c, { t: 'error', msg: 'Wait for a second player to join.' });
    if (!room.players.every((p) => p.ready)) return send(c, { t: 'error', msg: 'Everyone must press Ready.' });
    startMatch(room.players.slice(0, 2), false, room);
  }
  setInterval(() => { const now = Date.now(); for (const [code, r] of rooms) if (!r.players.length || r.lastActive < now - ROOM_IDLE_MS && !r.players.some((p) => p.match)) { r.players.forEach((p) => { p.room = null; }); rooms.delete(code); } }, 60000).unref();

  // ---- matches ---------------------------------------------------------------------------
  function other(match, c) { return match ? (match.players[0] === c ? match.players[1] : match.players[0]) : null; }
  function matchInfo(match, c) { const o = other(match, c); return { id: match.id, seed: match.seed, ranked: match.ranked, opp: pub(o), you: pub(c) }; }
  function startMatch(players, ranked, room) {
    const match = { id: id(8), seed: crypto.randomInt(0, 0x7fffffff), ranked, room: room || null, players, sent: {}, startedAt: Date.now(), done: false, rematch: new Set() };
    matches.set(match.id, match);
    players.forEach((p) => { p.match = match; p.ready = false; dequeue(p); send(p, { t: 'start', match: matchInfo(match, p) }); });
  }
  function relay(c, msg) { const o = other(c.match, c); if (o && !c.match.done) send(o, msg); }
  function finishMatch(match, winner, loser, reason) {
    if (!match || match.done || !winner || !loser) return;
    match.done = true;
    const time = Math.round((Date.now() - match.startedAt) / 1000);
    let dw = 0, dl = 0;
    if (match.ranked && winner.userId && loser.userId) {
      const e = elo(winner.rating, loser.rating, true);
      dw = e.da; dl = e.db; winner.rating = e.a; loser.rating = e.b;
      run('UPDATE users SET rating = ?, battles_w = battles_w + 1 WHERE id = ?', winner.rating, winner.userId);
      run('UPDATE users SET rating = ?, battles_l = battles_l + 1 WHERE id = ?', loser.rating, loser.userId);
    } else {
      if (winner.userId) run('UPDATE users SET battles_w = battles_w + 1 WHERE id = ?', winner.userId);
      if (loser.userId) run('UPDATE users SET battles_l = battles_l + 1 WHERE id = ?', loser.userId);
    }
    [[winner, 'win', dw, loser], [loser, 'loss', dl, winner]].forEach(([p, result, delta, opp]) => {
      if (p.userId && deps.insertRun) deps.insertRun(p.userId, { mode: 'battle', score: 0, lines: 0, level: 1, time, result, opponent: opp.name, ratingDelta: delta, attackSent: match.sent[p.key] || 0, coins: 0 }, true);
      send(p, { t: 'result', won: result === 'win', delta, rating: p.rating, reason, opp: pub(opp), ranked: match.ranked, sent: match.sent[p.key] || 0, time });
    });
    setTimeout(() => { if (matches.get(match.id) === match && !match.rematch.size) endMatch(match); }, 120000).unref();
  }
  function endMatch(match) { matches.delete(match.id); match.players.forEach((p) => { if (p.match === match) p.match = null; }); }
  function rematch(c) {
    const match = c.match; if (!match || !match.done) return;
    match.rematch.add(c.key);
    const o = other(match, c);
    if (match.rematch.size === 2 && o) { endMatch(match); startMatch([c, o], match.ranked, match.room); }
    else send(o, { t: 'rematch_wait' });
  }

  // ---- disconnects ---------------------------------------------------------------------------
  function onDisconnect(c) {
    c.ws = null; dequeue(c);
    if (c.match && !c.match.done) {
      const o = other(c.match, c); send(o, { t: 'opp_away', seconds: RECONNECT_GRACE_MS / 1000 });
      c.graceTimer = setTimeout(() => { if (!c.ws && c.match && !c.match.done) finishMatch(c.match, other(c.match, c), c, 'disconnect'); cleanup(c); }, RECONNECT_GRACE_MS).unref();
      return;
    }
    c.graceTimer = setTimeout(() => cleanup(c), RECONNECT_GRACE_MS).unref();
  }
  function cleanup(c) { if (c.ws) return; leaveRoom(c); if (c.match && c.match.done) endMatch(c.match); clients.delete(c.key); }

  return { wss, stats: () => ({ clients: clients.size, rooms: rooms.size, matches: matches.size, queue: queue.length }) };
}

module.exports = { attach, issueToken };
