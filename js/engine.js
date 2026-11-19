/* Guideline-style block engine. Pure logic, no DOM, so it runs in the browser and in Node tests.
   Board: 10 wide, 22 tall with the top 2 rows hidden. y grows downward. */
(function (root) {
  'use strict';

  var COLS = 10, ROWS = 22, HIDDEN = 2;

  var SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    O: [[1,1],[1,1]],
    T: [[0,1,0],[1,1,1],[0,0,0]],
    S: [[0,1,1],[1,1,0],[0,0,0]],
    Z: [[1,1,0],[0,1,1],[0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]],
    L: [[0,0,1],[1,1,1],[0,0,0]]
  };

  // SRS wall kicks, (dx, dy) with y DOWN. Index: from rotation, then 'cw' or 'ccw'.
  var KICKS_JLSTZ = {
    '0cw':  [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '1ccw': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    '1cw':  [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
    '2ccw': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
    '2cw':  [[0,0],[1,0],[1,-1],[0,2],[1,2]],
    '3ccw': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '3cw':  [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
    '0ccw': [[0,0],[1,0],[1,-1],[0,2],[1,2]]
  };
  var KICKS_I = {
    '0cw':  [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
    '1ccw': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
    '1cw':  [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
    '2ccw': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
    '2cw':  [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
    '3ccw': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
    '3cw':  [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
    '0ccw': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]]
  };

  var ROT_CACHE = {};
  function rotateMatrix(m) {
    var n = m.length, out = [];
    for (var y = 0; y < n; y++) { out.push([]); for (var x = 0; x < n; x++) out[y].push(m[n - 1 - x][y]); }
    return out;
  }
  function shape(type, rot) {
    var key = type + rot;
    if (!ROT_CACHE[key]) {
      var m = SHAPES[type];
      for (var i = 0; i < rot; i++) m = rotateMatrix(m);
      var cells = [];
      for (var y = 0; y < m.length; y++) for (var x = 0; x < m.length; x++) if (m[y][x]) cells.push([x, y]);
      ROT_CACHE[key] = cells;
    }
    return ROT_CACHE[key];
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Guideline gravity: seconds per row at a level.
  function gravitySeconds(level) {
    var l = Math.min(level, 20);
    return Math.pow(0.8 - (l - 1) * 0.007, l - 1);
  }

  var LINE_SCORE = [0, 100, 300, 500, 800];
  var TSPIN_SCORE = { full: [400, 800, 1200, 1600], mini: [100, 200, 400, 400] };
  var PC_SCORE = [0, 800, 1200, 1800, 2000];
  var ATTACK_LINES = [0, 0, 1, 2, 4];
  var ATTACK_TSPIN = [0, 2, 4, 6];
  var COMBO_ATTACK = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

  function Game(opts) {
    opts = opts || {};
    this.seed = opts.seed === undefined ? (Date.now() & 0xffffffff) : opts.seed;
    this.rand = mulberry32(this.seed);
    this.startLevel = opts.startLevel || 1;
    this.levelUp = opts.levelUp !== false;
    this.lockDelay = 0.5;
    this.maxResets = 15;
    this.clearDuration = opts.clearDuration || 0.3;
    this.gravityScale = 1;        // equipment: Slow Time sets 0.5
    this.scoreMultiplier = 1;     // equipment: Score Boost sets 1.5
    this.shield = 0;              // equipment: survive a top-out
    this.reset();
  }

  Game.prototype.reset = function () {
    this.grid = [];
    for (var y = 0; y < ROWS; y++) this.grid.push(new Array(COLS).fill(0));
    this.bag = [];
    this.queue = [];
    while (this.queue.length < 5) this.queue.push(this.drawFromBag());
    this.hold = null;
    this.canHold = true;
    this.current = null;
    this.score = 0; this.lines = 0; this.level = this.startLevel;
    this.combo = -1; this.b2b = -1;
    this.over = false; this.overReason = '';
    this.time = 0;
    this.phase = 'spawn'; this.phaseTimer = 0;
    this.gravityAcc = 0; this.lockTimer = 0; this.resets = 0; this.grounded = false;
    this.softDropping = false;
    this.lastAction = null; this.lastKick = 0;
    this.pendingGarbage = 0;
    this.clearingRows = [];
    this.lastClear = null;
    this.stats = { pieces: 0, tetrises: 0, tspins: 0, perfectClears: 0, attackSent: 0, garbageTaken: 0, maxCombo: 0 };
    this.events = [];
    this.continues = 0;
    this.spawn();
  };

  Game.prototype.drawFromBag = function () {
    if (!this.bag.length) {
      this.bag = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
      for (var i = this.bag.length - 1; i > 0; i--) { var j = Math.floor(this.rand() * (i + 1)); var t = this.bag[i]; this.bag[i] = this.bag[j]; this.bag[j] = t; }
    }
    return this.bag.pop();
  };

  Game.prototype.spawnPiece = function (type) {
    // Spawn so the piece is fully visible after its first drop; the hidden rows are a buffer for kicks.
    return { type: type, rot: 0, x: type === 'O' ? 4 : 3, y: HIDDEN - 1 };
  };

  Game.prototype.spawn = function () {
    var type = this.queue.shift();
    this.queue.push(this.drawFromBag());
    this.current = this.spawnPiece(type);
    this.canHold = true;
    this.gravityAcc = 0; this.lockTimer = 0; this.resets = 0; this.grounded = false;
    this.lastAction = null; this.lastKick = 0;
    this.phase = 'play';
    if (this.collides(this.current, 0, 0)) {
      // Block out. Try one row up, then it is over.
      if (!this.collides(this.current, 0, -1)) this.current.y -= 1;
      else return this.topOut('Block out');
    }
    // Guideline: a piece drops one row immediately on spawn when it can.
    if (!this.collides(this.current, 0, 1)) this.current.y += 1;
    this.stats.pieces++;
  };

  Game.prototype.topOut = function (reason) {
    if (this.shield > 0) {
      this.shield--;
      this.clearTopRows(ROWS / 2);
      this.events.push({ type: 'shield' });
      this.current = null;
      this.phase = 'spawn'; this.phaseTimer = 0.2;
      return;
    }
    this.over = true; this.overReason = reason; this.phase = 'over';
    this.events.push({ type: 'gameover', reason: reason });
  };

  Game.prototype.cells = function (p, dx, dy) {
    var s = shape(p.type, p.rot), out = [];
    for (var i = 0; i < s.length; i++) out.push([p.x + s[i][0] + (dx || 0), p.y + s[i][1] + (dy || 0)]);
    return out;
  };

  Game.prototype.collides = function (p, dx, dy, rot) {
    var q = rot === undefined ? p : { type: p.type, rot: rot, x: p.x, y: p.y };
    var c = this.cells(q, dx, dy);
    for (var i = 0; i < c.length; i++) {
      var x = c[i][0], y = c[i][1];
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && this.grid[y][x]) return true;
    }
    return false;
  };

  Game.prototype.ghostY = function () {
    if (!this.current) return 0;
    var dy = 0;
    while (!this.collides(this.current, 0, dy + 1)) dy++;
    return this.current.y + dy;
  };

  // ---- player actions -------------------------------------------------
  Game.prototype.move = function (dx) {
    if (this.phase !== 'play' || !this.current) return false;
    if (this.collides(this.current, dx, 0)) return false;
    this.current.x += dx; this.lastAction = 'move'; this.touchReset();
    return true;
  };
  Game.prototype.moveLeft = function () { return this.move(-1); };
  Game.prototype.moveRight = function () { return this.move(1); };

  Game.prototype.rotate = function (dir) {
    if (this.phase !== 'play' || !this.current || this.current.type === 'O') return false;
    var p = this.current, from = p.rot, to = (from + (dir === 'cw' ? 1 : 3)) % 4;
    var table = p.type === 'I' ? KICKS_I : KICKS_JLSTZ;
    var kicks = table[from + dir];
    for (var i = 0; i < kicks.length; i++) {
      if (!this.collides(p, kicks[i][0], kicks[i][1], to)) {
        p.rot = to; p.x += kicks[i][0]; p.y += kicks[i][1];
        this.lastAction = 'rotate'; this.lastKick = i; this.touchReset();
        return true;
      }
    }
    return false;
  };
  Game.prototype.rotateCW = function () { return this.rotate('cw'); };
  Game.prototype.rotateCCW = function () { return this.rotate('ccw'); };

  Game.prototype.holdPiece = function () {
    if (this.phase !== 'play' || !this.current || !this.canHold) return false;
    var cur = this.current.type;
    if (this.hold) { var h = this.hold; this.hold = cur; this.current = this.spawnPiece(h); }
    else { this.hold = cur; this.current = this.spawnPiece(this.queue.shift()); this.queue.push(this.drawFromBag()); }
    this.canHold = false;
    this.gravityAcc = 0; this.lockTimer = 0; this.resets = 0; this.grounded = false; this.lastAction = null;
    if (this.collides(this.current, 0, 0)) return this.topOut('Block out'), true;
    return true;
  };

  Game.prototype.hardDrop = function () {
    if (this.phase !== 'play' || !this.current) return false;
    var gy = this.ghostY(), dist = gy - this.current.y;
    this.current.y = gy;
    this.score += 2 * dist * this.scoreMultiplier;
    if (dist > 0) this.lastAction = 'drop';
    this.lock();
    return true;
  };

  Game.prototype.setSoftDrop = function (on) { this.softDropping = !!on; };

  Game.prototype.touchReset = function () {
    if (this.grounded && this.resets < this.maxResets) { this.lockTimer = 0; this.resets++; }
  };

  // ---- equipment hooks -------------------------------------------------
  Game.prototype.clearTopRows = function (n) {
    for (var y = 0; y < Math.min(n, ROWS); y++) this.grid[y] = new Array(COLS).fill(0);
  };
  Game.prototype.clearBottomRows = function (n) {
    for (var i = 0; i < n; i++) { this.grid.splice(ROWS - 1, 1); this.grid.unshift(new Array(COLS).fill(0)); }
    this.events.push({ type: 'bomb', rows: n });
  };
  Game.prototype.swapCurrent = function (type) {
    if (this.phase !== 'play' || !this.current || !SHAPES[type]) return false;
    var p = this.spawnPiece(type); p.x = this.current.x; p.y = this.current.y;
    if (this.collides(p, 0, 0)) p = this.spawnPiece(type);
    if (this.collides(p, 0, 0)) return false;
    this.current = p; this.lastAction = null; return true;
  };
  Game.prototype.continueRun = function () {
    this.clearTopRows(ROWS / 2 + HIDDEN / 2);
    this.over = false; this.overReason = '';
    this.continues++;
    this.combo = -1; this.b2b = -1;
    this.phase = 'spawn'; this.phaseTimer = 0.3; this.current = null;
  };

  // ---- locking and clearing --------------------------------------------
  Game.prototype.isTSpin = function () {
    var p = this.current;
    if (p.type !== 'T' || this.lastAction !== 'rotate') return null;
    var cx = p.x + 1, cy = p.y + 1; // T centre in its 3x3 box
    var filled = function (x, y) { return x < 0 || x >= COLS || y >= ROWS || (y >= 0 && this.grid[y][x]); }.bind(this);
    var corners = [filled(cx - 1, cy - 1), filled(cx + 1, cy - 1), filled(cx + 1, cy + 1), filled(cx - 1, cy + 1)]; // TL TR BR BL
    // Front corners by rotation: 0 points up (TL,TR), 1 right (TR,BR), 2 down (BR,BL), 3 left (BL,TL)
    var frontIdx = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot];
    var backIdx = [[2, 3], [3, 0], [0, 1], [1, 2]][p.rot];
    var front = corners[frontIdx[0]] + corners[frontIdx[1]];
    var back = corners[backIdx[0]] + corners[backIdx[1]];
    if (front + back < 3) return null;
    if (front === 2) return 'full';
    if (this.lastKick === 4) return 'full'; // the famous fifth kick counts as full
    return 'mini';
  };

  Game.prototype.lock = function () {
    var p = this.current, c = this.cells(p), allHidden = true;
    for (var i = 0; i < c.length; i++) {
      var x = c[i][0], y = c[i][1];
      if (y >= 0) { this.grid[y][x] = p.type; }
      if (y >= HIDDEN) allHidden = false;
    }
    var tspin = this.isTSpin();
    var full = [];
    for (var y2 = 0; y2 < ROWS; y2++) { var ok = true; for (var x2 = 0; x2 < COLS; x2++) if (!this.grid[y2][x2]) { ok = false; break; } if (ok) full.push(y2); }

    this.events.push({ type: 'lock', piece: p.type });
    if (allHidden && !full.length) { this.current = null; return this.topOut('Lock out'); }
    this.current = null;

    if (full.length) {
      this.clearingRows = full;
      this.scoreClear(full.length, tspin);
      this.phase = 'clearing'; this.phaseTimer = this.clearDuration;
    } else {
      if (tspin) { this.score += TSPIN_SCORE[tspin][0] * this.level * this.scoreMultiplier; this.stats.tspins++; this.events.push({ type: 'tspin', kind: tspin, lines: 0 }); }
      this.combo = -1;
      this.applyGarbage();
      this.phase = 'spawn'; this.phaseTimer = 0;
    }
  };

  Game.prototype.scoreClear = function (n, tspin) {
    var level = this.level, pts = 0, label = '';
    var difficult = n === 4 || !!tspin;
    this.combo++;
    if (this.combo > this.stats.maxCombo) this.stats.maxCombo = this.combo;
    if (tspin) { pts = TSPIN_SCORE[tspin][n] * level; label = (tspin === 'mini' ? 'Mini ' : '') + 'T-spin ' + ['', 'Single', 'Double', 'Triple'][n]; this.stats.tspins++; }
    else { pts = LINE_SCORE[n] * level; label = ['', 'Single', 'Double', 'Triple', 'Quad'][n]; if (n === 4) this.stats.tetrises++; }
    var b2bActive = false;
    if (difficult) { this.b2b++; if (this.b2b > 0) { pts = Math.floor(pts * 1.5); b2bActive = true; } }
    else this.b2b = -1;
    if (this.combo > 0) pts += 50 * this.combo * level;

    // Perfect clear check: everything outside the full rows is empty.
    var pc = true;
    for (var y = 0; y < ROWS && pc; y++) { if (this.clearingRows.indexOf(y) >= 0) continue; for (var x = 0; x < COLS; x++) if (this.grid[y][x]) { pc = false; break; } }
    if (pc) { pts += (b2bActive && n === 4 ? 3200 : PC_SCORE[n]) * level; this.stats.perfectClears++; label = 'Perfect clear'; }

    pts = Math.floor(pts * this.scoreMultiplier);
    this.score += pts;
    this.lines += n;

    var attack = tspin ? ATTACK_TSPIN[n] : ATTACK_LINES[n];
    if (tspin === 'mini') attack = n >= 2 ? 1 : 0;
    if (b2bActive) attack += 1;
    attack += COMBO_ATTACK[Math.min(this.combo, COMBO_ATTACK.length - 1)];
    if (pc) attack += 10;

    this.lastClear = { lines: n, label: label, points: pts, b2b: b2bActive, combo: this.combo, attack: attack, perfect: pc, tspin: tspin };
    this.events.push({ type: 'clear', lines: n, label: label, points: pts, b2b: b2bActive, combo: this.combo, attack: attack, perfect: pc });

    if (this.levelUp) {
      var newLevel = this.startLevel + Math.floor(this.lines / 10);
      if (newLevel > this.level) { this.level = newLevel; this.events.push({ type: 'level', level: newLevel }); }
    }
  };

  Game.prototype.finishClear = function () {
    var rows = this.clearingRows;
    for (var i = 0; i < rows.length; i++) { this.grid.splice(rows[i], 1); this.grid.unshift(new Array(COLS).fill(0)); }
    this.clearingRows = [];
    this.applyGarbage();
    this.phase = 'spawn'; this.phaseTimer = 0;
  };

  // ---- garbage (battle) --------------------------------------------------
  Game.prototype.receiveGarbage = function (n) { if (n > 0) this.pendingGarbage += n; };
  Game.prototype.cancelGarbage = function (attack) {
    var used = Math.min(attack, this.pendingGarbage);
    this.pendingGarbage -= used;
    return attack - used;
  };
  Game.prototype.applyGarbage = function () {
    var n = Math.min(this.pendingGarbage, 8);
    if (n <= 0) return;
    this.pendingGarbage -= n;
    var hole = Math.floor(this.rand() * COLS);
    for (var i = 0; i < n; i++) {
      this.grid.shift();
      var row = new Array(COLS).fill('G'); row[hole] = 0;
      this.grid.push(row);
    }
    this.stats.garbageTaken += n;
    this.events.push({ type: 'garbage', lines: n });
  };

  // ---- main update -------------------------------------------------------
  Game.prototype.update = function (dt) {
    if (this.over) return this.drain();
    this.time += dt;
    if (this.phase === 'clearing') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.finishClear();
      return this.drain();
    }
    if (this.phase === 'spawn') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.spawn();
      return this.drain();
    }
    if (this.phase !== 'play' || !this.current) return this.drain();

    var p = this.current;
    var onGround = this.collides(p, 0, 1);
    if (onGround) {
      if (!this.grounded) { this.grounded = true; this.lockTimer = 0; }
      this.lockTimer += dt;
      if (this.lockTimer >= this.lockDelay) { this.lock(); return this.drain(); }
    } else {
      this.grounded = false;
      var secPerRow = gravitySeconds(this.level) / this.gravityScale;
      if (this.softDropping) secPerRow = Math.min(secPerRow, gravitySeconds(1) / 20);
      this.gravityAcc += dt;
      var rows = 0;
      while (this.gravityAcc >= secPerRow && rows < ROWS) { this.gravityAcc -= secPerRow; rows++; }
      if (secPerRow < 0.0005) rows = ROWS; // 20G
      for (var i = 0; i < rows; i++) {
        if (this.collides(p, 0, 1)) { this.gravityAcc = 0; break; }
        p.y += 1;
        if (this.softDropping) this.score += 1 * this.scoreMultiplier;
        if (this.lastAction === 'rotate') this.lastAction = 'fall';
      }
    }
    return this.drain();
  };

  Game.prototype.drain = function () { var e = this.events; this.events = []; return e; };

  Game.prototype.snapshot = function () {
    return { score: Math.floor(this.score), lines: this.lines, level: this.level, time: this.time, stats: this.stats, continues: this.continues, over: this.over, reason: this.overReason };
  };

  root.Engine = { Game: Game, COLS: COLS, ROWS: ROWS, HIDDEN: HIDDEN, shape: shape, SHAPES: SHAPES, gravitySeconds: gravitySeconds, mulberry32: mulberry32 };
})(typeof window !== 'undefined' ? window : globalThis);
