/* REST API. Mirrors the browser backend's functions so the front end switches with no screen changes. */
'use strict';
const express = require('express');
const { row, all, run, db } = require('./db');
const auth = require('./auth');
const email = require('./email');
const { provider: pay, PROVIDER: PAY_PROVIDER } = require('./payments');

global.window = global.window || {};
require('../js/config.js');
const CONFIG = global.window.CONFIG;
const THEME_IDS = ['lcd', 'neon', 'paper', 'glass', 'ember'];
const RESET_MINUTES = CONFIG.RESET_LINK_MINUTES || 30;

const r = express.Router();
r.use(express.json({ limit: '64kb' }));
r.use(auth.loadSession);

// BASE_URL is where players open the game (Vercel or this server). API_URL is this server, for gateway callbacks.
function selfUrl(req) { return ((req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.get('host')).replace(/\/$/, ''); }
function baseUrl(req) { return (process.env.BASE_URL || selfUrl(req)).replace(/\/$/, ''); }
function apiUrl(req) { return (process.env.API_URL || selfUrl(req)).replace(/\/$/, ''); }
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '') && e.length <= 200; }
function norm(e) { return String(e || '').toLowerCase().trim(); }
function j(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
function bad(res, msg, code) { return res.status(code || 400).json({ error: msg }); }
function needUser(req, res, next) { if (!req.user) return bad(res, 'Log in first.', 401); next(); }

function toClient(u) {
  return {
    id: u.id, email: u.email, createdAt: u.created_at, passwordChangedAt: u.password_changed_at,
    settings: Object.assign({ appearance: 'system', theme: 'classic', sound: true, ghost: true }, j(u.settings, {})),
    coins: u.coins, bestScore: u.best_score, bestLevel: u.best_level, gamesPlayed: u.games_played,
    purchases: { removeAds: !!u.remove_ads, themes: j(u.themes, []) },
    inventory: j(u.inventory, {}), rating: u.rating, battles: { w: u.battles_w, l: u.battles_l },
    adventure: j(u.adventure, { unlocked: 1, stages: {} })
  };
}
function meResponse(req) { return { user: req.user ? toClient(req.user) : null, sessions: req.user ? auth.sessionCount(req.user.id) : 0, expiredEmail: req.expiredEmail || null, provider: PAY_PROVIDER, emailProvider: email.PROVIDER }; }
function fresh(req) { req.user = row('SELECT * FROM users WHERE id = ?', req.user.id); return toClient(req.user); }

async function mail(to, subject, body, link, linkText) { try { await email.send({ to, subject, body, link, linkText }); } catch (e) { console.error('[email] failed:', e.message); } }
function notFoundOrOk(res) { return res.json({ ok: true }); }

// ---- health / me --------------------------------------------------------------
r.get('/health', (req, res) => res.json({ ok: true, provider: PAY_PROVIDER, email: email.PROVIDER }));
r.get('/me', (req, res) => res.json(meResponse(req)));

r.patch('/me', needUser, (req, res) => {
  const b = req.body || {}, u = req.user;
  const settings = b.settings && typeof b.settings === 'object' ? JSON.stringify(Object.assign(j(u.settings, {}), b.settings)) : u.settings;
  const adventure = b.adventure && typeof b.adventure === 'object' ? JSON.stringify(b.adventure) : u.adventure;
  const inventory = b.inventory && typeof b.inventory === 'object' ? JSON.stringify(b.inventory) : u.inventory;
  const coins = Number.isFinite(b.coins) ? Math.max(0, Math.min(1e7, Math.floor(b.coins))) : u.coins;
  const rating = Number.isFinite(b.rating) ? Math.max(0, Math.min(5000, Math.floor(b.rating))) : u.rating;
  const bw = b.battles && Number.isFinite(b.battles.w) ? b.battles.w : u.battles_w, bl = b.battles && Number.isFinite(b.battles.l) ? b.battles.l : u.battles_l;
  const bestLevel = Number.isFinite(b.bestLevel) ? Math.max(u.best_level, Math.min(99, b.bestLevel)) : u.best_level;
  const bestScore = Number.isFinite(b.bestScore) ? Math.max(u.best_score, b.bestScore) : u.best_score;
  run('UPDATE users SET settings=?, adventure=?, inventory=?, coins=?, rating=?, battles_w=?, battles_l=?, best_level=?, best_score=? WHERE id=?', settings, adventure, inventory, coins, rating, bw, bl, bestLevel, bestScore, u.id);
  res.json({ user: fresh(req) });
});

// ---- auth ---------------------------------------------------------------------------
r.post('/auth/signup', auth.rateLimit('signup', 10, 15 * 60000), async (req, res) => {
  const em = norm(req.body.email), pw = String(req.body.password || '');
  if (!validEmail(em)) return bad(res, 'Enter a valid email address.');
  if (pw.length < 8 || pw.length > 200) return bad(res, 'Password must be at least 8 characters.');
  if (row('SELECT id FROM users WHERE email = ?', em)) return bad(res, 'That email already has an account. Log in instead.');
  const id = auth.id(), now = Date.now(), hash = await auth.hashPassword(pw);
  const g = req.body.guest && typeof req.body.guest === 'object' ? req.body.guest : {};
  run('INSERT INTO users (id, email, pass_hash, created_at, password_changed_at, settings, coins, best_score, best_level, games_played, adventure) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    id, em, hash, now, now, JSON.stringify(g.settings && typeof g.settings === 'object' ? g.settings : {}),
    Math.min(5000, Math.max(0, Math.floor(g.coins || 0))), Math.max(0, Math.floor(g.bestScore || 0)), Math.max(1, Math.min(99, Math.floor(g.bestLevel || 1))), Math.max(0, Math.floor(g.gamesPlayed || 0)),
    JSON.stringify(g.adventure && typeof g.adventure === 'object' ? g.adventure : { unlocked: 1, stages: {} }));
  (Array.isArray(g.runs) ? g.runs.slice(0, 200) : []).forEach((x) => insertRun(id, x, false));
  auth.createSession(req, res, id);
  req.user = row('SELECT * FROM users WHERE id = ?', id);
  mail(em, 'Welcome to ' + (process.env.GAME_NAME || CONFIG.GAME_NAME), 'Your account is ready. Your scores, themes and purchases are saved to it.');
  res.json(meResponse(req));
});

r.post('/auth/login', auth.rateLimit('login', 20, 15 * 60000), async (req, res) => {
  const em = norm(req.body.email), pw = String(req.body.password || '');
  const u = row('SELECT * FROM users WHERE email = ?', em);
  if (!u) return bad(res, 'No account with that email. Check the spelling or create one.');
  if (!(await auth.verifyPassword(pw, u.pass_hash))) return bad(res, 'Wrong password. Try again or use Forgot password.');
  auth.createSession(req, res, u.id);
  req.user = u; req.expiredEmail = null;
  res.json(meResponse(req));
});

r.post('/auth/logout', (req, res) => { if (req.sessionHash) run('DELETE FROM sessions WHERE token_hash = ?', req.sessionHash); auth.clearSessionCookie(req, res); res.json({ ok: true }); });
r.post('/auth/logout-all', needUser, (req, res) => { auth.revokeSessions(req.user.id, null); auth.clearSessionCookie(req, res); res.json({ ok: true }); });

r.post('/auth/forgot', auth.rateLimit('forgot', 5, 15 * 60000), (req, res) => {
  const em = norm(req.body.email);
  const u = row('SELECT * FROM users WHERE email = ?', em);
  if (u) {
    const t = auth.token(32);
    run('INSERT INTO tokens (token_hash, type, user_id, expires_at) VALUES (?,?,?,?)', auth.sha256(t), 'reset', u.id, Date.now() + RESET_MINUTES * 60000);
    mail(u.email, 'Reset your password', `Someone asked to reset the password for this account. If it was you, open the link within ${RESET_MINUTES} minutes. If not, ignore this email and nothing changes.`, baseUrl(req) + '/#/reset/' + t, 'Choose a new password');
  }
  notFoundOrOk(res); // same answer whether or not the email exists
});

function tokenStatus(t, type) {
  const k = row('SELECT * FROM tokens WHERE token_hash = ?', auth.sha256(String(t || '')));
  if (!k || k.type !== type || k.used) return { status: 'invalid' };
  if (k.expires_at < Date.now()) return { status: 'expired' };
  return { status: 'ok', token: k };
}
r.get('/auth/token/:t', (req, res) => res.json({ status: tokenStatus(req.params.t, req.query.type === 'email' ? 'email' : 'reset').status }));

r.post('/auth/reset', auth.rateLimit('reset', 10, 15 * 60000), async (req, res) => {
  const st = tokenStatus(req.body.token, 'reset');
  if (st.status !== 'ok') return bad(res, st.status === 'expired' ? 'This link has expired. Request a new one.' : 'This link is not valid.');
  const pw = String(req.body.password || '');
  if (pw.length < 8) return bad(res, 'Password must be at least 8 characters.');
  const u = row('SELECT * FROM users WHERE id = ?', st.token.user_id);
  run('UPDATE users SET pass_hash = ?, password_changed_at = ? WHERE id = ?', await auth.hashPassword(pw), Date.now(), u.id);
  run('UPDATE tokens SET used = 1 WHERE token_hash = ?', st.token.token_hash);
  auth.revokeSessions(u.id, null); auth.clearSessionCookie(req, res);
  mail(u.email, 'Your password was changed', 'Your password was reset just now and all devices were logged out. If this was not you, reset it again immediately.');
  res.json({ email: u.email });
});

r.post('/auth/change-password', needUser, auth.rateLimit('chpw', 10, 15 * 60000), async (req, res) => {
  const cur = String(req.body.current || ''), pw = String(req.body.password || ''), u = req.user;
  if (pw.length < 8) return bad(res, 'New password must be at least 8 characters.');
  if (pw === cur) return bad(res, 'New password must be different from the current one.');
  if (!(await auth.verifyPassword(cur, u.pass_hash))) return bad(res, 'Current password is wrong.');
  run('UPDATE users SET pass_hash = ?, password_changed_at = ? WHERE id = ?', await auth.hashPassword(pw), Date.now(), u.id);
  const others = auth.revokeSessions(u.id, req.sessionHash);
  mail(u.email, 'Your password was changed', 'If this was not you, reset your password now using Forgot password.');
  res.json({ others });
});

r.post('/auth/change-email', needUser, auth.rateLimit('chem', 5, 15 * 60000), async (req, res) => {
  const em = norm(req.body.email), pw = String(req.body.password || ''), u = req.user;
  if (!validEmail(em)) return bad(res, 'Enter a valid email address.');
  if (em === u.email) return bad(res, 'That is already your email.');
  if (row('SELECT id FROM users WHERE email = ?', em)) return bad(res, 'That email is used by another account.');
  if (!(await auth.verifyPassword(pw, u.pass_hash))) return bad(res, 'Current password is wrong.');
  const t = auth.token(32);
  run('INSERT INTO tokens (token_hash, type, user_id, payload, expires_at) VALUES (?,?,?,?,?)', auth.sha256(t), 'email', u.id, em, Date.now() + RESET_MINUTES * 60000);
  mail(em, 'Confirm your new email', `Open the link within ${RESET_MINUTES} minutes to make this the login email for your account. Your scores, themes and purchases stay exactly as they are.`, baseUrl(req) + '/#/confirm-email/' + t, 'Confirm this email');
  mail(u.email, 'Email change requested', `A request was made to change this account's email to ${em}. If this was not you, change your password now.`);
  res.json({ ok: true });
});

r.post('/auth/confirm-email', (req, res) => {
  const st = tokenStatus(req.body.token, 'email');
  if (st.status !== 'ok') return bad(res, st.status === 'expired' ? 'This link has expired. Request the change again.' : 'This link is not valid.');
  const u = row('SELECT * FROM users WHERE id = ?', st.token.user_id), em = st.token.payload;
  if (row('SELECT id FROM users WHERE email = ? AND id <> ?', em, u.id)) return bad(res, 'That email is now used by another account.');
  run('UPDATE users SET email = ? WHERE id = ?', em, u.id);
  run('UPDATE tokens SET used = 1 WHERE token_hash = ?', st.token.token_hash);
  mail(u.email, 'Your login email changed', `This account now logs in with ${em}.`);
  res.json({ email: em });
});

// ---- runs ------------------------------------------------------------------------
function insertRun(userId, x, award) {
  const n = (v, d) => Number.isFinite(v) ? Math.floor(v) : d;
  const coins = Math.max(0, Math.min(2000, n(x.coins, 0)));
  run('INSERT INTO runs (id, user_id, at, mode, stage, score, lines, level, time, pps, tetrises, tspins, continued, used_equipment, result, theme, device, opponent, rating_delta, attack_sent, coins) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    auth.id(), userId, n(x.at, Date.now()), String(x.mode || 'classic').slice(0, 20), x.stage == null ? null : n(x.stage, null), n(x.score, 0), n(x.lines, 0), n(x.level, 1), n(x.time, 0), Number.isFinite(x.pps) ? x.pps : null, n(x.tetrises, 0), n(x.tspins, 0), x.continued ? 1 : 0, x.usedEquipment ? 1 : 0,
    x.result ? String(x.result).slice(0, 10) : null, x.theme ? String(x.theme).slice(0, 20) : null, x.device ? String(x.device).slice(0, 20) : null, x.opponent ? String(x.opponent).slice(0, 40) : null, x.ratingDelta == null ? null : n(x.ratingDelta, 0), n(x.attackSent, 0), coins);
  if (award) {
    const u = row('SELECT * FROM users WHERE id = ?', userId);
    const best = x.mode === 'classic' && !x.continued && !x.usedEquipment ? Math.max(u.best_score, n(x.score, 0)) : u.best_score;
    run('UPDATE users SET coins = coins + ?, games_played = games_played + 1, best_score = ?, best_level = MAX(best_level, ?) WHERE id = ?', coins, best, Math.min(99, n(x.level, 1)), userId);
  }
}
r.post('/runs', needUser, (req, res) => { insertRun(req.user.id, req.body || {}, true); res.json({ user: fresh(req) }); });
r.get('/runs', needUser, (req, res) => {
  const list = all('SELECT * FROM runs WHERE user_id = ? ORDER BY at DESC LIMIT 500', req.user.id).map((x) => ({ id: x.id, at: x.at, mode: x.mode, stage: x.stage, score: x.score, lines: x.lines, level: x.level, time: x.time, pps: x.pps, tetrises: x.tetrises, tspins: x.tspins, continued: !!x.continued, usedEquipment: !!x.used_equipment, result: x.result, theme: x.theme, device: x.device, opponent: x.opponent, ratingDelta: x.rating_delta, attackSent: x.attack_sent, coins: x.coins }));
  res.json({ runs: list });
});

// ---- orders and payments --------------------------------------------------------------
function catalogueItem(type, id) {
  const P = CONFIG.PRICES;
  if (type === 'removeAds') return { type, id: 'removeAds', name: 'Remove Ads', price: P.removeAds };
  if (type === 'bundle') return { type, id: 'bundle', name: 'Everything bundle', price: P.bundle };
  if (type === 'theme' && THEME_IDS.includes(id)) return { type, id, name: ({ lcd: 'Pocket LCD', neon: 'Neon Grid', paper: 'Ink and Paper', glass: 'Deep Glass', ember: 'Ember Forge' })[id] + ' theme', price: P.themes[id] };
  if (type === 'coins') { const p = P.coins.find((c) => c.id === id); if (p) return { type, id, name: p.coins.toLocaleString() + ' coins', price: p.price, coins: p.coins }; }
  return null;
}
function orderToClient(o) { return { id: o.id, status: o.status, method: o.method, provider: o.provider, createdAt: o.created_at, paidAt: o.paid_at, item: { type: o.type, id: o.item_id, name: o.name, price: o.price_cents / 100, coins: o.coins } }; }

// Idempotent grant: a second webhook or a poll after payment changes nothing.
function grant(orderId) {
  const o = row('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o || o.status === 'paid') return o;
  const u = row('SELECT * FROM users WHERE id = ?', o.user_id);
  if (!u) return o;
  const tx = db.prepare('BEGIN'); tx.run();
  try {
    run('UPDATE orders SET status = ?, paid_at = ? WHERE id = ? AND status <> ?', 'paid', Date.now(), o.id, 'paid');
    if (o.type === 'removeAds') run('UPDATE users SET remove_ads = 1 WHERE id = ?', u.id);
    else if (o.type === 'theme') { const t = j(u.themes, []); if (!t.includes(o.item_id)) t.push(o.item_id); run('UPDATE users SET themes = ? WHERE id = ?', JSON.stringify(t), u.id); }
    else if (o.type === 'bundle') run('UPDATE users SET remove_ads = 1, themes = ? WHERE id = ?', JSON.stringify(THEME_IDS), u.id);
    else if (o.type === 'coins') run('UPDATE users SET coins = coins + ? WHERE id = ?', o.coins, u.id);
    db.prepare('COMMIT').run();
  } catch (e) { db.prepare('ROLLBACK').run(); throw e; }
  mail(u.email, 'Receipt: ' + o.name, `Thank you. Order ${o.id} for ${o.name} (RM ${(o.price_cents / 100).toFixed(2)}) is complete and is now on your account.`);
  return row('SELECT * FROM orders WHERE id = ?', orderId);
}

r.post('/orders', needUser, auth.rateLimit('orders', 20, 15 * 60000), async (req, res) => {
  const item = catalogueItem(req.body.type, req.body.id);
  if (!item) return bad(res, 'Unknown item.');
  const u = req.user, owned = j(u.themes, []);
  if (item.type === 'removeAds' && u.remove_ads) return bad(res, 'You already own Remove Ads.');
  if (item.type === 'theme' && owned.includes(item.id)) return bad(res, 'You already own this theme.');
  const id = 'ord_' + auth.token(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 8);
  const o = { id, user_id: u.id, type: item.type, item_id: item.id, name: item.name, price_cents: Math.round(item.price * 100), coins: item.coins || 0, status: 'pending', provider: pay.name, provider_ref: null, method: null, created_at: Date.now() };
  try {
    const ck = await pay.createCheckout(o, { baseUrl: baseUrl(req), apiUrl: apiUrl(req), email: u.email });
    o.provider_ref = ck.providerRef;
    run('INSERT INTO orders (id, user_id, type, item_id, name, price_cents, coins, status, provider, provider_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', o.id, o.user_id, o.type, o.item_id, o.name, o.price_cents, o.coins, o.status, o.provider, o.provider_ref, o.created_at);
    res.json({ order: orderToClient(o), checkoutUrl: ck.checkoutUrl });
  } catch (e) { console.error('[orders]', e.message); bad(res, 'Could not start the payment. Try again in a moment.', 502); }
});

r.get('/orders/:id', needUser, async (req, res) => {
  let o = row('SELECT * FROM orders WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!o) return bad(res, 'Order not found.', 404);
  if (o.status === 'pending' && o.created_at < Date.now() - 30 * 60000) { run('UPDATE orders SET status = ? WHERE id = ?', 'expired', o.id); o.status = 'expired'; }
  if (o.provider !== 'mock' && (o.status === 'pending' || o.status === 'processing')) {
    try { const v = await pay.verify(o); if (v === 'paid') o = grant(o.id); else if (v === 'failed') { run('UPDATE orders SET status = ? WHERE id = ?', 'failed', o.id); o.status = 'failed'; } } catch (e) { console.error('[verify]', e.message); }
  }
  res.json({ order: orderToClient(o), user: fresh(req) });
});

// Mock gateway steps (PAYMENT_PROVIDER=mock only).
r.post('/orders/:id/mock', needUser, (req, res) => {
  if (pay.name !== 'mock') return bad(res, 'Not available.', 404);
  const o = row('SELECT * FROM orders WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!o) return bad(res, 'Order not found.', 404);
  const a = req.body.action;
  if (a === 'choose' && o.status === 'pending') run('UPDATE orders SET status = ?, method = ? WHERE id = ?', 'authorizing', String(req.body.method || '').slice(0, 20), o.id);
  else if (a === 'approve' && o.status === 'authorizing') { run('UPDATE orders SET status = ? WHERE id = ?', 'processing', o.id); setTimeout(() => { try { grant(o.id); } catch (e) { console.error(e); } }, 1500); }
  else if (a === 'cancel' && (o.status === 'pending' || o.status === 'authorizing')) run('UPDATE orders SET status = ? WHERE id = ?', 'cancelled', o.id);
  res.json({ order: orderToClient(row('SELECT * FROM orders WHERE id = ?', o.id)) });
});

// CHIP success callback. The body is not trusted; the order is re-verified against CHIP's API.
r.post('/payments/chip/callback', express.urlencoded({ extended: false }), async (req, res) => {
  const ref = (req.body && (req.body.id || req.body.purchase_id)) || req.query.id;
  const o = ref ? row('SELECT * FROM orders WHERE provider_ref = ?', String(ref)) : null;
  if (!o) return res.status(200).send('ignored');
  try { if ((await pay.verify(o)) === 'paid') grant(o.id); } catch (e) { console.error('[chip callback]', e.message); }
  res.send('ok');
});

// Dev inbox (console email provider only).
r.get('/dev/emails', (req, res) => { if (email.PROVIDER !== 'console') return bad(res, 'Not available.', 404); res.json({ emails: email.devInbox }); });

r.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server.' }); });

module.exports = r;
