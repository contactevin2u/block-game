/* Web server: serves the game and the API. */
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');

// Load .env (no dependency): KEY=value lines.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((l) => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); });

const api = require('./api');
const { PROVIDER: PAY } = require('./payments');
const { PROVIDER: EMAIL } = require('./email');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const root = path.join(__dirname, '..');

// Allowed front-end origins when the game is hosted elsewhere (Vercel). Comma-separated, e.g.
// CORS_ORIGIN=https://block-game.vercel.app,https://play.yourgame.com
const ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});

// Tells the front end to use the API instead of the browser-only backend.
app.get('/env.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store');
  res.send('window.APP_ENV=' + JSON.stringify({ mode: 'server', provider: PAY, emailProvider: EMAIL, gameName: process.env.GAME_NAME || null }) + ';');
});

app.use('/api', api);
app.use(express.static(root, { index: 'index.html', extensions: ['html'], setHeaders(res, p) { if (/\.(js|css)$/.test(p)) res.setHeader('Cache-Control', 'public, max-age=300'); } }));
app.get('*', (req, res) => res.sendFile(path.join(root, 'index.html')));

const port = parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => {
  console.log(`Block Game server on http://localhost:${port}  payments=${PAY}  email=${EMAIL}${ORIGINS.length ? '  cors=' + ORIGINS.join(',') : ''}`);
  if (PAY === 'mock') console.log('Payments are simulated. Set PAYMENT_PROVIDER=chip and the CHIP keys for real payments.');
  if (EMAIL === 'console') console.log('Emails are printed here and shown in the Test inbox. Set EMAIL_PROVIDER=resend and RESEND_API_KEY for real email.');
});
