/* Screens and hash router. Every screen is a function that returns HTML and then binds events. */
(function (root) {
  'use strict';
  var C = root.CONFIG, B = root.Backend, S = root.Store, T = root.Themes, R = root.Renderer, A = root.Adventure;
  var app = null, current = null, toastTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, el) { return (el || app).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || app).querySelectorAll(sel)); }
  function go(hash) { location.hash = hash; }
  function toast(msg, kind) { var t = $('#toast', document); t.textContent = msg; t.className = 'toast show ' + (kind || ''); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200); }
  function money(n) { return S.money(n); }
  function isApple() { return /iPhone|iPad|Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS/.test(navigator.userAgent); }
  function fmtDate(ts) { var d = new Date(ts), now = new Date(); var same = d.toDateString() === now.toDateString(); return same ? 'Today ' + d.toTimeString().slice(0, 5) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toTimeString().slice(0, 5); }
  function fmtTime(t) { t = Math.floor(t || 0); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }

  function isLocal() { return !(root.APP_ENV && root.APP_ENV.mode === 'server'); }
  // Local 2-player needs a physical keyboard and room for two boards: no touch devices, no narrow windows.
  function canLocal() { var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; return !touch && window.innerWidth >= 900; }
  function testTools() { return isLocal() || (root.APP_ENV && root.APP_ENV.emailProvider === 'console'); }
  function applyAppearance(mode) {
    var el = document.documentElement;
    if (mode === 'light' || mode === 'dark') el.setAttribute('data-theme', mode); else el.removeAttribute('data-theme');
  }

  // ---- shared fragments ------------------------------------------------------
  // Logo at the top left of every screen. Tapping it goes to the lobby.
  function logo() {
    return '<a class="logo" href="#/lobby" aria-label="' + esc(C.GAME_NAME) + ', go to lobby">' +
      '<svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26"><rect x="9" y="1" width="8" height="8" rx="1.5" fill="#a64ddb"/><rect x="1" y="9" width="8" height="8" rx="1.5" fill="#a64ddb"/><rect x="9" y="9" width="8" height="8" rx="1.5" fill="#a64ddb"/><rect x="17" y="9" width="8" height="8" rx="1.5" fill="#a64ddb"/><rect x="1" y="17" width="8" height="8" rx="1.5" fill="#1ec8e8"/><rect x="9" y="17" width="8" height="8" rx="1.5" fill="#f5d020"/><rect x="17" y="17" width="8" height="8" rx="1.5" fill="#e8453c"/></svg>' +
      '<span>' + esc(C.GAME_NAME) + '</span></a>';
  }
  function header(backHash, backLabel, right) {
    return '<div class="topbar"><div class="topbar-left">' + logo() + (backHash ? '<a class="back" href="' + backHash + '">&#8249; ' + esc(backLabel || 'Back') + '</a>' : '') + '</div>' +
      (right !== undefined ? right : '<span></span>') + '</div>';
  }
  function logoMark(cell) {
    cell = cell || 18;
    var rows = ['..T.....', '.TTT.ZZ.', 'IIII..ZZ', 'LLLSSOOJ'], colors = T.list[0].pieces, html = '<div class="mark" role="img" aria-label="Stacked blocks" style="grid-template-columns:repeat(8,' + cell + 'px);grid-auto-rows:' + cell + 'px">';
    rows.forEach(function (r) { for (var i = 0; i < r.length; i++) html += '<i' + (r[i] !== '.' ? ' style="background:' + colors[r[i]] + '"' : '') + '></i>'; });
    return html + '</div>';
  }
  function field(id, label, type, placeholder, extra) {
    return '<div class="field"><div class="field-head"><label for="' + id + '">' + esc(label) + '</label>' + (extra || '') + '</div><input class="input" id="' + id + '" name="' + id + '" type="' + type + '" placeholder="' + esc(placeholder || '') + '" autocomplete="' + (type === 'email' ? 'email' : (id.indexOf('new') >= 0 ? 'new-password' : 'current-password')) + '"><p class="err" data-err="' + id + '"></p></div>';
  }
  function showErr(id, msg) { var e = $('[data-err="' + id + '"]'); if (e) e.textContent = msg || ''; var i = $('#' + id); if (i) i.classList.toggle('bad', !!msg); }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function passToggle() { $$('[data-toggle-pass]').forEach(function (b) { b.addEventListener('click', function () { var inp = $('#' + b.getAttribute('data-toggle-pass')); inp.type = inp.type === 'password' ? 'text' : 'password'; b.textContent = inp.type === 'password' ? 'Show' : 'Hide'; }); }); }
  function inboxLink() { return testTools() ? '<p class="muted small center">Email is in test mode: messages appear in the <a href="#/inbox">Test inbox</a>.</p>' : ''; }
  function paymentsMock() { return isLocal() || !root.APP_ENV || root.APP_ENV.provider === 'mock'; }
  // Demo payments: the simulated checkout, shown with a clear banner. True in browser-only mode and when the server runs with DEMO_MODE=true.
  function demoMode() { return isLocal() || !!(root.APP_ENV && root.APP_ENV.demoMode); }
  function demoBanner() { return demoMode() ? '<div class="notice demo" role="note"><b>Demo: no real money is charged</b><p>Purchases here are pretend. Nothing is sent to any bank or wallet, and you are never asked for real card numbers, real PINs or phone numbers.</p></div>' : ''; }
  // PAYMENTS_ENABLED on the server. Browser-only mode is always "open" because its checkout is simulated.
  function paymentsOpen() { return isLocal() || !!(root.APP_ENV && root.APP_ENV.paymentsEnabled); }
  function buyButton(label, attr) { return paymentsOpen() ? '<button type="button" class="btn btn-primary" ' + attr + '>' + label + '</button>' : '<button type="button" class="btn btn-secondary" disabled>Purchases open soon</button>'; }

  // ---- screens ------------------------------------------------------------------
  var screens = {};

  screens.main = function () {
    var u = B.user(), guest = B.isGuest();
    var top = '<div class="topbar">' + logo() + '<span></span></div>';
    var actions = guest
      ? '<a class="btn btn-primary" href="#/login">Log in</a><a class="btn btn-secondary" href="#/create">Create account</a><a class="link center" href="#/lobby">Play as guest</a>'
      : '<a class="btn btn-primary stack" href="#/lobby">Continue<small>as ' + esc(u.email) + '</small></a><a class="link center" href="#/login">Not you? Log in with another account</a>';
    return top + '<div class="hero">' +
      '<div class="hero-left">' + logoMark(window.innerWidth > 1100 ? 36 : 18) + '<h1 class="title">' + esc(C.GAME_NAME) + '</h1><p class="tagline">Stack. Clear. Climb the board.</p>' +
      '<div class="keys"><span class="kv"><kbd>&#8592;</kbd><kbd>&#8594;</kbd>Move</span><span class="kv"><kbd>&#8595;</kbd>Soft drop</span><span class="kv"><kbd>Space</kbd>Hard drop</span><span class="kv"><kbd>Z</kbd><kbd>X</kbd>Rotate</span><span class="kv"><kbd>C</kbd>Hold</span></div></div>' +
      '<div class="hero-right"><div class="card actions">' + actions + '<p class="muted small center">You stay logged in on this device. After ' + C.SESSION_DAYS + ' days without playing we ask you to log in again.</p></div></div>' +
      '</div><p class="foot muted small">Classic · Adventure · Battle · 6 themes · v' + C.VERSION + '</p>';
  };

  screens.login = function (p) {
    var expired = p[0] === 'expired', ex = B.expired();
    return header('#/', 'Back') +
      (expired || ex ? '<div class="notice"><b>Welcome back after a while</b><p>You have not played for over a month, so we signed you out to keep your account safe. Log in once and you will stay logged in again.</p></div>' : '') +
      '<h1>' + (expired || ex ? 'Log in to continue' : 'Welcome back') + '</h1><p class="lead">Log in to keep your scores, themes and purchases.</p>' +
      '<form id="f" novalidate>' + field('email', 'Email', 'email', 'you@example.com') +
      field('password', 'Password', 'password', 'Your password', '<a class="link small" href="#/forgot">Forgot password?</a>') +
      '<button type="button" class="link-btn small" data-toggle-pass="password">Show</button>' +
      '<button class="btn btn-primary" type="submit">Log in</button></form>' +
      '<p class="center muted">New here? <a class="link" href="#/create">Create account</a></p>' + inboxLink();
  };
  screens.login.bind = function (p) {
    var ex = B.expired && null; // consumed in render
    if (p[0] === 'expired' || $('.notice')) { var em = sessionStorage.getItem('bg_last_email'); if (em) $('#email').value = em; }
    passToggle();
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#email').value.trim(), pw = $('#password').value, ok = true;
      showErr('email', validEmail(email) ? '' : 'Enter a valid email address.'); showErr('password', pw ? '' : 'Enter your password.');
      if (!validEmail(email) || !pw) return;
      B.login(email, pw).then(function (u) { applyAppearance(u.settings.appearance); toast('Logged in as ' + u.email); go('#/lobby'); }).catch(function (err) { showErr('password', err.message); });
    });
  };

  screens.create = function () {
    return header('#/', 'Back') + '<h1>Create your account</h1><p class="lead">Your scores and purchases follow you on any device.</p>' +
      '<form id="f" novalidate>' + field('email', 'Email', 'email', 'you@example.com') +
      field('newpass', 'Password', 'password', 'At least 8 characters') + '<button type="button" class="link-btn small" data-toggle-pass="newpass">Show</button>' +
      field('confirm', 'Confirm password', 'password', 'Type it again') +
      '<p class="hint" id="match"></p><button class="btn btn-primary" type="submit">Create account</button>' +
      '<p class="muted small center">By creating an account you agree to the Terms and Privacy Policy.</p></form>' +
      '<p class="center muted">Already have an account? <a class="link" href="#/login">Log in</a></p>';
  };
  screens.create.bind = function () {
    passToggle();
    var pw = $('#newpass'), cf = $('#confirm'), match = $('#match');
    function live() { if (!cf.value) { match.textContent = ''; cf.classList.remove('bad', 'good'); return; } var ok = cf.value === pw.value; match.textContent = ok ? 'Passwords match.' : 'Passwords do not match.'; match.className = 'hint ' + (ok ? 'good' : 'danger'); cf.classList.toggle('bad', !ok); cf.classList.toggle('good', ok); }
    pw.addEventListener('input', live); cf.addEventListener('input', live);
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#email').value.trim();
      var e1 = validEmail(email) ? '' : 'Enter a valid email address.', e2 = pw.value.length >= 8 ? '' : 'Password must be at least 8 characters.', e3 = cf.value === pw.value && cf.value ? '' : 'Passwords do not match.';
      showErr('email', e1); showErr('newpass', e2); showErr('confirm', e3);
      if (e1 || e2 || e3) return;
      B.signup(email, pw.value).then(function (u) { toast('Account created'); go('#/lobby'); }).catch(function (err) { showErr('email', err.message); });
    });
  };

  screens.forgot = function () {
    return header('#/login', 'Back to log in') + '<h1>Reset your password</h1><p class="lead">Enter the email you signed up with. We will send you a link to choose a new password.</p>' +
      '<form id="f" novalidate>' + field('email', 'Email', 'email', 'you@example.com') + '<button class="btn btn-primary" type="submit">Send reset link</button><p class="muted small center">The link works for ' + C.RESET_LINK_MINUTES + ' minutes.</p></form>' +
      '<div id="sent" hidden class="center"><div class="ring">&#9993;</div><h2>Check your email</h2><p class="muted">We sent a password reset link to <b id="sent-to"></b>. If it is not there in a minute, check your spam folder.</p>' + (testTools() ? '<a class="btn btn-primary" href="#/inbox">Open the Test inbox</a>' : '<a class="btn btn-primary" href="#/login">Back to log in</a>') + '<button type="button" class="btn btn-secondary" id="resend">Resend email</button></div>' + inboxLink();
  };
  screens.forgot.bind = function () {
    var f = $('#f');
    f.addEventListener('submit', function (e) {
      e.preventDefault(); var email = $('#email').value.trim();
      if (!validEmail(email)) return showErr('email', 'Enter a valid email address.');
      B.requestReset(email).then(function () { f.hidden = true; $('#sent').hidden = false; $('#sent-to').textContent = email; });
    });
    $('#resend').addEventListener('click', function () { B.requestReset($('#sent-to').textContent).then(function () { toast('Sent again. Give it a minute.'); }); });
  };

  screens.reset = function (p) {
    return header(null, null) + '<div id="reset-body"><h1>Choose a new password</h1><p class="lead">You opened this page from the reset link we emailed you.</p>' +
      '<form id="f" novalidate>' + field('newpass', 'New password', 'password', 'At least 8 characters') + '<button type="button" class="link-btn small" data-toggle-pass="newpass">Show</button>' + field('confirm', 'Confirm new password', 'password', 'Type it again') +
      '<button class="btn btn-primary" type="submit">Set new password</button><p class="muted small center">After saving, you are signed out everywhere and taken to log in.</p></form></div>';
  };
  screens.reset.bind = function (p) {
    Promise.resolve(B.checkToken(p[0], 'reset')).then(function (st) {
      if (st === 'ok' || !$('#reset-body')) return;
      $('#reset-body').innerHTML = '<h1>' + (st === 'expired' ? 'Link expired' : 'Link not valid') + '</h1><p class="lead">' + (st === 'expired' ? 'Reset links work for ' + C.RESET_LINK_MINUTES + ' minutes.' : 'This link was already used or is not complete.') + '</p><a class="btn btn-primary" href="#/forgot">Request a new one</a>';
    });
    passToggle();
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault(); var pw = $('#newpass').value, cf = $('#confirm').value;
      var e2 = pw.length >= 8 ? '' : 'Password must be at least 8 characters.', e3 = cf === pw ? '' : 'Passwords do not match.';
      showErr('newpass', e2); showErr('confirm', e3); if (e2 || e3) return;
      B.resetPassword(p[0], pw).then(function (email) { sessionStorage.setItem('bg_last_email', email); toast('Password changed. Log in with the new one.'); go('#/login'); }).catch(function (err) { showErr('newpass', err.message); });
    });
  };

  screens['confirm-email'] = function (p) {
    return header('#/settings', 'Settings') + '<h1 id="h">Confirming your new email</h1><p class="lead" id="msg">One moment.</p><a class="btn btn-primary" href="#/settings" id="ok" hidden>Back to settings</a>';
  };
  screens['confirm-email'].bind = function (p) {
    B.confirmEmailChange(p[0]).then(function (email) { $('#h').textContent = 'Email updated'; $('#msg').textContent = 'This account now logs in with ' + email + '. Scores, themes and purchases are unchanged.'; $('#ok').hidden = false; })
      .catch(function (err) { $('#h').textContent = 'Could not confirm'; $('#msg').textContent = err.message; $('#ok').hidden = false; });
  };

  screens.inbox = function () {
    return header('#/', 'Back') + '<h1>Test inbox</h1><p class="lead">In the real game these go to the player\'s email. Here they are listed so you can test the links.</p><div id="mails"><p class="muted">Loading</p></div>';
  };
  screens.inbox.bind = function () {
    if (!testTools()) { toast('Emails are sent to your real inbox now.'); return go('#/'); }
    Promise.resolve(B.emails()).then(function (list) {
      var box = $('#mails'); if (!box) return;
      if (list === null) { box.innerHTML = '<div class="notice"><b>Real email is on</b><p>This server sends emails to the player\'s real address, so there is nothing to show here.</p></div>'; return; }
      box.innerHTML = list.length ? list.map(function (m) { var link = m.link ? (m.link.indexOf('#') >= 0 ? '#' + m.link.split('#')[1] : m.link) : null; return '<div class="card mail"><div class="mail-head"><b>' + esc(m.subject) + '</b><span class="muted small">' + fmtDate(m.at) + '</span></div><p class="muted small">To ' + esc(m.to) + '</p><p>' + esc(m.body) + '</p>' + (link ? '<a class="btn btn-secondary" href="' + esc(link) + '">Open link</a>' : '') + '</div>'; }).join('') : '<p class="muted">No emails yet. Try Forgot password or Create account.</p>';
    });
  };

  screens.lobby = function () {
    var u = B.user(), guest = B.isGuest(), runs = u.gamesPlayed || 0;
    var adv = u.adventure || { unlocked: 1 };
    return '<div class="topbar">' + logo() + (guest ? '<a class="link" href="#/create">Create account</a>' : '<a class="link muted" href="#/" data-logout>Log out</a>') + '</div>' +
      (guest ? '<div class="notice"><b>Playing as guest</b><p>Progress stays on this device only. <a class="link" href="#/create">Create an account</a> to keep it everywhere.</p></div>' : '<p class="eyebrow">Logged in as</p><h1 class="email">' + esc(u.email) + '</h1>') +
      '<div class="stat-row"><div class="stat-card"><span>Best</span><b>' + (u.bestScore || 0).toLocaleString() + '</b></div><div class="stat-card"><span>Level</span><b>' + (u.bestLevel || 1) + '</b></div><div class="stat-card"><span>Coins</span><b class="accent">' + (u.coins || 0).toLocaleString() + '</b></div></div>' +
      '<div class="modes">' +
      '<a class="mode" href="#/play/classic"><span class="pill" style="background:#1ec8e8;color:#0b1020">Ranked</span><b>Classic</b><span>Guideline rules. Endless, speeds up every 10 lines.</span></a>' +
      '<a class="mode" href="#/adventure"><span class="pill" style="background:#f28c1e;color:#0b1020">Stage ' + adv.unlocked + '</span><b>Adventure</b><span>' + A.COUNT + ' stages. Equipment allowed.</span></a>' +
      '<a class="mode" href="#/battle"><span class="pill" style="background:#e8453c;color:#fff">Online</span><b>Battle</b><span>Quick match or a room with friends.</span></a>' +
      '<a class="mode" href="#/history"><span class="pill" style="background:#5fd34a;color:#0b1020">' + runs + ' runs</span><b>History</b><span>Every score and every match.</span></a>' +
      '<a class="mode" href="#/shop"><span class="pill" style="background:#a64ddb;color:#fff">6 themes</span><b>Shop</b><span>Themes, Remove Ads, coins, equipment.</span></a>' +
      '<a class="mode" href="#/settings"><span class="pill" style="background:#2b3a6b;color:#e9edf8">Account</span><b>Settings</b><span>Appearance, email, password.</span></a>' +
      '</div>';
  };
  screens.lobby.bind = function () { var lo = $('[data-logout]'); if (lo) lo.addEventListener('click', function (e) { e.preventDefault(); B.logout(); toast('Logged out'); go('#/'); }); };

  screens.adventure = function () {
    var u = B.user(), adv = u.adventure || { unlocked: 1, stages: {} };
    return header('#/lobby', 'Lobby') + '<h1>Adventure</h1><p class="lead">' + A.COUNT + ' stages. Equipment from the shop works here. Press 1 to 5 or tap the bar during play.</p>' +
      '<div class="stage-grid">' + A.all().map(function (st) {
        var done = adv.stages[st.n], locked = st.n > adv.unlocked;
        return '<a class="stage' + (locked ? ' locked' : '') + (done ? ' done' : '') + '" href="' + (locked ? '#/adventure' : '#/play/adventure/' + st.n) + '"' + (locked ? ' aria-disabled="true"' : '') + '><b>' + st.n + '</b><span class="small">' + esc(st.goal.text) + '</span><span class="small muted">Lv ' + st.level + '</span>' + (done ? '<span class="stars small">' + '&#9733;'.repeat(done.stars) + '</span>' : '') + '</a>';
      }).join('') + '</div>' +
      '<div class="card"><b>Your equipment</b><div class="equip-list">' + C.EQUIPMENT.map(function (e) { return '<span class="chip-static">' + esc(e.name) + ' × ' + (u.inventory[e.id] || 0) + '</span>'; }).join('') + '</div><a class="link" href="#/shop/equipment">Buy equipment with coins</a></div>';
  };

  screens.play = function (p) { return '<div id="game"></div>'; };
  screens.play.bind = function (p) {
    var mode = p[0], stage = p[1] ? parseInt(p[1], 10) : null;
    if (mode === 'adventure') { var adv = B.user().adventure || { unlocked: 1 }; if (!stage || stage > adv.unlocked) return go('#/adventure'); }
    current = root.Play.start($('#game'), { mode: mode, stage: stage });
  };
  screens.battlequick = function () { return '<div id="game"></div>'; };
  screens.battlequick.bind = function () { current = root.Play.start($('#game'), { mode: 'battle', onExit: function () { go('#/battle'); } }); };
  screens.battlelocal = function () { return '<div id="game"></div>'; };
  screens.battlelocal.bind = function () {
    if (!canLocal()) { toast('Local 2-player needs a PC with a keyboard.', 'warn'); return go('#/battle'); }
    current = root.Play.start($('#game'), { mode: 'local', onExit: function () { go('#/battle'); } });
  };

  screens.shop = function (p) {
    var tab = p[0] || 'themes', u = B.user(), items = S.catalogue(u);
    var tabs = ['themes', 'extras', 'coins', 'equipment'].map(function (t) { return '<a class="chip' + (t === tab ? ' on' : '') + '" href="#/shop/' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</a>'; }).join('');
    var body = '';
    if (tab === 'themes') {
      body = '<div class="theme-grid">' + T.list.map(function (th) {
        var owned = S.themeOwned(u, th.id), active = (u.settings.theme || 'classic') === th.id, price = C.PRICES.themes[th.id];
        return '<div class="card theme-card"><canvas class="sample" data-theme-id="' + th.id + '"></canvas><div class="theme-body"><div class="row"><b>' + esc(th.name) + '</b><span class="pill ' + (th.tier === 'free' ? 'free' : owned ? 'owned' : 'paid') + '">' + (th.tier === 'free' ? 'Free' : owned ? 'Owned' : money(price)) + '</span></div><p class="muted small">' + esc(th.tagline) + '</p>' +
          (owned ? (active ? '<button type="button" class="btn btn-secondary" disabled>In use</button>' : '<button type="button" class="btn btn-primary" data-use="' + th.id + '">Use this theme</button>') : buyButton('Buy · ' + money(price), 'data-buy="theme:' + th.id + '"') + (th.id === 'lcd' ? '<p class="muted small center">Or free at level ' + C.LCD_UNLOCK_LEVEL + '</p>' : '')) + '</div></div>';
      }).join('') + '</div>';
    } else if (tab === 'extras') {
      body = items.filter(function (i) { return i.type === 'removeAds' || i.type === 'bundle'; }).map(function (i) { return '<div class="card"><div class="row"><b>' + esc(i.name) + '</b><span class="pill ' + (i.owned ? 'owned' : 'paid') + '">' + (i.owned ? 'Owned' : money(i.price)) + '</span></div><p class="muted">' + esc(i.desc) + '</p>' + (i.owned ? '' : buyButton('Buy · ' + money(i.price), 'data-buy="' + i.type + ':' + i.id + '"')) + '</div>'; }).join('');
    } else if (tab === 'coins') {
      body = '<p class="muted">Coins buy equipment for Adventure. You also earn 1 coin per line cleared and stage rewards.</p>' + items.filter(function (i) { return i.type === 'coins'; }).map(function (i) { return '<div class="card row"><div><b>' + esc(i.name) + '</b><p class="muted small">' + esc(i.desc) + '</p></div>' + (paymentsOpen() ? '<button type="button" class="btn btn-primary slim" data-buy="coins:' + i.id + '">' + money(i.price) + '</button>' : '<button type="button" class="btn btn-secondary slim" disabled>Soon</button>') + '</div>'; }).join('');
    } else {
      body = '<p class="muted">You have <b class="accent">' + u.coins.toLocaleString() + '</b> coins. Use equipment during Classic or Adventure: press 1 to 5 on a keyboard, or tap the bar under the board. In Classic, using one makes that run unranked.</p>' + C.EQUIPMENT.map(function (e) { return '<div class="card row"><div><b>' + esc(e.name) + '</b> <span class="muted small">× ' + (u.inventory[e.id] || 0) + '</span><p class="muted small">' + esc(e.desc) + '</p></div><button type="button" class="btn btn-secondary slim" data-equip-buy="' + e.id + '">' + e.cost + ' coins</button></div>'; }).join('');
    }
    return header('#/lobby', 'Lobby', '<span class="muted small">Coins <b class="accent">' + u.coins.toLocaleString() + '</b></span>') + '<h1>Shop</h1>' + demoBanner() + '<div class="chips">' + tabs + '</div>' + body +
      (!paymentsOpen() ? '<p class="muted small center">Purchases open soon. Coins you earn by playing already work for equipment.</p>' : '');
  };
  screens.shop.bind = function (p) {
    $$('.sample').forEach(function (cv) { R.drawSample(cv, T.byId(cv.getAttribute('data-theme-id')), 120); });
    $$('[data-use]').forEach(function (b) { b.addEventListener('click', function () { var u = B.user(); u.settings.theme = b.getAttribute('data-use'); B.persist(); toast(T.byId(u.settings.theme).name + ' is now your game theme'); render(); }); });
    $$('[data-buy]').forEach(function (b) { b.addEventListener('click', function () {
      var parts = b.getAttribute('data-buy').split(':'), items = S.catalogue(B.user());
      var item = items.filter(function (i) { return i.type === parts[0] && i.id === parts[1]; })[0];
      if (!item) return;
      if (B.isGuest()) { toast('Create an account first so the purchase is saved to it.', 'warn'); return go('#/create'); }
      if (root.APP_ENV && root.APP_ENV.provider === 'boost') return go('#/pay/method/' + item.type + '/' + item.id);
      b.disabled = true; b.textContent = 'Starting payment';
      S.createOrder(item).then(function (d) {
        if (/^https?:/i.test(d.checkoutUrl)) location.href = d.checkoutUrl; else go(d.checkoutUrl);
      }).catch(function (err) { b.disabled = false; b.textContent = 'Buy · ' + money(item.price); toast(err.message, 'warn'); });
    }); });
    $$('[data-equip-buy]').forEach(function (b) { b.addEventListener('click', function () { var r = S.buyEquipment(b.getAttribute('data-equip-buy')); if (r.ok) { toast('Bought'); render(); } else toast(r.error, 'warn'); }); });
  };

  // Simulated hosted checkout (mock provider). With CHIP the player is on the gateway's own page instead.
  screens.checkout = function (p) { return '<div id="co"><p class="muted center pad">Loading order</p></div>'; };
  screens.checkout.bind = function (p) {
    var id = p[0], step = p[1] || 'method';
    S.getOrder(id).then(function (o) {
      var box = $('#co'); if (!box) return;
      if (!o) { box.innerHTML = header('#/shop', 'Shop') + '<h1>Order not found</h1><a class="btn btn-primary" href="#/shop">Back to shop</a>'; return; }
      if (o.status === 'expired' || o.status === 'cancelled' || o.status === 'failed') { box.innerHTML = header('#/shop', 'Shop') + '<h1>Order ' + o.status + '</h1><p class="lead">Nothing was charged.</p><a class="btn btn-primary" href="#/shop">Back to shop</a>'; return; }
      if (o.status === 'paid') { box.innerHTML = header('#/shop', 'Shop') + '<h1>Already paid</h1><a class="btn btn-primary" href="#/shop">Back to shop</a>'; return; }
      var summary = '<div class="card order"><div class="row"><span class="muted">Order</span><b>' + esc(o.id) + '</b></div><div class="row"><span>' + esc(o.item.name) + '</span><b>' + money(o.item.price) + '</b></div></div>';
      var gw = demoBanner();
      if (step === 'method' || o.status === 'pending') {
        var methods = C.PAYMENT_METHODS;
        box.innerHTML = gw + '<h1>Pay ' + money(o.item.price) + '</h1>' + summary + '<p class="eyebrow">Choose how to pay</p>' +
          methods.map(function (m) { return '<button type="button" class="card method" data-method="' + m.id + '"><b>' + esc(m.name) + '</b><span class="muted small">' + esc(m.how) + '</span></button>'; }).join('') +
          '<button type="button" class="link-btn" data-cancel>Cancel and go back</button>';
      } else if (o.method === 'boost') {
        // Pretend wallet: summary, PIN, processing, success. The PIN is checked in the browser and never sent.
        var D = root.DemoPin, pin = D.create();
        var cancelAll = function () { S.cancel(id).then(function () { toast('Payment cancelled. Nothing was charged.'); go('#/shop'); }); };
        function showSummary() {
          box.innerHTML = D.summaryHtml(o, money, gw);
          $('[data-pin-continue]').addEventListener('click', showPin);
          $$('[data-cancel]').forEach(function (b) { b.addEventListener('click', cancelAll); });
        }
        function showPin(message) {
          pin.clear();
          box.innerHTML = D.pinHtml(o, money, gw, typeof message === 'string' ? message : '');
          var input = $('#demo-pin'), submit = $('[data-pin-submit]');
          function refresh() { var n = pin.count(); $$('.pin-dots i').forEach(function (d, i) { d.classList.toggle('on', i < n); }); submit.disabled = !pin.complete(); }
          $$('[data-key]').forEach(function (k) { k.addEventListener('click', function () { var v = k.getAttribute('data-key'); if (v === 'back') pin.backspace(); else pin.press(v); refresh(); }); });
          input.addEventListener('input', function () { pin.clear(); String(input.value).replace(/[^0-9]/g, '').slice(0, 6).split('').forEach(function (d) { pin.press(d); }); refresh(); });
          input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (pin.complete()) submitPin(); } });
          function submitPin() {
            var result = pin.check(); input.value = '';
            if (result !== 'ok') { showPin('Wrong PIN, try again'); return; }
            box.innerHTML = D.processingHtml(gw);
            setTimeout(function () {
              S.approve(id).then(function () {
                box.innerHTML = D.successHtml(gw, o, money);
                setTimeout(function () { go('#/pay/return/' + id); }, 1400);
              });
            }, 2000);
          }
          submit.addEventListener('click', submitPin);
          $('form.pin').addEventListener('submit', function (e) { e.preventDefault(); });
          $$('[data-cancel]').forEach(function (b) { b.addEventListener('click', cancelAll); });
          input.focus();
        }
        showSummary();
        return;
      } else {
        var m = C.PAYMENT_METHODS.filter(function (x) { return x.id === o.method; })[0] || C.PAYMENT_METHODS[0];
        var instr = 'This is a demo payment. Nothing is sent to any bank, wallet or card company. Press Approve to simulate a successful payment, or Cancel to simulate a failed one.';
        box.innerHTML = gw + '<h1>' + esc(m.name) + '</h1>' + summary + '<div class="card approve"><p>' + instr + '</p>' +
          '<button type="button" class="btn btn-primary" data-approve>Approve payment</button><button type="button" class="btn btn-secondary" data-cancel>Cancel</button></div>';
      }
      $$('[data-method]').forEach(function (b) { b.addEventListener('click', function () { S.choose(id, b.getAttribute('data-method')).then(function () { go('#/checkout/' + id + '/approve'); }); }); });
      var ap = $('[data-approve]'); if (ap) ap.addEventListener('click', function () { ap.disabled = true; S.approve(id).then(function () { go('#/pay/return/' + id); }); });
      $$('[data-cancel]').forEach(function (b) { b.addEventListener('click', function () { S.cancel(id).then(function () { toast('Payment cancelled. Nothing was charged.'); go('#/shop'); }); }); });
    });
  };

  // Our own method picker for Boost Connect: one method per Boost page. The player pays on Boost's page.
  screens.paymethod = function (p) {
    var items = S.catalogue(B.user()), item = items.filter(function (i) { return i.type === p[0] && i.id === p[1]; })[0];
    if (!item) return header('#/shop', 'Shop') + '<h1>Item not found</h1>';
    return header('#/shop', 'Shop') + '<h1>Pay ' + money(item.price) + '</h1>' +
      '<div class="card order"><div class="row"><span>' + esc(item.name) + '</span><b>' + money(item.price) + '</b></div></div>' +
      '<p class="eyebrow">Choose how to pay</p>' + C.BOOST_METHODS.map(function (m) { return '<button type="button" class="card method" data-method="' + m.id + '"><b>' + esc(m.name) + '</b><span class="muted small">' + esc(m.how) + ' · you pay on the secure payment page and come back here</span></button>'; }).join('') +
      '<p class="muted small center">The item is added to your account after the payment is confirmed.</p><a class="link center" href="#/shop">Cancel</a>';
  };
  screens.paymethod.bind = function (p) {
    var items = S.catalogue(B.user()), item = items.filter(function (i) { return i.type === p[0] && i.id === p[1]; })[0];
    if (!item) return;
    $('[data-method]').forEach(function (b) { b.addEventListener('click', function () {
      $('[data-method]').forEach(function (x) { x.disabled = true; });
      b.querySelector('b').textContent = 'Opening the payment page';
      S.createOrder(item, b.getAttribute('data-method')).then(function (d) { location.href = d.checkoutUrl; })
        .catch(function (err) { $('[data-method]').forEach(function (x) { x.disabled = false; }); b.querySelector('b').textContent = C.BOOST_METHODS.filter(function (m) { return m.id === b.getAttribute('data-method'); })[0].name; toast(err.message, 'warn'); });
    }); });
  };

  screens.payreturn = function (p) {
    return '<div class="center pad"><div class="ring spin">&#8635;</div><h1 id="h">Checking your payment</h1><p class="lead" id="msg">Waiting for the bank to confirm. This usually takes a few seconds.</p><div id="done" hidden><a class="btn btn-primary" href="#/shop">Back to shop</a><a class="link center" href="#/lobby">Go to lobby</a></div></div>';
  };
  screens.payreturn.bind = function (p) {
    // The gateway's confirmation (webhook or server-side check), not this page, unlocks the item. We only wait and show the result.
    S.waitForResult(p[0], 20).then(function (o) {
      if (!$('#h')) return;
      $('.ring').classList.remove('spin');
      if (o && o.status === 'paid') { $('.ring').innerHTML = '&#10003;'; $('.ring').classList.add('good'); $('#h').textContent = 'Payment received'; $('#msg').textContent = o.item.name + ' is now on your account. A receipt for order ' + o.id + ' was sent to your email.'; }
      else if (o && o.status === 'review') { $('#h').textContent = 'Payment received, being checked'; $('#msg').textContent = 'Your payment reached us but a detail did not match, so a person will check it. The item is added once that is done. Nothing is charged twice.'; }
      else if (o && o.status === 'expired') { $('#h').textContent = 'Payment page expired'; $('#msg').textContent = 'The payment page was not completed in time. If you did pay, the item is added automatically once the payment is confirmed, within a few minutes. Otherwise nothing was charged.'; }
      else if (o && (o.status === 'pending' || o.status === 'processing')) { $('#h').textContent = 'Still waiting for the bank'; $('#msg').textContent = 'Your payment has not been confirmed yet. If you completed it, the item will appear on your account within a few minutes. Nothing is charged twice.'; }
      else { $('.ring').innerHTML = '&#10005;'; $('#h').textContent = 'Payment not completed'; $('#msg').textContent = 'The bank did not confirm this order. Nothing was charged.'; }
      $('#done').hidden = false;
    });
  };

  screens.settings = function () {
    var u = B.user(), guest = B.isGuest(), ap = u.settings.appearance || 'system';
    var seg = ['light', 'dark', 'system'].map(function (m) { return '<button type="button" class="seg' + (ap === m ? ' on' : '') + '" data-ap="' + m + '" aria-pressed="' + (ap === m) + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</button>'; }).join('');
    var owned = T.list.filter(function (th) { return S.themeOwned(u, th.id); });
    return header('#/lobby', 'Lobby') + '<h1>Settings</h1>' +
      '<p class="eyebrow">Appearance</p><div class="card"><div class="segs">' + seg + '</div><p class="muted small" id="ap-note"></p></div>' +
      '<p class="eyebrow">Game</p><div class="card list">' +
      '<label class="row"><span>Game theme</span><select class="select" id="theme">' + owned.map(function (th) { return '<option value="' + th.id + '"' + (u.settings.theme === th.id ? ' selected' : '') + '>' + esc(th.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="row"><span>Ghost piece</span><input type="checkbox" id="ghost"' + (u.settings.ghost !== false ? ' checked' : '') + '></label>' +
      '<label class="row"><span>Music</span><input type="checkbox" id="music"' + (u.settings.music !== false ? ' checked' : '') + '></label>' +
      '<label class="row"><span>Sound effects</span><input type="checkbox" id="sfx"' + (u.settings.sfx !== false ? ' checked' : '') + '></label>' +
      '<label class="row"><span>Volume</span><input type="range" id="volume" min="0" max="100" value="' + Math.round((typeof u.settings.volume === 'number' ? u.settings.volume : 0.7) * 100) + '" style="width:45%"></label></div>' +
      '<p class="eyebrow">Account</p><div class="card list">' +
      (guest ? '<p class="muted">You are playing as a guest. <a class="link" href="#/create">Create an account</a> to change email or password.</p>' :
        '<a class="row" href="#/settings/email"><span><span>Email</span><small class="muted">' + esc(u.email) + '</small></span><span class="link">Change &#8250;</span></a>' +
        '<a class="row" href="#/settings/password"><span><span>Password</span><small class="muted">Changed ' + fmtDate(u.passwordChangedAt) + '</small></span><span class="link">Change &#8250;</span></a>') + '</div>' +
      (guest ? '' : '<p class="eyebrow">Session</p><div class="card list"><button type="button" class="row" data-logout><span>Log out on this device</span></button><button type="button" class="row" data-logout-all><span>Log out on all devices</span><small class="muted">' + B.sessionCount() + ' device' + (B.sessionCount() === 1 ? '' : 's') + '</small></button></div>') +
      (testTools() ? '<p class="eyebrow">Test tools</p><div class="card list"><a class="row" href="#/inbox"><span>Test inbox</span><span class="link">Open &#8250;</span></a>' + (isLocal() ? '<button type="button" class="row danger" data-wipe><span>Reset all test data</span></button>' : '') + '</div>' : '') +
      '<p class="muted small">Appearance applies to menus and screens like this one. The game board always uses your game theme.</p>' +
      (C.MUSIC && C.MUSIC.length ? '<p class="eyebrow">Music credits</p><div class="card"><p class="muted small">' + C.MUSIC.map(function (t) { return esc(t.title) + ' by ' + esc(t.artist) + ' (' + esc(t.source) + '), licensed under ' + esc(t.license); }).join('. ') + '.</p></div>' : '');
  };
  screens.settings.bind = function () {
    var u = B.user();
    function note() { var m = u.settings.appearance; $('#ap-note').textContent = m === 'system' ? 'Follows your device setting and changes with it.' : 'Always ' + m + ', on every device you log in on.'; }
    note();
    $$('[data-ap]').forEach(function (b) { b.addEventListener('click', function () { u.settings.appearance = b.getAttribute('data-ap'); B.persist(); applyAppearance(u.settings.appearance); $$('[data-ap]').forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); note(); }); });
    $('#theme').addEventListener('change', function () { u.settings.theme = this.value; B.persist(); toast(T.byId(this.value).name + ' selected'); });
    $('#ghost').addEventListener('change', function () { u.settings.ghost = this.checked; B.persist(); });
    function audio() { u.settings.sound = true; if (root.GameAudio) root.GameAudio.apply(u.settings); B.persist(); }
    $('#music').addEventListener('change', function () { u.settings.music = this.checked; audio(); });
    $('#sfx').addEventListener('change', function () { u.settings.sfx = this.checked; audio(); if (this.checked && root.GameAudio) root.GameAudio.preview(); });
    $('#volume').addEventListener('input', function () { u.settings.volume = this.value / 100; audio(); });
    $('#volume').addEventListener('change', function () { if (root.GameAudio) root.GameAudio.preview(); });
    var lo = $('[data-logout]'); if (lo) lo.addEventListener('click', function () { B.logout(); toast('Logged out'); go('#/'); });
    var la = $('[data-logout-all]'); if (la) la.addEventListener('click', function () { B.logoutAll(); toast('Logged out everywhere'); go('#/'); });
    var wipe = $('[data-wipe]'); if (wipe) wipe.addEventListener('click', function () { if (this.dataset.armed) { B.wipe(); applyAppearance('system'); toast('Test data cleared'); go('#/'); } else { this.dataset.armed = '1'; this.querySelector('span').textContent = 'Tap again to confirm. This deletes all test accounts.'; } });
  };

  screens.settingsemail = function () {
    if (B.isGuest()) return header('#/settings', 'Settings') + '<h1>Log in first</h1>';
    var u = B.user();
    return header('#/settings', 'Settings') + '<h1>Change email</h1><p class="lead">Same account, same scores, same purchases. Only the address you log in with changes.</p>' +
      '<div class="card"><p class="eyebrow">Current email</p><b>' + esc(u.email) + '</b></div>' +
      '<form id="f" novalidate>' + field('email', 'New email', 'email', 'new@example.com') + field('password', 'Current password', 'password', 'To confirm it is you') +
      '<button class="btn btn-primary" type="submit">Send confirmation link</button><p class="muted small center">We email a link to the new address. Your current email keeps working until you confirm.</p></form>' +
      '<div id="sent" hidden class="center"><div class="ring">&#9993;</div><h2>Confirm your new email</h2><p class="muted">We sent a confirmation link to <b id="sent-to"></b>. Open it within ' + C.RESET_LINK_MINUTES + ' minutes. Until then you still log in with ' + esc(u.email) + '.</p>' + (testTools() ? '<a class="btn btn-primary" href="#/inbox">Open the Test inbox</a><a class="link center" href="#/settings">Done</a>' : '<a class="btn btn-primary" href="#/settings">Done</a>') + '</div>';
  };
  screens.settingsemail.bind = function () {
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault(); var em = $('#email').value.trim(), pw = $('#password').value;
      showErr('email', validEmail(em) ? '' : 'Enter a valid email address.'); showErr('password', pw ? '' : 'Enter your current password.');
      if (!validEmail(em) || !pw) return;
      B.requestEmailChange(em, pw).then(function () { $('#f').hidden = true; $('#sent').hidden = false; $('#sent-to').textContent = em; }).catch(function (err) { showErr(/password/i.test(err.message) ? 'password' : 'email', err.message); });
    });
  };

  screens.settingspassword = function () {
    if (B.isGuest()) return header('#/settings', 'Settings') + '<h1>Log in first</h1>';
    return header('#/settings', 'Settings') + '<h1>Change password</h1><p class="lead">You stay logged in here. Every other device will need to log in again.</p>' +
      '<form id="f" novalidate>' + field('password', 'Current password', 'password', 'Your current password', '<a class="link small" href="#/forgot">Forgot it?</a>') +
      field('newpass', 'New password', 'password', 'At least 8 characters') + '<button type="button" class="link-btn small" data-toggle-pass="newpass">Show</button>' + field('confirm', 'Confirm new password', 'password', 'Type it again') +
      '<button class="btn btn-primary" type="submit">Save new password</button></form>' +
      '<div id="done" hidden class="center"><div class="ring good">&#10003;</div><h2>Password changed</h2><p class="muted" id="done-msg"></p><a class="btn btn-primary" href="#/settings">Back to settings</a></div>';
  };
  screens.settingspassword.bind = function () {
    passToggle();
    $('#f').addEventListener('submit', function (e) {
      e.preventDefault(); var cur = $('#password').value, pw = $('#newpass').value, cf = $('#confirm').value;
      var e1 = cur ? '' : 'Enter your current password.', e2 = pw.length >= 8 ? '' : 'New password must be at least 8 characters.', e3 = cf === pw ? '' : 'Passwords do not match.';
      showErr('password', e1); showErr('newpass', e2); showErr('confirm', e3); if (e1 || e2 || e3) return;
      B.changePassword(cur, pw).then(function (others) { $('#f').hidden = true; $('#done').hidden = false; $('#done-msg').textContent = 'You are still logged in on this device. ' + others + ' other device' + (others === 1 ? ' was' : 's were') + ' logged out. We sent a notice to your email.'; })
        .catch(function (err) { showErr(/current|wrong/i.test(err.message) ? 'password' : 'newpass', err.message); });
    });
  };

  screens.history = function (p) {
    var f = p[0] || 'all', u = B.user();
    var chips = ['all', 'classic', 'adventure', 'battle'].map(function (k) { return '<a class="chip' + (k === f ? ' on' : '') + '" href="#/history/' + k + '">' + k.charAt(0).toUpperCase() + k.slice(1) + '</a>'; }).join('');
    return header('#/lobby', 'Lobby') + '<h1>History</h1>' +
      '<div class="stat-row"><div class="stat-card"><span>Runs</span><b id="run-count">' + (u.gamesPlayed || 0) + '</b></div><div class="stat-card"><span>Best</span><b class="accent">' + (u.bestScore || 0).toLocaleString() + '</b></div><div class="stat-card"><span>Battles</span><b>' + u.battles.w + ' W · ' + u.battles.l + ' L</b></div></div>' +
      '<div class="chips">' + chips + '</div><div id="runs"><p class="muted">Loading</p></div>' +
      '<button type="button" class="btn btn-secondary" id="csv" hidden>Export as CSV</button>';
  };
  screens.history.bind = function (p) {
    var f = p[0] || 'all', u = B.user(), allRuns = [];
    var pill = { classic: ['#1ec8e8', '#0b1020'], adventure: ['#f28c1e', '#0b1020'], battle: ['#e8453c', '#fff'], local: ['#2b3a6b', '#e9edf8'] };
    Promise.resolve(B.runs()).then(function (runs) {
      allRuns = runs || [];
      var box = $('#runs'); if (!box) return;
      var list = allRuns.filter(function (r) { return f === 'all' || r.mode === f; });
      box.innerHTML = list.length ? list.map(function (r) {
        var c = pill[r.mode] || pill.local, main = r.mode === 'battle' ? (r.result === 'win' ? 'Win' : 'Loss') : r.mode === 'adventure' ? 'Stage ' + r.stage : (r.score || 0).toLocaleString();
        var detail = r.mode === 'battle' ? 'vs ' + esc(r.opponent) + ' · ' + (r.ratingDelta > 0 ? '+' : '') + (r.ratingDelta || 0) + ' rating · ' + (r.attackSent || 0) + ' lines sent' : r.lines + ' lines · Lv ' + r.level + ' · ' + fmtTime(r.time) + (r.pps ? ' · ' + r.pps + ' pps' : '') + (r.coins ? ' · +' + r.coins + ' coins' : '');
        var badge = r.mode === 'battle' ? 'Ranked' : r.continued ? 'Continued' : r.mode === 'adventure' ? (r.result === 'won' ? 'Cleared' : 'Failed') : (r.score === u.bestScore && r.score > 0 ? 'Best' : '');
        return '<div class="run"><span class="pill" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(r.mode) + '</span><div class="run-main"><b>' + main + '</b><span class="muted small">' + detail + '</span></div><div class="run-side">' + (badge ? '<span class="badge">' + badge + '</span>' : '') + '<span class="muted small">' + fmtDate(r.at) + '</span></div></div>';
      }).join('') : '<p class="muted">No runs yet. Play a game and it will show up here.</p>';
      $('#run-count').textContent = allRuns.length;
      $('#csv').hidden = !allRuns.length;
    });
    var b = $('#csv'); if (!b) return;
    b.addEventListener('click', function () {
      var rows = [['date', 'mode', 'stage', 'score', 'lines', 'level', 'time_s', 'pps', 'result', 'continued', 'opponent', 'rating_delta', 'theme', 'coins']];
      allRuns.forEach(function (r) { rows.push([new Date(r.at).toISOString(), r.mode, r.stage || '', r.score, r.lines, r.level, r.time, r.pps || '', r.result || '', r.continued ? 'yes' : 'no', r.opponent || '', r.ratingDelta || '', r.theme || '', r.coins || 0]); });
      var csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
      try { var a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'history.csv'; document.body.appendChild(a); a.click(); a.remove(); toast('CSV downloaded'); }
      catch (e) { toast('Download blocked here. It works when the game runs on its own site.', 'warn'); }
    });
  };

  screens.battle = function (p) {
    var u = B.user(), rating = u.rating || 1000;
    var rank = rating < 900 ? 'Bronze' : rating < 1100 ? 'Silver' : rating < 1300 ? 'Gold' : rating < 1500 ? 'Platinum' : 'Diamond';
    return header('#/lobby', 'Lobby') + '<h1>Battle</h1>' +
      '<div class="card row"><div><b>' + rank + '</b><p class="muted small">' + rating.toLocaleString() + ' rating · ' + u.battles.w + ' W ' + u.battles.l + ' L</p></div></div>' +
      '<div id="idle">' +
      '<button type="button" class="btn btn-primary stack" id="quick">Quick match<small>1 v 1 ranked · computer opponent, online players coming soon</small></button>' +
      '<button type="button" class="btn btn-secondary stack" id="room">Create a room<small>Invite friends with a code or link</small></button>' +
      '<div class="field"><label for="code">Join a friend\'s room</label><div class="row gap"><input class="input code" id="code" maxlength="6" placeholder="Room code" autocomplete="off"><button type="button" class="btn btn-secondary slim" id="join">Join</button></div><p class="err" data-err="code"></p></div>' +
      (canLocal() ? '<a class="btn btn-secondary stack" href="#/battle/local">Local 2-player<small>Two players on this keyboard</small></a>' : '<p class="muted small center">Local 2-player needs a PC with a keyboard.</p>') +
      '</div>' +
      '<div id="online" hidden class="notice"><b>Online rooms are coming soon</b><p>Rooms with a code and link need the online match server, which is the next thing being built. For now you can play Quick match against the computer' + (canLocal() ? ' or Local 2-player on one keyboard' : '') + '.</p><button type="button" class="link-btn" id="online-ok">OK</button></div>' +
      '<p class="muted small center">Battle is cosmetics only. Equipment from Adventure never applies here.</p>';
  };
  screens.battle.bind = function () {
    // Quick match starts the computer opponent at once. The matchmaking wait returns with the online server.
    $('#quick').addEventListener('click', function () { go('#/battle/quick'); });
    function online() { $('#online').hidden = false; $('#online').scrollIntoView({ behavior: 'smooth' }); }
    $('#room').addEventListener('click', online);
    $('#join').addEventListener('click', function () { var v = $('#code').value.trim(); if (!/^[A-Za-z0-9]{6}$/.test(v)) return showErr('code', 'A room code is 6 letters and numbers, like 7K3PX9.'); showErr('code', ''); online(); });
    $('#online-ok').addEventListener('click', function () { $('#online').hidden = true; });
  };

  // ---- router ---------------------------------------------------------------------
  var routes = [
    [/^\/?$/, 'main'], [/^\/login(?:\/(expired))?$/, 'login'], [/^\/create$/, 'create'], [/^\/forgot$/, 'forgot'], [/^\/reset\/([^/]+)$/, 'reset'], [/^\/confirm-email\/([^/]+)$/, 'confirm-email'], [/^\/inbox$/, 'inbox'],
    [/^\/lobby$/, 'lobby'], [/^\/adventure$/, 'adventure'], [/^\/play\/(classic)$/, 'play'], [/^\/play\/(adventure)\/(\d+)$/, 'play'],
    [/^\/shop(?:\/(themes|extras|coins|equipment))?$/, 'shop'], [/^\/checkout\/([^/]+)(?:\/(approve))?$/, 'checkout'], [/^\/pay\/return\/([^/]+)$/, 'payreturn'], [/^\/pay\/method\/(removeAds|bundle|theme|coins)\/([a-z0-9-]+)$/, 'paymethod'],
    [/^\/settings$/, 'settings'], [/^\/settings\/email$/, 'settingsemail'], [/^\/settings\/password$/, 'settingspassword'],
    [/^\/history(?:\/(all|classic|adventure|battle))?$/, 'history'],
    [/^\/battle$/, 'battle'], [/^\/battle\/quick$/, 'battlequick'], [/^\/battle\/local$/, 'battlelocal']
  ];

  function render() {
    if (current && current.destroy) { current.destroy(); current = null; }
    var path = location.hash.replace(/^#/, '') || '/';
    var name = null, params = [];
    for (var i = 0; i < routes.length; i++) { var m = path.match(routes[i][0]); if (m) { name = routes[i][1]; params = m.slice(1); break; } }
    if (!name) { go('#/'); return; }
    var scr = screens[name];
    var fullBleed = name === 'play' || name === 'battlequick' || name === 'battlelocal';
    app.className = 'app ' + (fullBleed ? 'full' : 'shell') + (name === 'main' ? ' is-main' : '');
    app.innerHTML = scr(params);
    if (scr.bind) scr.bind(params);
    window.scrollTo(0, 0);
    if (!fullBleed) app.focus && app.focus();
  }

  root.UI = {
    screens: screens,
    init: function () {
      app = document.getElementById('app');
      app.innerHTML = '<p class="muted center pad">Loading</p>';
      if (root.APP_ENV && root.APP_ENV.gameName) C.GAME_NAME = root.APP_ENV.gameName;
      Promise.resolve(B.init()).then(function (u) {
        applyAppearance(u.settings.appearance || 'system');
        var ex = B.expired();
        if (ex) { sessionStorage.setItem('bg_last_email', ex.email); if (!location.hash || location.hash === '#/') location.hash = '#/login/expired'; }
        window.addEventListener('hashchange', render);
        window.addEventListener('resize', function () { if (app.classList.contains('is-main')) render(); });
        render();
      });
    },
    toast: toast, go: go
  };
})(window);
