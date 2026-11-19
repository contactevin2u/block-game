/* Test backend. Stores accounts, sessions, runs, emails and tokens in this browser's localStorage.
   The real server will expose the same functions over HTTPS; the UI will not need to change. */
(function (root) {
  'use strict';
  var C = root.CONFIG;
  var DB_KEY = 'bg_db_v1', SESSION_KEY = 'bg_session', GUEST_KEY = 'bg_guest_v1';

  function empty() { return { users: {}, sessions: {}, runs: [], emails: [], tokens: {}, orders: {} }; }
  function load() { try { var d = JSON.parse(localStorage.getItem(DB_KEY)); return d && d.users ? d : empty(); } catch (e) { return empty(); } }
  function save(db) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { console.warn('Could not save', e); } }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function tokenStr() { return uid() + uid() + uid(); }
  function now() { return Date.now(); }
  function djb2(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }

  function hash(salt, pw) {
    var text = salt + ':' + pw;
    if (root.crypto && root.crypto.subtle && root.TextEncoder) {
      return root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }).catch(function () { return djb2(text); });
    }
    return Promise.resolve(djb2(text));
  }

  function newUser(email) {
    return {
      id: uid(), email: email.toLowerCase().trim(),
      settings: { appearance: 'system', theme: 'classic', sound: true, ghost: true },
      coins: 0, bestScore: 0, bestLevel: 1, gamesPlayed: 0,
      purchases: { removeAds: false, themes: [] },
      inventory: {}, rating: 1000, battles: { w: 0, l: 0 },
      adventure: { unlocked: 1, stages: {} },
      createdAt: now(), passwordChangedAt: now()
    };
  }

  var current = null;      // logged-in user record (live reference into db) or guest object
  var db = load();
  var expiredInfo = null;  // { email } when the last session expired after 30 days

  function guest() {
    try { var g = JSON.parse(localStorage.getItem(GUEST_KEY)); if (g && g.id === 'guest') return g; } catch (e) {}
    var u = newUser('guest@local'); u.id = 'guest'; u.email = ''; u.guest = true; u.runs = [];
    localStorage.setItem(GUEST_KEY, JSON.stringify(u));
    return u;
  }
  function persist() {
    if (!current) return;
    if (current.guest) localStorage.setItem(GUEST_KEY, JSON.stringify(current));
    else { db.users[current.id] = current; save(db); }
  }

  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || ''); }
  function findByEmail(email) { email = (email || '').toLowerCase().trim(); for (var id in db.users) if (db.users[id].email === email) return db.users[id]; return null; }

  function startSession(user) {
    var t = tokenStr();
    db.sessions[t] = { userId: user.id, expiresAt: now() + C.SESSION_DAYS * 86400000, createdAt: now(), device: navigator.userAgent.slice(0, 60) };
    localStorage.setItem(SESSION_KEY, t);
    save(db);
  }
  function revokeSessions(userId, keepToken) {
    for (var t in db.sessions) if (db.sessions[t].userId === userId && t !== keepToken) delete db.sessions[t];
    save(db);
  }
  function sessionCount(userId) { var n = 0; for (var t in db.sessions) if (db.sessions[t].userId === userId) n++; return n; }

  function sendEmail(to, subject, body, link) {
    db.emails.unshift({ id: uid(), to: to, subject: subject, body: body, link: link || null, at: now() });
    db.emails = db.emails.slice(0, 50);
    save(db);
  }

  function migrateGuest(user) {
    try {
      var g = JSON.parse(localStorage.getItem(GUEST_KEY));
      if (!g) return;
      user.coins += g.coins || 0;
      user.bestScore = Math.max(user.bestScore, g.bestScore || 0);
      user.gamesPlayed += g.gamesPlayed || 0;
      if (g.adventure && g.adventure.unlocked > user.adventure.unlocked) user.adventure = g.adventure;
      (g.runs || []).forEach(function (r) { r.userId = user.id; db.runs.push(r); });
      if (g.settings) user.settings = g.settings;
      localStorage.removeItem(GUEST_KEY);
    } catch (e) {}
  }

  var Backend = {
    // Returns the current user (never null: a guest object when nobody is logged in).
    init: function () {
      db = load();
      var t = localStorage.getItem(SESSION_KEY);
      if (t && db.sessions[t]) {
        var s = db.sessions[t];
        if (s.expiresAt > now() && db.users[s.userId]) {
          s.expiresAt = now() + C.SESSION_DAYS * 86400000; // sliding expiry
          current = db.users[s.userId]; save(db);
          return current;
        }
        if (db.users[s.userId]) expiredInfo = { email: db.users[s.userId].email };
        delete db.sessions[t]; save(db);
      }
      localStorage.removeItem(SESSION_KEY);
      current = guest();
      return current;
    },
    user: function () { return current || (current = guest()); },
    isGuest: function () { return !current || !!current.guest; },
    expired: function () { var e = expiredInfo; expiredInfo = null; return e; },
    update: function (patch) { for (var k in patch) current[k] = patch[k]; persist(); return current; },
    persist: persist,
    sessionCount: function () { return current && !current.guest ? sessionCount(current.id) : 0; },

    signup: function (email, pw) {
      if (!validEmail(email)) return Promise.reject(new Error('Enter a valid email address.'));
      if (!pw || pw.length < 8) return Promise.reject(new Error('Password must be at least 8 characters.'));
      if (findByEmail(email)) return Promise.reject(new Error('That email already has an account. Log in instead.'));
      var u = newUser(email), salt = uid();
      return hash(salt, pw).then(function (h) {
        u.salt = salt; u.passHash = h;
        migrateGuest(u);
        db.users[u.id] = u; current = u; startSession(u);
        sendEmail(u.email, 'Welcome to ' + C.GAME_NAME, 'Your account is ready. Your scores, themes and purchases are saved to it.');
        return u;
      });
    },

    login: function (email, pw) {
      var u = findByEmail(email);
      if (!u) return Promise.reject(new Error('No account with that email. Check the spelling or create one.'));
      return hash(u.salt, pw).then(function (h) {
        if (h !== u.passHash) throw new Error('Wrong password. Try again or use Forgot password.');
        current = u; startSession(u); return u;
      });
    },

    logout: function () { var t = localStorage.getItem(SESSION_KEY); if (t) delete db.sessions[t]; localStorage.removeItem(SESSION_KEY); save(db); current = guest(); },
    logoutAll: function () { if (current && !current.guest) revokeSessions(current.id, null); localStorage.removeItem(SESSION_KEY); current = guest(); },

    requestReset: function (email) {
      var u = findByEmail(email);
      // Always report success so nobody can probe which emails exist.
      if (u) {
        var t = tokenStr();
        db.tokens[t] = { type: 'reset', userId: u.id, expiresAt: now() + C.RESET_LINK_MINUTES * 60000, used: false };
        sendEmail(u.email, 'Reset your password', 'Someone asked to reset the password for this account. If it was you, open the link within ' + C.RESET_LINK_MINUTES + ' minutes. If not, ignore this email.', '#/reset/' + t);
      }
      save(db);
      return Promise.resolve(true);
    },

    checkToken: function (t, type) { var k = db.tokens[t]; if (!k || k.type !== type || k.used) return 'invalid'; if (k.expiresAt < now()) return 'expired'; return 'ok'; },

    resetPassword: function (t, pw) {
      var st = this.checkToken(t, 'reset');
      if (st !== 'ok') return Promise.reject(new Error(st === 'expired' ? 'This link has expired. Request a new one.' : 'This link is not valid.'));
      if (!pw || pw.length < 8) return Promise.reject(new Error('Password must be at least 8 characters.'));
      var k = db.tokens[t], u = db.users[k.userId], salt = uid();
      return hash(salt, pw).then(function (h) {
        u.salt = salt; u.passHash = h; u.passwordChangedAt = now(); k.used = true;
        revokeSessions(u.id, null); localStorage.removeItem(SESSION_KEY); current = guest();
        sendEmail(u.email, 'Your password was changed', 'Your password was reset just now. All devices were logged out.');
        return u.email;
      });
    },

    changePassword: function (cur, pw) {
      var u = current;
      if (!u || u.guest) return Promise.reject(new Error('Log in first.'));
      if (!pw || pw.length < 8) return Promise.reject(new Error('New password must be at least 8 characters.'));
      if (pw === cur) return Promise.reject(new Error('New password must be different from the current one.'));
      return hash(u.salt, cur).then(function (h) {
        if (h !== u.passHash) throw new Error('Current password is wrong.');
        var salt = uid();
        return hash(salt, pw).then(function (h2) {
          u.salt = salt; u.passHash = h2; u.passwordChangedAt = now();
          var others = sessionCount(u.id) - 1;
          revokeSessions(u.id, localStorage.getItem(SESSION_KEY));
          sendEmail(u.email, 'Your password was changed', 'If this was not you, reset your password now.');
          persist();
          return others;
        });
      });
    },

    requestEmailChange: function (newEmail, pw) {
      var u = current;
      if (!u || u.guest) return Promise.reject(new Error('Log in first.'));
      if (!validEmail(newEmail)) return Promise.reject(new Error('Enter a valid email address.'));
      if (newEmail.toLowerCase().trim() === u.email) return Promise.reject(new Error('That is already your email.'));
      if (findByEmail(newEmail)) return Promise.reject(new Error('That email is used by another account.'));
      return hash(u.salt, pw).then(function (h) {
        if (h !== u.passHash) throw new Error('Current password is wrong.');
        var t = tokenStr();
        db.tokens[t] = { type: 'email', userId: u.id, newEmail: newEmail.toLowerCase().trim(), expiresAt: now() + C.RESET_LINK_MINUTES * 60000, used: false };
        sendEmail(newEmail, 'Confirm your new email', 'Open the link to make this the login email for your account.', '#/confirm-email/' + t);
        sendEmail(u.email, 'Email change requested', 'A request was made to change this account\'s email to ' + newEmail + '. If this was not you, change your password now.');
        save(db);
        return true;
      });
    },

    confirmEmailChange: function (t) {
      var st = this.checkToken(t, 'email');
      if (st !== 'ok') return Promise.reject(new Error(st === 'expired' ? 'This link has expired. Request the change again.' : 'This link is not valid.'));
      var k = db.tokens[t], u = db.users[k.userId];
      var old = u.email; u.email = k.newEmail; k.used = true; save(db);
      sendEmail(old, 'Your login email changed', 'This account now logs in with ' + u.email + '.');
      return Promise.resolve(u.email);
    },

    saveRun: function (run) {
      run.id = uid(); run.at = now(); run.userId = current.id;
      if (current.guest) { current.runs = current.runs || []; current.runs.unshift(run); current.runs = current.runs.slice(0, 200); }
      else { db.runs.unshift(run); db.runs = db.runs.slice(0, 2000); }
      current.gamesPlayed = (current.gamesPlayed || 0) + 1;
      current.coins += run.coins || 0;
      if (run.mode === 'classic' && run.score > current.bestScore) current.bestScore = run.score;
      if (run.level > (current.bestLevel || 1)) current.bestLevel = run.level;
      persist();
      return run;
    },
    runs: function () {
      if (current.guest) return (current.runs || []).slice();
      var id = current.id; return db.runs.filter(function (r) { return r.userId === id; });
    },

    emails: function () { return db.emails.slice(); },
    orders: function () { return db.orders; },
    saveOrder: function (o) { db.orders[o.id] = o; save(db); },
    wipe: function () { localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION_KEY); localStorage.removeItem(GUEST_KEY); db = empty(); current = guest(); }
  };

  root.Backend = Backend;
})(window);
