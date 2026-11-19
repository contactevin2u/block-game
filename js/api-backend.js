/* Server-backed implementation of the Backend interface. Active only when the page is served by server/index.js,
   which provides /env.js with mode 'server'. Guests still live in this browser until they create an account. */
(function (root) {
  'use strict';
  var env = root.APP_ENV || {};
  var BASE = (env.apiBase || '').replace(/\/$/, '');
  if (env.mode !== 'server' && !BASE) return;
  env.mode = 'server';
  var GUEST_KEY = 'bg_guest_v1';
  var current = null, sessions = 0, expiredInfo = null, persistTimer = null;

  function api(method, path, body) {
    return fetch(BASE + '/api' + path, { method: method, credentials: BASE ? 'include' : 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || ('Request failed (' + r.status + ')')); return d; }); },
        function () { throw new Error('Cannot reach the game server. Check your connection and try again.'); });
  }
  function newGuest() {
    return { id: 'guest', guest: true, email: '', settings: { appearance: 'system', theme: 'classic', sound: true, ghost: true }, coins: 0, bestScore: 0, bestLevel: 1, gamesPlayed: 0,
      purchases: { removeAds: false, themes: [] }, inventory: {}, rating: 1000, battles: { w: 0, l: 0 }, adventure: { unlocked: 1, stages: {} }, createdAt: Date.now(), passwordChangedAt: Date.now(), runs: [] };
  }
  function guest() { try { var g = JSON.parse(localStorage.getItem(GUEST_KEY)); if (g && g.id === 'guest') return g; } catch (e) {} var u = newGuest(); try { localStorage.setItem(GUEST_KEY, JSON.stringify(u)); } catch (e) {} return u; }
  function saveGuest() { try { localStorage.setItem(GUEST_KEY, JSON.stringify(current)); } catch (e) {} }
  function adopt(d) { sessions = d.sessions || 0; current = d.user; current.guest = false; }

  function persist() {
    if (!current) return;
    if (current.guest) return saveGuest();
    clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      api('PATCH', '/me', { settings: current.settings, adventure: current.adventure, inventory: current.inventory, coins: current.coins, rating: current.rating, battles: current.battles, bestLevel: current.bestLevel, bestScore: current.bestScore })
        .then(function (d) { if (d.user) { current.purchases = d.user.purchases; current.coins = d.user.coins; current.email = d.user.email; } }).catch(function () {});
    }, 400);
  }

  var Backend = {
    api: api, env: env,
    init: function () {
      return api('GET', '/me').then(function (d) {
        if (d.user) adopt(d); else { if (d.expiredEmail) expiredInfo = { email: d.expiredEmail }; current = guest(); }
        if (d.emailProvider) env.emailProvider = d.emailProvider;
        if (d.provider) env.provider = d.provider;
        env.paymentsEnabled = !!d.paymentsEnabled; env.demoMode = !!d.demoMode;
        return current;
      }).catch(function () { current = guest(); return current; });
    },
    user: function () { return current || (current = guest()); },
    isGuest: function () { return !current || !!current.guest; },
    expired: function () { var e = expiredInfo; expiredInfo = null; return e; },
    update: function (patch) { for (var k in patch) current[k] = patch[k]; persist(); return current; },
    persist: persist,
    sessionCount: function () { return current && !current.guest ? sessions : 0; },

    signup: function (email, pw) {
      var g = current && current.guest ? { coins: current.coins, bestScore: current.bestScore, bestLevel: current.bestLevel, gamesPlayed: current.gamesPlayed, settings: current.settings, adventure: current.adventure, runs: current.runs } : null;
      return api('POST', '/auth/signup', { email: email, password: pw, guest: g }).then(function (d) { adopt(d); try { localStorage.removeItem(GUEST_KEY); } catch (e) {} return current; });
    },
    login: function (email, pw) { return api('POST', '/auth/login', { email: email, password: pw }).then(function (d) { adopt(d); return current; }); },
    logout: function () { api('POST', '/auth/logout').catch(function () {}); current = guest(); },
    logoutAll: function () { api('POST', '/auth/logout-all').catch(function () {}); current = guest(); },
    requestReset: function (email) { return api('POST', '/auth/forgot', { email: email }).then(function () { return true; }); },
    checkToken: function (t, type) { return api('GET', '/auth/token/' + encodeURIComponent(t) + '?type=' + type).then(function (d) { return d.status; }).catch(function () { return 'invalid'; }); },
    resetPassword: function (t, pw) { return api('POST', '/auth/reset', { token: t, password: pw }).then(function (d) { current = guest(); return d.email; }); },
    changePassword: function (cur, pw) { return api('POST', '/auth/change-password', { current: cur, password: pw }).then(function (d) { return d.others; }); },
    requestEmailChange: function (em, pw) { return api('POST', '/auth/change-email', { email: em, password: pw }).then(function () { return true; }); },
    confirmEmailChange: function (t) { return api('POST', '/auth/confirm-email', { token: t }).then(function (d) { if (current && !current.guest) current.email = d.email; return d.email; }); },

    saveRun: function (run) {
      run.at = Date.now(); run.id = Math.random().toString(36).slice(2, 10);
      var coins = run.coins || 0;
      current.gamesPlayed = (current.gamesPlayed || 0) + 1;
      current.coins += coins;
      if (run.mode === 'classic' && !run.continued && !run.usedEquipment && run.score > current.bestScore) current.bestScore = run.score;
      if (run.level > (current.bestLevel || 1)) current.bestLevel = run.level;
      if (current.guest) { current.runs = current.runs || []; current.runs.unshift(run); current.runs = current.runs.slice(0, 200); saveGuest(); return run; }
      api('POST', '/runs', run).then(function (d) { if (d.user) { current.coins = d.user.coins; current.bestScore = d.user.bestScore; current.bestLevel = d.user.bestLevel; current.gamesPlayed = d.user.gamesPlayed; } }).catch(function () {});
      return run;
    },
    runs: function () { if (current.guest) return Promise.resolve((current.runs || []).slice()); return api('GET', '/runs').then(function (d) { return d.runs; }); },
    emails: function () { if (env.emailProvider !== 'console') return Promise.resolve(null); return api('GET', '/dev/emails').then(function (d) { return d.emails; }).catch(function () { return []; }); },
    orders: function () { return {}; },
    saveOrder: function () {},
    wipe: function () { try { localStorage.removeItem(GUEST_KEY); } catch (e) {} current = guest(); }
  };

  root.Backend = Backend;
})(window);
