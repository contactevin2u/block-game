/* Passwords (scrypt), opaque tokens, and the session cookie. */
'use strict';
const crypto = require('crypto');
const { row, run } = require('./db');

const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || '30', 10);
const COOKIE = 'sid';

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function token(bytes) { return crypto.randomBytes(bytes || 32).toString('base64url'); }
function id() { return crypto.randomBytes(9).toString('base64url'); }

function hashPassword(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => err ? reject(err) : resolve(`scrypt$${salt}$${key.toString('hex')}`));
  });
}
function verifyPassword(pw, stored) {
  return new Promise((resolve) => {
    const parts = (stored || '').split('$');
    if (parts.length !== 3) return resolve(false);
    crypto.scrypt(pw, parts[1], 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) return resolve(false);
      const a = Buffer.from(parts[2], 'hex');
      resolve(a.length === key.length && crypto.timingSafeEqual(a, key));
    });
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
function secure(req) { return (req.headers['x-forwarded-proto'] || req.protocol) === 'https'; }
// When the game is served from another site (CORS_ORIGIN set), the cookie must be SameSite=None and Secure.
const CROSS_SITE = !!(process.env.CORS_ORIGIN || '').trim();
function cookieOpts(req, maxAge) {
  const https = secure(req);
  // Through the Vercel proxy the request is same-site, so 'lax' is right; 'none' only when a different front-end origin calls directly.
  const direct = CROSS_SITE && https && !req.headers['x-vercel-id'];
  return { httpOnly: true, sameSite: direct ? 'none' : 'lax', secure: https, maxAge: maxAge, path: '/', domain: process.env.COOKIE_DOMAIN || undefined };
}

function createSession(req, res, userId) {
  const t = token(32), now = Date.now();
  run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, ua) VALUES (?, ?, ?, ?, ?, ?)', sha256(t), userId, now, now + SESSION_DAYS * 86400000, now, String(req.headers['user-agent'] || '').slice(0, 120));
  res.cookie(COOKIE, t, cookieOpts(req, SESSION_DAYS * 86400000));
  return t;
}
function clearSessionCookie(req, res) { res.cookie(COOKIE, '', cookieOpts(req, 0)); }

// Attaches req.user, req.sessionHash, req.expiredEmail. Slides the expiry forward on activity.
function loadSession(req, res, next) {
  const t = parseCookies(req)[COOKIE];
  req.user = null; req.sessionHash = null; req.expiredEmail = null;
  if (!t) return next();
  const h = sha256(t), s = row('SELECT * FROM sessions WHERE token_hash = ?', h), now = Date.now();
  if (!s) { clearSessionCookie(req, res); return next(); }
  if (s.expires_at < now) {
    const u = row('SELECT email FROM users WHERE id = ?', s.user_id);
    req.expiredEmail = u ? u.email : null;
    run('DELETE FROM sessions WHERE token_hash = ?', h);
    clearSessionCookie(req, res);
    return next();
  }
  const u = row('SELECT * FROM users WHERE id = ?', s.user_id);
  if (!u) { run('DELETE FROM sessions WHERE token_hash = ?', h); clearSessionCookie(req, res); return next(); }
  if (now - s.last_seen > 3600000) {
    run('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?', now, now + SESSION_DAYS * 86400000, h);
    res.cookie(COOKIE, t, cookieOpts(req, SESSION_DAYS * 86400000));
  }
  req.user = u; req.sessionHash = h;
  next();
}

function revokeSessions(userId, keepHash) {
  if (keepHash) return run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', userId, keepHash).changes;
  return run('DELETE FROM sessions WHERE user_id = ?', userId).changes;
}
function sessionCount(userId) { return row('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?', userId, Date.now()).n; }

// Simple in-memory rate limiter: n hits per window per key.
const buckets = new Map();
function rateLimit(name, max, windowMs) {
  return (req, res, next) => {
    const key = name + ':' + (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.count++;
    if (b.count > max) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();

module.exports = { sha256, token, id, hashPassword, verifyPassword, createSession, clearSessionCookie, loadSession, revokeSessions, sessionCount, rateLimit, SESSION_DAYS };
