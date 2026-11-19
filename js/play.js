/* The game screen: Classic, Adventure, Battle vs computer, and Local 2-player. */
(function (root) {
  'use strict';
  var C = root.CONFIG, E = root.Engine, T = root.Themes, R = root.Renderer, B = root.Backend, S = root.Store, A = root.Adventure;
  function sfx(name) { if (root.GameAudio) root.GameAudio.sfx(name); }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtTime(t) { t = Math.floor(t); var m = Math.floor(t / 60), s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function fmtNum(n) { return Math.floor(n).toLocaleString(); }
  var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  function playerColumn(id, label, opts) {
    opts = opts || {};
    return '<div class="player" data-player="' + id + '">' +
      '<div class="side side-left"><div class="box"><span class="box-label">Hold</span><canvas class="hold"></canvas></div>' +
      '<div class="box stats"><div class="stat"><span>Score</span><b class="score">0</b></div><div class="stat"><span>Lines</span><b class="lines">0</b></div><div class="stat"><span>Level</span><b class="level">1</b></div><div class="stat"><span>Time</span><b class="time">0:00</b></div>' +
      (opts.goal ? '<div class="goal"><span class="goal-text">' + esc(opts.goal) + '</span><div class="goal-bar"><div class="goal-fill"></div></div><span class="goal-num"></span></div>' : '') + '</div></div>' +
      '<div class="board-wrap"><canvas class="board" aria-label="' + esc(label) + ' board"></canvas><div class="popup" aria-live="polite"></div></div>' +
      '<div class="side side-right"><div class="box"><span class="box-label">Next</span><canvas class="next"></canvas><canvas class="next"></canvas><canvas class="next"></canvas><canvas class="next"></canvas><canvas class="next"></canvas></div>' +
      (opts.attack ? '<div class="box attack"><span class="box-label">Sent</span><b class="sent">0</b><span class="box-label">Taken</span><b class="taken">0</b></div>' : '') + '</div></div>';
  }

  // Key guide for one player. Keys are listed in the order players read them: move, drops, rotate, hold.
  var KEY_LABELS = {
    arrows: [['&#8592; &#8594;', 'Move'], ['&#8595;', 'Soft drop'], ['Space', 'Hard drop'], ['Z / X', 'Rotate'], ['C', 'Hold']],
    wasd: [['A / D', 'Move'], ['S', 'Soft drop'], ['W', 'Hard drop'], ['Q / E', 'Rotate'], ['F', 'Hold']]
  };
  function keyGuide(who, title) {
    return '<div class="keyguide"><b>' + esc(title) + '</b>' + KEY_LABELS[who].map(function (k) { return '<span class="kv"><kbd>' + k[0] + '</kbd>' + esc(k[1]) + '</span>'; }).join('') + '</div>';
  }

  function touchControls() {
    return '<div class="touch-controls" aria-label="Touch controls">' +
      '<button type="button" class="tc" data-act="left" aria-label="Move left">&#9664;</button>' +
      '<button type="button" class="tc" data-act="right" aria-label="Move right">&#9654;</button>' +
      '<button type="button" class="tc" data-act="soft" aria-label="Soft drop">&#9660;</button>' +
      '<button type="button" class="tc tc-hard" data-act="hard" aria-label="Hard drop">DROP</button>' +
      '<button type="button" class="tc" data-act="ccw" aria-label="Rotate left">&#8634;</button>' +
      '<button type="button" class="tc" data-act="cw" aria-label="Rotate right">&#8635;</button>' +
      '<button type="button" class="tc" data-act="hold" aria-label="Hold">HOLD</button>' +
      '</div>';
  }

  function GameScreen(rootEl, opts) {
    this.root = rootEl; this.opts = opts; this.mode = opts.mode;
    this.user = B.user();
    this.theme = T.byId(this.user.settings.theme || 'classic');
    this.stage = opts.stage ? A.stage(opts.stage) : null;
    this.players = [];
    this.running = false; this.paused = false; this.finished = false;
    this.coinsEarned = 0; this.usedEquipment = false; this.slowTimer = 0;
    this.lastHud = 0;
    this.build();
    if (root.GameAudio) { root.GameAudio.apply(this.user.settings); root.GameAudio.startMusic(); }
    this.start();
  }

  GameScreen.prototype.build = function () {
    var m = this.mode, label = { classic: 'Classic', adventure: this.stage ? this.stage.name : 'Adventure', battle: 'Battle · vs computer', local: 'Local 2-player' }[m];
    var html = '<div class="play mode-' + m + ' theme-' + this.theme.id + (this.theme.light ? ' theme-light' : '') + '">' +
      '<div class="play-top"><div class="topbar-left"><button type="button" class="logo logo-btn" data-do="home" aria-label="' + esc(C.GAME_NAME) + ', open menu"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 26 26"><rect x="9" y="1" width="8" height="8" rx="1.5" fill="#a64ddb"/><rect x="1" y="9" width="8" height="8" rx="1.5" fill="#a64ddb"/><rect x="9" y="9" width="8" height="8" rx="1.5" fill="#a64ddb"/><rect x="17" y="9" width="8" height="8" rx="1.5" fill="#a64ddb"/><rect x="1" y="17" width="8" height="8" rx="1.5" fill="#1ec8e8"/><rect x="9" y="17" width="8" height="8" rx="1.5" fill="#f5d020"/><rect x="17" y="17" width="8" height="8" rx="1.5" fill="#e8453c"/></svg><span>' + esc(C.GAME_NAME) + '</span></button><button type="button" class="link-btn" data-do="pause">&#10074;&#10074; Pause</button></div><span class="play-label">' + esc(label) + '</span><button type="button" class="link-btn play-theme" data-do="track" title="Next song">&#9835; <span class="now-playing">' + esc(this.theme.name) + '</span></button></div>' +
      '<div class="play-area">';
    if (m === 'battle') html += playerColumn(0, 'Your', { attack: true }) + playerColumn(1, 'Opponent', { attack: true });
    else if (m === 'local') html += playerColumn(0, 'Player 1') + playerColumn(1, 'Player 2');
    else html += playerColumn(0, 'Your', { goal: this.stage ? this.stage.goal.text : null });
    html += '</div>';
    if (m === 'adventure' || m === 'classic') {
      html += '<div class="equip-wrap"><div class="equip-head"><span>Equipment</span><span class="muted">' + (isTouch ? 'Tap to use' : 'Press 1 to 5 or tap') + (m === 'classic' ? ' · using one makes the run unranked' : '') + '</span></div><div class="equip-bar">' + C.EQUIPMENT.map(function (e) { return '<button type="button" class="equip" data-equip="' + e.id + '" title="' + esc(e.desc) + '"><span class="equip-key">' + e.key + '</span><span class="equip-name">' + esc(e.name) + '</span><span class="equip-count" data-count="' + e.id + '">0</span></button>'; }).join('') + '</div><p class="equip-empty muted small" hidden>You have no equipment. Buy some with coins in the Shop.</p></div>';
    }
    if (m !== 'local') html += touchControls();
    if (m === 'local') html += '<div class="local-help">' + keyGuide('wasd', 'Player 1 · left board · W A S D') + keyGuide('arrows', 'Player 2 · right board · arrows') + '</div>';
    html += '<div class="overlay" hidden></div></div>';
    this.root.innerHTML = html;
    this.el = this.root.firstElementChild;
    var th = this.theme;
    this.el.style.background = 'linear-gradient(160deg, ' + th.bg[0] + ', ' + th.bg[1] + ')';
    this.el.style.setProperty('--ink', th.text);
    this.el.style.setProperty('--muted', T.rgba(th.text, 0.72));
    this.el.style.setProperty('--line', th.frame);
    this.el.style.setProperty('--surface', th.light ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.28)');
    this.el.style.setProperty('--surface-2', th.light ? 'rgba(255,255,255,.8)' : 'rgba(0,0,0,.45)');
    this.el.style.setProperty('--panel-bg', T.shade(th.bg[0], th.light ? 0.55 : 0.09));
    this.el.style.setProperty('--panel-line', T.rgba(th.text, 0.14));
    this.el.style.setProperty('--accent', th.accent);
    this.el.style.setProperty('--accent-bg', th.accent);
    this.el.style.setProperty('--on-accent', th.light ? '#ffffff' : '#0b1020');
    this.area = this.el.querySelector('.play-area');
    this.overlay = this.el.querySelector('.overlay');
    var self = this;
    this.el.querySelector('[data-do="pause"]').addEventListener('click', function () { self.togglePause(); });
    // The logo opens the pause menu (which has Quit to lobby) instead of leaving mid-run on a stray tap.
    this.el.querySelector('[data-do="home"]').addEventListener('click', function () { if (self.ended || self.finished) self.exit(); else if (!self.paused) self.togglePause(); });
    this.el.querySelector('[data-do="track"]').addEventListener('click', function () { if (root.GameAudio) { root.GameAudio.nextTrack(); self.updateNowPlaying(); } });
    this.nowPlayingTimer = setInterval(function () { self.updateNowPlaying(); }, 2000);
    if (m === 'adventure' || m === 'classic') {
      Array.prototype.forEach.call(this.el.querySelectorAll('[data-equip]'), function (btn) { btn.addEventListener('click', function () { self.useEquipment(btn.getAttribute('data-equip')); }); });
      this.refreshEquip();
    }
    this.onResize = function () { self.layout(); };
    window.addEventListener('resize', this.onResize);
    this.onVis = function () { if (document.hidden && self.running && !self.paused && !self.finished) self.togglePause(); };
    document.addEventListener('visibilitychange', this.onVis);
  };

  GameScreen.prototype.updateNowPlaying = function () {
    var el = this.el.querySelector('.now-playing'); if (!el) return;
    var t = root.GameAudio && root.GameAudio.nowPlaying();
    var txt = t && this.user.settings.music !== false ? t.title + ' · ' + t.artist : this.theme.name;
    if (el.textContent !== txt) el.textContent = txt;
  };

  GameScreen.prototype.makePlayer = function (idx, game, keymap) {
    var col = this.el.querySelector('[data-player="' + idx + '"]');
    var self = this;
    var p = {
      idx: idx, game: game, col: col,
      renderer: new R.BoardRenderer(col.querySelector('.board'), this.theme),
      hold: col.querySelector('.hold'), nexts: col.querySelectorAll('.next'),
      hud: { score: col.querySelector('.score'), lines: col.querySelector('.lines'), level: col.querySelector('.level'), time: col.querySelector('.time'), sent: col.querySelector('.sent'), taken: col.querySelector('.taken'), goalFill: col.querySelector('.goal-fill'), goalNum: col.querySelector('.goal-num') },
      popup: col.querySelector('.popup'), popupTimer: null, input: null, bot: null
    };
    if (keymap) {
      p.input = new root.Input(game, { keymap: keymap, onPause: function () { self.togglePause(); }, onEquip: (this.mode === 'adventure' || this.mode === 'classic') ? function (k) { var e = C.EQUIPMENT.filter(function (q) { return q.key === k; })[0]; if (e) self.useEquipment(e.id); } : null });
      var tc = this.el.querySelector('.touch-controls');
      if (tc && idx === 0) { p.input.bindButtons(tc); p.input.bindSwipe(col.querySelector('.board')); }
    }
    return p;
  };

  GameScreen.prototype.start = function () {
    var m = this.mode, seed = (Date.now() & 0xffffffff) >>> 0;
    var startLevel = this.stage ? this.stage.level : 1;
    this.players = [];
    if (m === 'battle') {
      var g1 = new E.Game({ seed: seed, startLevel: 1, levelUp: false }), g2 = new E.Game({ seed: seed, startLevel: 1, levelUp: false });
      this.players.push(this.makePlayer(0, g1, 'arrows'));
      var p2 = this.makePlayer(1, g2, null);
      var rating = this.user.rating || 1000, diff = Math.max(0.03, Math.min(0.25, 0.25 - (rating - 1000) / 2000));
      p2.bot = new root.Bot(g2, { actionInterval: Math.max(0.05, 0.16 - (rating - 1000) / 8000), thinkDelay: 0.35, mistake: diff });
      this.opponent = { name: ['BlockRunner', 'Tetro_99', 'LineQueen', 'StackSmith', 'KickFlip'][seed % 5], rating: rating + Math.round((this.rand01(seed) - 0.5) * 120) };
      this.players.push(p2);
      this.el.querySelector('[data-player="1"] .side-left').insertAdjacentHTML('afterbegin', '<div class="box opp"><span class="box-label">Opponent</span><b>' + esc(this.opponent.name) + '</b><span class="muted">' + this.opponent.rating + '</span></div>');
    } else if (m === 'local') {
      this.players.push(this.makePlayer(0, new E.Game({ seed: seed, levelUp: false }), 'wasd'));   // Player 1, left board
      this.players.push(this.makePlayer(1, new E.Game({ seed: seed, levelUp: false }), 'arrows')); // Player 2, right board
    } else {
      this.players.push(this.makePlayer(0, new E.Game({ seed: seed, startLevel: startLevel, levelUp: m === 'classic' }), 'arrows'));
    }
    this.layout();
    this.running = true; this.paused = false; this.finished = false;
    this.last = performance.now();
    var self = this;
    this.raf = requestAnimationFrame(function step(now) { if (!self.running) return; self.frame(now); self.raf = requestAnimationFrame(step); });
    if (m === 'local' && !this.localIntroShown) this.showLocalIntro(); else this.showCountdown();
  };

  // Local 2-player: explain both key sets before the first match, then count down.
  GameScreen.prototype.showLocalIntro = function () {
    var self = this;
    this.paused = true; this.localIntroShown = true;
    this.setOverlay('<div class="panel wide"><div class="panel-head"><p class="eyebrow">Local 2-player</p><h2>Controls</h2></div>' +
      '<p class="muted small">Both players share this keyboard at the same time. Player 1 sits on the left and uses W A S D. Player 2 sits on the right and uses the arrow keys.</p>' +
      '<div class="keyguide-row">' + keyGuide('wasd', 'Player 1 · left board') + keyGuide('arrows', 'Player 2 · right board') + '</div>' +
      '<p class="muted small">When one player tops out, the other keeps playing. The longer survivor wins.</p>' +
      '<div class="panel-actions"><button type="button" class="btn btn-primary" data-do="start">Start match</button><button type="button" class="link-btn" data-do="quit">Back to battle</button></div></div>');
    var onKey = function (e) { if (e.key === 'Enter') { e.preventDefault(); begin(); } };
    var begin = function () { window.removeEventListener('keydown', onKey); self.hideOverlay(); self.showCountdown(); };
    window.addEventListener('keydown', onKey);
    this.bindOverlay({ start: begin, quit: function () { window.removeEventListener('keydown', onKey); self.exit(); } });
  };

  GameScreen.prototype.rand01 = function (n) { return ((n * 9301 + 49297) % 233280) / 233280; };

  GameScreen.prototype.showCountdown = function () {
    var self = this, n = 3;
    this.paused = true;
    this.setOverlay('<div class="count">' + n + '</div>');
    sfx('tick');
    var t = setInterval(function () {
      n--;
      if (n > 0) { self.setOverlay('<div class="count">' + n + '</div>'); sfx('tick'); }
      else { clearInterval(t); self.hideOverlay(); self.paused = false; self.last = performance.now(); sfx('start'); }
    }, 700);
  };

  GameScreen.prototype.layout = function () {
    var m = this.mode, topH = this.el.querySelector('.play-top').offsetHeight;
    var tc = this.el.querySelector('.touch-controls'), eq = this.el.querySelector('.equip-wrap'), help = this.el.querySelector('.local-help');
    var reserved = topH + (tc ? tc.offsetHeight : 0) + (eq ? eq.offsetHeight : 0) + (help ? help.offsetHeight : 0) + 28;
    var availH = Math.max(200, (window.innerHeight - this.root.getBoundingClientRect().top) - reserved);
    var width = this.area.clientWidth || this.root.clientWidth;
    var narrow = width < 600;
    var sideW = narrow ? 58 : 104, gap = narrow ? 6 : 12;
    var n = this.players.length;
    var self = this;
    this.players.forEach(function (p, i) {
      var share = n === 1 ? 1 : (m === 'battle' ? (i === 0 ? 0.58 : 0.42) : 0.5);
      var colW = width * share - (n > 1 ? gap : 0);
      var boardW = colW - 2 * sideW - 2 * gap;
      var boardH = availH * (m === 'battle' && i === 1 ? 0.78 : 1);
      var cell = p.renderer.fit(Math.max(80, boardW), Math.max(160, boardH));
      p.col.style.width = n === 1 ? '' : (share * 100) + '%';
      p.col.querySelectorAll('.side').forEach(function (s) { s.style.width = sideW + 'px'; });
      var pv = sideW - 8;
      R.drawPreview(p.hold, self.theme, p.game.hold, pv);
      for (var k = 0; k < p.nexts.length; k++) R.drawPreview(p.nexts[k], self.theme, p.game.queue[k], k === 0 ? pv : Math.round(pv * 0.75));
      p.cell = cell;
    });
  };

  GameScreen.prototype.frame = function (now) {
    var dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); this.last = now;
    if (this.paused || this.finished) { this.players.forEach(function (p) { p.renderer.draw(p.game, { dim: true }); }); return; }
    var self = this;
    if (this.slowTimer > 0) { this.slowTimer -= dt; if (this.slowTimer <= 0) { this.players[0].game.gravityScale = 1; this.popup(this.players[0], 'Time back to normal'); } }
    this.players.forEach(function (p) {
      if (p.input) p.input.update(dt);
      if (p.bot) p.bot.update(dt);
      var events = p.game.update(dt);
      for (var i = 0; i < events.length; i++) self.onEvent(p, events[i]);
    });
    if (this.finished) return;
    var user = this.user;
    this.players.forEach(function (p) { p.renderer.draw(p.game, { ghost: user.settings.ghost !== false, dim: !!p.out }); });
    if (now - this.lastHud > 80) { this.lastHud = now; this.players.forEach(function (p) { self.updateHud(p); }); }
    if (this.stage && !this.finished && A.goalMet(this.stage, this.players[0].game)) this.stageComplete();
  };

  GameScreen.prototype.updateHud = function (p) {
    var g = p.game, h = p.hud;
    h.score.textContent = fmtNum(g.score); h.lines.textContent = g.lines; h.level.textContent = g.level; h.time.textContent = fmtTime(g.time);
    if (h.sent) { h.sent.textContent = g.stats.attackSent; h.taken.textContent = g.stats.garbageTaken; }
    if (this.stage && h.goalFill) { var pr = A.progress(this.stage, g); h.goalFill.style.width = pr.pct + '%'; h.goalNum.textContent = pr.value.toLocaleString() + ' / ' + pr.target.toLocaleString(); }
    if (p.lastHold !== g.hold) { p.lastHold = g.hold; R.drawPreview(p.hold, this.theme, g.hold, (p.hold.clientWidth || 48)); }
    var q = g.queue.join('');
    if (p.lastQueue !== q) { p.lastQueue = q; var pv = p.hold.clientWidth || 48; for (var k = 0; k < p.nexts.length; k++) R.drawPreview(p.nexts[k], this.theme, g.queue[k], k === 0 ? pv : Math.round(pv * 0.75)); }
  };

  GameScreen.prototype.popup = function (p, text, cls) {
    p.popup.innerHTML = '<span class="' + (cls || '') + '">' + esc(text) + '</span>';
    p.popup.classList.add('show');
    clearTimeout(p.popupTimer);
    p.popupTimer = setTimeout(function () { p.popup.classList.remove('show'); }, 900);
  };

  GameScreen.prototype.onEvent = function (p, ev) {
    var m = this.mode;
    switch (ev.type) {
      case 'clear':
        if (p.idx === 0 || m === 'local') sfx(/T-spin/.test(ev.label) ? 'tspin' : 'clear' + ev.lines);
        var txt = ev.label + (ev.b2b ? ' · B2B' : '') + (ev.combo > 0 ? ' · ' + ev.combo + ' combo' : '');
        this.popup(p, txt, ev.lines === 4 || ev.perfect || /T-spin/.test(ev.label) ? 'big' : '');
        if (p.idx === 0 && (m === 'classic' || m === 'adventure')) this.coinsEarned += ev.lines * C.COINS_PER_LINE;
        if (m === 'battle' || m === 'local') {
          var other = this.players[1 - p.idx];
          var remaining = p.game.cancelGarbage(ev.attack);
          if (remaining > 0 && !other.out) { other.game.receiveGarbage(remaining); p.game.stats.attackSent += remaining; }
        }
        break;
      case 'lock': if (p.idx === 0 || m === 'local') sfx('lock'); break;
      case 'tspin': this.popup(p, (ev.kind === 'mini' ? 'Mini ' : '') + 'T-spin'); if (p.idx === 0) sfx('tspin'); break;
      case 'level': this.popup(p, 'Level ' + ev.level, 'big'); sfx('level'); break;
      case 'garbage': p.renderer.flash = 1; if (p.idx === 0 || m === 'local') sfx('garbage'); break;
      case 'shield': this.popup(p, 'Shield used', 'big'); sfx('shield'); break;
      case 'bomb': this.popup(p, 'Line Bomb'); sfx('clear2'); break;
      case 'gameover': if (p.idx === 0 || m === 'local') sfx('over'); this.onGameOver(p, ev.reason); break;
    }
  };

  // ---- endings -----------------------------------------------------------
  GameScreen.prototype.onGameOver = function (p, reason) {
    var m = this.mode;
    if (m === 'local') {
      // The player who topped out waits; the other keeps playing until they are out too.
      p.out = true; p.outTime = p.game.time;
      if (p.input) p.input.enabled = false;
      p.game.setSoftDrop(false);
      p.col.querySelector('.board-wrap').insertAdjacentHTML('beforeend', '<div class="out-badge"><b>Out</b><span>' + esc(reason) + ' · ' + fmtTime(p.game.time) + '</span></div>');
      var other = this.players[1 - p.idx];
      if (other.out) return this.battleEnd(p.outTime > other.outTime ? p.idx : (p.outTime < other.outTime ? other.idx : (p.game.score >= other.game.score ? p.idx : other.idx)));
      this.popup(other, 'Player ' + (p.idx + 1) + ' is out. Keep going!', 'big');
      return;
    }
    if (m === 'battle') return this.battleEnd(1 - p.idx);
    this.ended = true; // keeps the pause overlay from replacing this screen
    this.players.forEach(function (q) { q.renderer.draw(q.game, { dim: true }); });
    this.updateHud(p);
    var g = p.game, canContinue = g.continues === 0;
    var noAds = this.user.purchases.removeAds;
    var best = g.score > (this.user.bestScore || 0) && m === 'classic' && g.continues === 0;
    var html = '<div class="panel over">' +
      '<div class="panel-head"><p class="eyebrow danger">' + esc(reason) + '</p><h2>' + (this.stage ? 'Stage failed' : 'Game over') + '</h2></div>' +
      '<div class="hero-score"><span>Score</span><b>' + fmtNum(g.score) + '</b>' + (best ? '<em class="badge">New best</em>' : '') + '</div>' +
      '<div class="stat-strip"><div><span>Lines</span><b>' + g.lines + '</b></div><div><span>Level</span><b>' + g.level + '</b></div><div><span>Tetrises</span><b>' + g.stats.tetrises + '</b></div><div><span>Time</span><b>' + fmtTime(g.time) + '</b></div></div>' +
      '<div class="panel-actions">' +
      (canContinue ? '<button type="button" class="btn btn-primary" data-do="continue">Continue<small>' + (noAds ? 'No ad, you own Remove Ads' : 'Watch a ' + C.AD_SECONDS + ' second ad') + ' · clears the top half</small></button>' : '<p class="muted small">No continues left this run.</p>') +
      '<button type="button" class="btn btn-secondary" data-do="restart">Play again</button>' +
      '<button type="button" class="link-btn" data-do="quit">Back to lobby</button></div>' +
      (m === 'classic' && canContinue ? '<p class="muted small foot-note">A continued run keeps your personal best but is not ranked.</p>' : '') +
      '</div>';
    this.setOverlay(html);
    var self = this;
    this.bindOverlay({
      continue: function () { if (noAds) self.doContinue(); else self.showAd(function () { self.doContinue(); }); },
      restart: function () { self.saveRun(g, 'lost'); self.restart(); },
      quit: function () { self.saveRun(g, 'lost'); self.exit(); }
    });
  };

  GameScreen.prototype.doContinue = function () {
    var p = this.players[0];
    p.game.continueRun();
    this.ended = false;
    this.hideOverlay();
    this.last = performance.now();
    this.popup(p, 'Continue', 'big');
  };

  GameScreen.prototype.showAd = function (done) {
    var self = this, left = C.AD_SECONDS, slides = [
      { eyebrow: 'New theme', title: 'Ember Forge', text: 'Cooling iron and open flame. Rows burn out from orange to ash.', price: S.money(C.PRICES.themes.ember), color: '#ff7a1a' },
      { eyebrow: 'Best value', title: 'Everything bundle', text: 'All five themes plus Remove Ads. No more ad breaks like this one.', price: S.money(C.PRICES.bundle), color: '#f2cf1d' },
      { eyebrow: 'Tip', title: 'Learn the T-spin', text: 'Leave a T-shaped slot and rotate in at the last moment. A T-spin double scores 1200, a Tetris 800.', price: '', color: '#a64ddb' }
    ];
    // Build the panel once; later ticks only touch text and widths, so nothing flashes.
    this.setOverlay('<div class="panel ad"><div class="ad-top"><span class="pill">Ad</span><b class="ad-left"></b></div><div class="ad-bar"><div class="ad-fill" style="width:0%"></div></div>' +
      '<div class="ad-slide"><p class="eyebrow ad-eyebrow"></p><h2 class="ad-title"></h2><p class="ad-text"></p><b class="price ad-price"></b></div>' +
      '<p class="muted small">Reward: continue with the top half of the board cleared</p>' +
      '<button type="button" class="btn btn-wait ad-btn" disabled></button></div>');
    var o = this.overlay, elLeft = o.querySelector('.ad-left'), fill = o.querySelector('.ad-fill'), btn = o.querySelector('.ad-btn');
    var eyebrow = o.querySelector('.ad-eyebrow'), title = o.querySelector('.ad-title'), text = o.querySelector('.ad-text'), price = o.querySelector('.ad-price'), slideEl = o.querySelector('.ad-slide');
    var shown = -1;
    function render() {
      var i = left > 6 ? 0 : left > 3 ? 1 : 2, s = slides[i];
      elLeft.textContent = left + ' s';
      fill.style.width = ((C.AD_SECONDS - left) / C.AD_SECONDS * 100) + '%';
      if (i !== shown) { shown = i; eyebrow.textContent = s.eyebrow; title.textContent = s.title; title.style.color = s.color; text.textContent = s.text; price.textContent = s.price; price.hidden = !s.price; slideEl.classList.remove('fade'); void slideEl.offsetWidth; slideEl.classList.add('fade'); }
      if (left > 0) { btn.textContent = 'Continue in ' + left + ' s'; }
      else { btn.textContent = 'Continue'; btn.disabled = false; btn.className = 'btn btn-primary ad-btn'; }
    }
    btn.addEventListener('click', function () { if (left === 0) { clearInterval(t); done(); } });
    render();
    var t = setInterval(function () { if (left > 0) { left--; render(); } else clearInterval(t); }, 1000);
  };

  GameScreen.prototype.stageComplete = function () {
    this.finished = true;
    sfx('win');
    var g = this.players[0].game, st = this.stage;
    var res = A.complete(this.user, st, { score: Math.floor(g.score), usedEquipment: this.usedEquipment, continued: g.continues > 0 });
    this.stageCoins = res.coins;
    this.saveRun(g, 'won');
    var starsHtml = '<div class="stars">' + [1, 2, 3].map(function (i) { return '<span class="' + (i <= res.stars ? 'on' : '') + '">&#9733;</span>'; }).join('') + '</div>';
    var html = '<div class="panel over"><div class="panel-head"><p class="eyebrow good">Goal reached</p><h2>' + esc(st.name) + ' clear</h2></div>' + starsHtml +
      '<div class="hero-score"><span>Coins earned</span><b>+' + (res.coins + this.coinsEarned) + '</b></div>' +
      '<div class="stat-strip cols-3"><div><span>Score</span><b>' + fmtNum(g.score) + '</b></div><div><span>Lines</span><b>' + g.lines + '</b></div><div><span>Time</span><b>' + fmtTime(g.time) + '</b></div></div>' +
      '<div class="panel-actions">' + (st.n < A.COUNT ? '<button type="button" class="btn btn-primary" data-do="next">Next stage</button>' : '<p class="muted">You finished every stage.</p>') +
      '<button type="button" class="btn btn-secondary" data-do="restart">Replay</button><button type="button" class="link-btn" data-do="quit">Back to stages</button></div></div>';
    this.setOverlay(html);
    var self = this;
    this.bindOverlay({ next: function () { self.destroy(); location.hash = '#/play/adventure/' + (st.n + 1); }, restart: function () { self.restart(); }, quit: function () { self.destroy(); location.hash = '#/adventure'; } });
  };

  GameScreen.prototype.battleEnd = function (winnerIdx) {
    this.finished = true;
    var m = this.mode, g = this.players[0].game;
    var html;
    if (m === 'battle') {
      var won = winnerIdx === 0, delta = won ? 12 + Math.round(Math.random() * 6) : -(10 + Math.round(Math.random() * 6));
      sfx(won ? 'win' : 'over');
      this.user.rating = (this.user.rating || 1000) + delta; this.user.battles[won ? 'w' : 'l']++; B.persist();
      B.saveRun({ mode: 'battle', score: Math.floor(g.score), lines: g.lines, level: g.level, time: Math.floor(g.time), result: won ? 'win' : 'loss', opponent: this.opponent.name, ratingDelta: delta, attackSent: g.stats.attackSent, theme: this.theme.id });
      html = '<div class="panel over"><div class="panel-head"><p class="eyebrow ' + (won ? 'good' : 'danger') + '">' + (won ? 'Victory' : 'Defeat') + '</p><h2>' + (won ? 'You win' : esc(this.opponent.name) + ' wins') + '</h2></div>' +
        '<div class="hero-score"><span>Rating</span><b>' + this.user.rating + '</b><em class="badge ' + (won ? '' : 'badge-muted') + '">' + (delta > 0 ? '+' : '') + delta + '</em></div>' +
        '<div class="stat-strip"><div><span>Sent</span><b>' + g.stats.attackSent + '</b></div><div><span>Taken</span><b>' + g.stats.garbageTaken + '</b></div><div><span>Lines</span><b>' + g.lines + '</b></div><div><span>Time</span><b>' + fmtTime(g.time) + '</b></div></div>' +
        '<div class="panel-actions"><button type="button" class="btn btn-primary" data-do="restart">Rematch</button><button type="button" class="link-btn" data-do="quit">Back to battle</button></div></div>';
    } else {
      var p1 = this.players[0], p2 = this.players[1], w = this.players[winnerIdx], l = this.players[1 - winnerIdx];
      var margin = Math.abs((w.outTime || 0) - (l.outTime || 0));
      html = '<div class="panel over"><div class="panel-head"><p class="eyebrow good">Match over</p><h2>Player ' + (winnerIdx + 1) + ' wins</h2></div>' +
        '<div class="hero-score"><span>Survived longer by</span><b>' + fmtTime(margin) + '</b></div>' +
        '<div class="stat-strip"><div><span>P1 score</span><b>' + fmtNum(p1.game.score) + '</b></div><div><span>P1 lines</span><b>' + p1.game.lines + '</b></div><div><span>P2 score</span><b>' + fmtNum(p2.game.score) + '</b></div><div><span>P2 lines</span><b>' + p2.game.lines + '</b></div></div>' +
        '<div class="panel-actions"><button type="button" class="btn btn-primary" data-do="restart">Play again</button><button type="button" class="link-btn" data-do="quit">Back to battle</button></div></div>';
    }
    this.setOverlay(html);
    var self = this;
    this.bindOverlay({ restart: function () { self.restart(); }, quit: function () { self.destroy(); location.hash = '#/battle'; } });
  };

  GameScreen.prototype.saveRun = function (g, result) {
    if (this.saved) return; this.saved = true;
    var coins = (this.mode === 'classic' || this.mode === 'adventure') ? this.coinsEarned + (this.stageCoins || 0) : 0;
    B.saveRun({ mode: this.mode, stage: this.stage ? this.stage.n : null, score: Math.floor(g.score), lines: g.lines, level: g.level, time: Math.floor(g.time), pps: g.time > 0 ? Math.round(g.stats.pieces / g.time * 100) / 100 : 0, tetrises: g.stats.tetrises, tspins: g.stats.tspins, continued: g.continues > 0, usedEquipment: this.usedEquipment, result: result, theme: this.theme.id, device: isTouch ? 'touch' : 'keyboard', coins: coins });
    if (this.mode === 'adventure' || this.mode === 'classic') B.persist();
  };

  // ---- equipment ------------------------------------------------------------
  GameScreen.prototype.refreshEquip = function () {
    var inv = this.user.inventory || {};
    var any = false;
    Array.prototype.forEach.call(this.el.querySelectorAll('[data-count]'), function (el) { var n = inv[el.getAttribute('data-count')] || 0; el.textContent = n; el.parentNode.classList.toggle('empty', n === 0); if (n > 0) any = true; });
    var hint = this.el.querySelector('.equip-empty'); if (hint) hint.hidden = any;
  };
  GameScreen.prototype.useEquipment = function (id) {
    if ((this.mode !== 'adventure' && this.mode !== 'classic') || this.paused || this.finished || this.ended) return;
    var p = this.players[0], g = p.game;
    if (this.mode === 'classic' && !this.usedEquipment && this.user.inventory[id] > 0 && id !== 'swap') this.popup(p, 'Assisted run · not ranked');
    if (!(this.user.inventory[id] > 0)) { this.popup(p, 'None left. Buy more in the shop.'); return; }
    var self = this;
    if (id === 'swap') { this.pickSwap(); return; }
    if (!S.useEquipment(id)) return;
    this.usedEquipment = true;
    if (id === 'slow') { g.gravityScale = 0.5; this.slowTimer = 20; this.popup(p, 'Slow Time · 20 s', 'big'); }
    else if (id === 'bomb') { g.clearBottomRows(2); }
    else if (id === 'shield') { g.shield++; this.popup(p, 'Shield ready', 'big'); }
    else if (id === 'boost') { g.scoreMultiplier = 1.5; this.popup(p, 'Score Boost 1.5x', 'big'); }
    this.refreshEquip();
  };
  GameScreen.prototype.pickSwap = function () {
    var self = this, p = this.players[0];
    this.paused = true;
    this.setOverlay('<div class="panel"><h2>Swap to</h2><div class="swap-grid">' + ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].map(function (t) { return '<button type="button" class="swap" data-swap="' + t + '"><canvas></canvas><span>' + t + '</span></button>'; }).join('') + '</div><button type="button" class="link-btn" data-do="cancel">Cancel</button></div>');
    Array.prototype.forEach.call(this.overlay.querySelectorAll('[data-swap]'), function (btn) {
      R.drawPreview(btn.querySelector('canvas'), self.theme, btn.getAttribute('data-swap'), 64);
      btn.addEventListener('click', function () {
        if (S.useEquipment('swap') && p.game.swapCurrent(btn.getAttribute('data-swap'))) { self.usedEquipment = true; self.refreshEquip(); self.popup(p, 'Swapped'); }
        self.hideOverlay(); self.paused = false; self.last = performance.now();
      });
    });
    this.bindOverlay({ cancel: function () { self.hideOverlay(); self.paused = false; self.last = performance.now(); } });
  };

  // ---- overlay, pause, lifecycle ------------------------------------------------
  GameScreen.prototype.setOverlay = function (html) { this.overlay.innerHTML = html; this.overlay.hidden = false; };
  GameScreen.prototype.hideOverlay = function () { this.overlay.hidden = true; this.overlay.innerHTML = ''; };
  GameScreen.prototype.bindOverlay = function (handlers) {
    var self = this;
    Array.prototype.forEach.call(this.overlay.querySelectorAll('[data-do]'), function (btn) {
      var k = btn.getAttribute('data-do');
      if (handlers[k]) btn.addEventListener('click', function (e) { e.preventDefault(); handlers[k](); });
    });
  };
  GameScreen.prototype.togglePause = function () {
    if (this.finished || this.ended || !this.running) return;
    if (root.GameAudio) root.GameAudio.duck(!this.paused);
    if (!this.paused) {
      this.paused = true;
      this.players.forEach(function (p) { p.game.setSoftDrop(false); });
      var keys = this.mode === 'local'
        ? '<div class="keyguide-row">' + keyGuide('wasd', 'Player 1 · left') + keyGuide('arrows', 'Player 2 · right') + '</div>'
        : (isTouch ? '<p class="muted small foot-note">Swipe sideways to move · tap to rotate · flick down to drop · or use the buttons</p>' : '<div class="keyguide-row">' + keyGuide('arrows', 'Keyboard') + '</div>');
      this.setOverlay('<div class="panel' + (this.mode === 'local' ? ' wide' : '') + '"><div class="panel-head"><p class="eyebrow">Take a breath</p><h2>Paused</h2></div>' + keys +
        '<div class="panel-actions"><button type="button" class="btn btn-primary" data-do="resume">Resume</button><button type="button" class="btn btn-secondary" data-do="restart">Restart</button><button type="button" class="link-btn" data-do="quit">' + (this.mode === 'local' || this.mode === 'battle' ? 'Quit to battle' : 'Quit to lobby') + '</button></div>' +
        '<p class="muted small foot-note">Esc or P pauses</p></div>');
      var self = this;
      this.bindOverlay({ resume: function () { self.hideOverlay(); self.paused = false; self.last = performance.now(); }, restart: function () { self.restart(); }, quit: function () { if (!self.saved) self.saveRun(self.players[0].game, 'quit'); self.exit(); } });
    } else { this.hideOverlay(); this.paused = false; this.last = performance.now(); }
  };
  GameScreen.prototype.restart = function () {
    this.teardownPlayers(); this.hideOverlay();
    this.saved = false; this.coinsEarned = 0; this.stageCoins = 0; this.usedEquipment = false; this.slowTimer = 0; this.finished = false; this.ended = false;
    Array.prototype.forEach.call(this.el.querySelectorAll('.opp, .out-badge'), function (n) { n.remove(); });
    cancelAnimationFrame(this.raf); this.running = false;
    this.start();
  };
  GameScreen.prototype.teardownPlayers = function () { this.players.forEach(function (p) { if (p.input) p.input.destroy(); }); this.players = []; };
  GameScreen.prototype.exit = function () { this.destroy(); if (this.opts.onExit) this.opts.onExit(); else location.hash = '#/lobby'; };
  GameScreen.prototype.destroy = function () {
    this.running = false; cancelAnimationFrame(this.raf);
    clearInterval(this.nowPlayingTimer);
    if (root.GameAudio) root.GameAudio.stopMusic();
    this.teardownPlayers();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVis);
  };

  root.Play = { start: function (rootEl, opts) { return new GameScreen(rootEl, opts); } };
})(window);
