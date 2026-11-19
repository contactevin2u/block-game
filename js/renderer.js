/* Canvas rendering of a Game using a theme. Board canvas plus small preview canvases. */
(function (root) {
  'use strict';
  var E = root.Engine, T = root.Themes;
  var VISIBLE = E.ROWS - E.HIDDEN;

  function BoardRenderer(canvas, theme) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.theme = theme; this.cell = 24; this.dpr = 1;
    this.flash = 0;
  }
  BoardRenderer.prototype.setTheme = function (th) { this.theme = th; };

  // Fit the board into a box, keeping whole-pixel cells. Returns the cell size.
  BoardRenderer.prototype.fit = function (maxW, maxH) {
    var cell = Math.max(8, Math.floor(Math.min(maxW / E.COLS, maxH / VISIBLE)));
    this.cell = cell;
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    var w = cell * E.COLS, h = cell * VISIBLE;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    return cell;
  };

  BoardRenderer.prototype.draw = function (game, opts) {
    opts = opts || {};
    var ctx = this.ctx, th = this.theme, s = this.cell, W = s * E.COLS, H = s * VISIBLE;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = th.boardBg; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
    for (var c = 1; c < E.COLS; c++) { ctx.beginPath(); ctx.moveTo(c * s + 0.5, 0); ctx.lineTo(c * s + 0.5, H); ctx.stroke(); }
    for (var r = 1; r < VISIBLE; r++) { ctx.beginPath(); ctx.moveTo(0, r * s + 0.5); ctx.lineTo(W, r * s + 0.5); ctx.stroke(); }

    var clearing = {};
    for (var i = 0; i < game.clearingRows.length; i++) clearing[game.clearingRows[i]] = true;
    var p = game.phase === 'clearing' ? 1 - Math.max(0, game.phaseTimer) / game.clearDuration : 0;

    for (var y = E.HIDDEN; y < E.ROWS; y++) {
      var py = (y - E.HIDDEN) * s;
      for (var x = 0; x < E.COLS; x++) {
        var t = game.grid[y][x];
        if (!t) continue;
        if (clearing[y]) T.drawClearingCell(ctx, th, x * s, py, s, t, x, p);
        else T.drawBlock(ctx, th, x * s, py, s, t, false);
      }
    }

    if (game.current && game.phase === 'play') {
      var cur = game.current, gy = game.ghostY();
      if (opts.ghost !== false) {
        var gc = game.cells({ type: cur.type, rot: cur.rot, x: cur.x, y: gy });
        for (i = 0; i < gc.length; i++) if (gc[i][1] >= E.HIDDEN && gc[i][1] !== undefined) T.drawBlock(ctx, th, gc[i][0] * s, (gc[i][1] - E.HIDDEN) * s, s, cur.type, true);
      }
      var cc = game.cells(cur);
      for (i = 0; i < cc.length; i++) if (cc[i][1] >= E.HIDDEN) T.drawBlock(ctx, th, cc[i][0] * s, (cc[i][1] - E.HIDDEN) * s, s, cur.type, false);
    }

    // Pending garbage meter on the left edge
    if (game.pendingGarbage > 0) {
      ctx.fillStyle = 'rgba(232,69,60,.85)';
      var gh = Math.min(game.pendingGarbage, VISIBLE) * s;
      ctx.fillRect(0, H - gh, Math.max(3, s * 0.18), gh);
    }

    if (opts.dim) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, H); }
    if (this.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + this.flash * 0.35 + ')'; ctx.fillRect(0, 0, W, H); this.flash = Math.max(0, this.flash - 0.08); }
    ctx.strokeStyle = th.frame; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
  };

  // Small canvas preview of one piece type (hold / next).
  function drawPreview(canvas, theme, type, size) {
    var ctx = canvas.getContext('2d'), dpr = Math.min(3, window.devicePixelRatio || 1);
    var w = size, h = Math.round(size * 0.6);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!type) return;
    var cells = E.shape(type, 0), minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (var i = 0; i < cells.length; i++) { minX = Math.min(minX, cells[i][0]); maxX = Math.max(maxX, cells[i][0]); minY = Math.min(minY, cells[i][1]); maxY = Math.max(maxY, cells[i][1]); }
    var cs = Math.floor(Math.min(w / 5, h / 3));
    var pw = (maxX - minX + 1) * cs, ph = (maxY - minY + 1) * cs;
    var ox = (w - pw) / 2, oy = (h - ph) / 2;
    for (i = 0; i < cells.length; i++) T.drawBlock(ctx, theme, ox + (cells[i][0] - minX) * cs, oy + (cells[i][1] - minY) * cs, cs, type, false);
  }

  // A static sample stack for shop previews.
  function drawSample(canvas, theme, width) {
    var cell = Math.floor(width / 10);
    var r = new BoardRenderer(canvas, theme);
    r.fit(cell * 10, cell * 20);
    var g = new E.Game({ seed: 4 });
    var stack = ['JJJLLOOZZ.', 'JSSLOOTZZ.', 'ZZSSTTTLL.', 'ZOOJJJSSL.', 'TTTOOS....'];
    for (var y = 0; y < stack.length; y++) for (var x = 0; x < 10; x++) { var ch = stack[y][x]; if (ch !== '.') g.grid[E.ROWS - 1 - y][x] = ch; }
    g.current = { type: 'T', rot: 0, x: 3, y: 8 };
    g.phase = 'play';
    r.draw(g);
  }

  root.Renderer = { BoardRenderer: BoardRenderer, drawPreview: drawPreview, drawSample: drawSample };
})(window);
