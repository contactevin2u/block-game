/* Computer opponent for Battle. Picks a placement by scoring the resulting stack, then
   plays it one input at a time so it looks like a player, not a teleport. */
(function (root) {
  'use strict';
  var E = root.Engine;

  function Bot(game, opts) {
    opts = opts || {};
    this.game = game;
    this.actionInterval = opts.actionInterval || 0.09; // seconds between inputs
    this.thinkDelay = opts.thinkDelay || 0.25;          // pause after a new piece appears
    this.mistake = opts.mistake || 0.08;                // chance to pick a worse placement
    this.timer = 0;
    this.plan = null;
    this.planFor = null;
  }

  Bot.prototype.update = function (dt) {
    var g = this.game;
    if (g.over || g.phase !== 'play' || !g.current) { this.plan = null; return; }
    if (this.planFor !== g.stats.pieces) { this.plan = this.makePlan(); this.planFor = g.stats.pieces; this.timer = -this.thinkDelay; }
    this.timer += dt;
    if (this.timer < this.actionInterval) return;
    this.timer = 0;
    var p = g.current, plan = this.plan;
    if (!plan) { g.hardDrop(); return; }
    if (plan.useHold) { g.holdPiece(); plan.useHold = false; return; }
    if (p.rot !== plan.rot) { if (((plan.rot - p.rot + 4) % 4) === 3) g.rotateCCW(); else g.rotateCW(); return; }
    if (p.x < plan.x) { if (!g.moveRight()) g.hardDrop(); return; }
    if (p.x > plan.x) { if (!g.moveLeft()) g.hardDrop(); return; }
    g.hardDrop();
  };

  Bot.prototype.makePlan = function () {
    var g = this.game;
    var best = this.bestFor(g.current.type, false);
    if (g.canHold) {
      var other = g.hold || g.queue[0];
      var alt = this.bestFor(other, true);
      if (alt && (!best || alt.score > best.score + 0.5)) best = alt;
    }
    if (best && Math.random() < this.mistake && best.second) best = best.second;
    return best;
  };

  Bot.prototype.bestFor = function (type, useHold) {
    var g = this.game, grid = g.grid, COLS = E.COLS, ROWS = E.ROWS;
    var candidates = [];
    for (var rot = 0; rot < 4; rot++) {
      var cells = E.shape(type, rot);
      var minX = 99, maxX = -99;
      for (var i = 0; i < cells.length; i++) { minX = Math.min(minX, cells[i][0]); maxX = Math.max(maxX, cells[i][0]); }
      for (var x = -minX; x + maxX < COLS; x++) {
        // drop from top
        var y = -2, ok = true;
        while (!hits(grid, cells, x, y + 1)) y++;
        if (hits(grid, cells, x, y)) ok = false;
        if (!ok) continue;
        var sc = evaluate(grid, cells, x, y);
        candidates.push({ rot: rot, x: x, score: sc, useHold: useHold });
      }
      if (type === 'O') break;
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.score - a.score; });
    var best = candidates[0]; best.second = candidates[1] || null;
    return best;
  };

  function hits(grid, cells, x, y) {
    for (var i = 0; i < cells.length; i++) {
      var cx = x + cells[i][0], cy = y + cells[i][1];
      if (cx < 0 || cx >= E.COLS || cy >= E.ROWS) return true;
      if (cy >= 0 && grid[cy][cx]) return true;
    }
    return false;
  }

  function evaluate(grid, cells, x, y) {
    var COLS = E.COLS, ROWS = E.ROWS;
    var g = [];
    for (var r = 0; r < ROWS; r++) g.push(grid[r].slice());
    for (var i = 0; i < cells.length; i++) { var cy = y + cells[i][1]; if (cy >= 0) g[cy][x + cells[i][0]] = 1; }
    var lines = 0;
    for (var r2 = 0; r2 < ROWS; r2++) { var full = true; for (var c = 0; c < COLS; c++) if (!g[r2][c]) { full = false; break; } if (full) { lines++; g.splice(r2, 1); g.unshift(new Array(COLS).fill(0)); } }
    var heights = [], holes = 0, agg = 0, bump = 0, maxH = 0;
    for (var c2 = 0; c2 < COLS; c2++) {
      var h = 0, found = false;
      for (var r3 = 0; r3 < ROWS; r3++) {
        if (g[r3][c2]) { if (!found) { found = true; h = ROWS - r3; } }
        else if (found) holes++;
      }
      heights.push(h); agg += h; if (h > maxH) maxH = h;
    }
    for (var c3 = 0; c3 < COLS - 1; c3++) bump += Math.abs(heights[c3] - heights[c3 + 1]);
    var lineBonus = lines === 4 ? 3.2 : lines * 0.6;
    return -0.51 * agg + lineBonus - 0.9 * holes - 0.18 * bump - (maxH > 16 ? (maxH - 16) * 2 : 0);
  }

  root.Bot = Bot;
})(typeof window !== 'undefined' ? window : globalThis);
