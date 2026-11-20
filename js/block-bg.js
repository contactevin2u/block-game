/* Menu background: block pieces drifting down behind every screen except the game itself, drawn on one canvas.
   Colours come from the player's game theme. Faint behind the page's cards and text so they stay easy to read.
   Removed while a game is on screen, pauses while the tab is hidden, and holds still for players who ask their
   device for reduced motion. */
(function (root) {
  'use strict';
  var SHAPES = [
    [[0, 1], [1, 1], [2, 1], [3, 1]],       // I
    [[0, 0], [1, 0], [0, 1], [1, 1]],       // O
    [[1, 0], [0, 1], [1, 1], [2, 1]],       // T
    [[1, 0], [2, 0], [0, 1], [1, 1]],       // S
    [[0, 0], [1, 0], [1, 1], [2, 1]],       // Z
    [[0, 0], [0, 1], [1, 1], [2, 1]],       // J
    [[2, 0], [0, 1], [1, 1], [2, 1]]        // L
  ];
  var KEYS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  var canvas = null, ctx = null, pieces = [], raf = 0, last = 0, w = 0, h = 0, dpr = 1, dark = false, colors = null, still = false;
  var box = null, frames = 0;                         // where the page's cards and text are, in screen pixels

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function isDark() {
    var m = getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (!m) return false;
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) < 110;
  }
  function makePiece(anywhere) {
    var depth = Math.random();                        // 0 far (small, faint, slow) .. 1 near (big, clearer, faster)
    var cell = 12 + depth * 22;
    var k = Math.floor(Math.random() * SHAPES.length);
    return {
      k: k, cell: cell, depth: depth,
      x: rnd(-cell * 2, w + cell * 2),
      y: anywhere ? rnd(-cell * 4, h) : rnd(-cell * 10, -cell * 4),
      vy: 14 + depth * 34,                            // px per second
      vx: rnd(-4, 4),
      a: rnd(0, Math.PI * 2), va: rnd(-0.35, 0.35) * (0.4 + depth * 0.6)
    };
  }
  function size() {
    dpr = Math.min(2, root.devicePixelRatio || 1);
    w = root.innerWidth; h = root.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var want = Math.max(10, Math.min(40, Math.round(w * h / 36000)));
    while (pieces.length < want) pieces.push(makePiece(true));
    if (pieces.length > want) pieces.length = want;
  }
  // Fainter over the page's cards and text, so they stay the clearest thing on the page; full strength around them.
  function measure() {
    var app = document.getElementById('app'), first = app && app.firstElementChild, lastEl = app && app.lastElementChild;
    if (!first || !lastEl) { box = null; return; }
    var a = first.getBoundingClientRect(), b = lastEl.getBoundingClientRect();
    box = { l: Math.min(a.left, b.left), r: Math.max(a.right, b.right), t: a.top, b: b.bottom };
  }
  function contentFade(x, y) {
    if (!box) return 1;
    var edge = 90, dx = Math.max(box.l - x, 0, x - box.r), dy = Math.max(box.t - y, 0, y - box.b), d = Math.max(dx, dy);
    return d >= edge ? 1 : 0.4 + 0.6 * (d / edge);
  }
  function roundRect(x, y, s, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + s - r, y); ctx.quadraticCurveTo(x + s, y, x + s, y + r);
    ctx.lineTo(x + s, y + s - r); ctx.quadraticCurveTo(x + s, y + s, x + s - r, y + s);
    ctx.lineTo(x + r, y + s); ctx.quadraticCurveTo(x, y + s, x, y + s - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  function drawPiece(p) {
    var cells = SHAPES[p.k], s = p.cell, gap = Math.max(1, s * 0.08), r = s * 0.18;
    var base = (dark ? 0.22 : 0.16) + p.depth * (dark ? 0.26 : 0.2);
    ctx.save();
    ctx.globalAlpha = base * contentFade(p.x, p.y);
    ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.translate(-s * 1.5, -s);
    ctx.fillStyle = colors[KEYS[p.k]] || '#a64ddb';
    for (var i = 0; i < cells.length; i++) {
      var cx = cells[i][0] * s + gap / 2, cy = cells[i][1] * s + gap / 2, cs = s - gap;
      roundRect(cx, cy, cs, r); ctx.fill();
    }
    // A soft highlight on the top-left of each cell, like the blocks on the board.
    ctx.fillStyle = dark ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.35)';
    for (var j = 0; j < cells.length; j++) {
      var hx = cells[j][0] * s + gap / 2 + s * 0.14, hy = cells[j][1] * s + gap / 2 + s * 0.14;
      roundRect(hx, hy, s * 0.3, s * 0.08); ctx.fill();
    }
    ctx.restore();
  }
  function frame(t) {
    raf = 0;
    if (!canvas) return;
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (frames++ % 30 === 0) measure();
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (!still) { p.y += p.vy * dt; p.x += p.vx * dt; p.a += p.va * dt; }
      if (p.y - p.cell * 3 > h) pieces[i] = p = makePiece(false);
      drawPiece(p);
    }
    if (!still && !document.hidden) raf = root.requestAnimationFrame(frame);
  }
  function onResize() { if (canvas) { size(); measure(); if (still) frame(performance.now()); } }
  function onVisible() { if (canvas && !still && !document.hidden && !raf) { last = 0; raf = root.requestAnimationFrame(frame); } }

  root.BlockBg = {
    start: function (themeId) {
      var th = root.Themes && root.Themes.byId(themeId || 'classic');
      colors = (th && th.pieces) || {};
      dark = isDark();
      still = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'block-bg'; canvas.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(canvas, document.body.firstChild);
        ctx = canvas.getContext('2d');
        pieces = [];
        root.addEventListener('resize', onResize);
        document.addEventListener('visibilitychange', onVisible);
      }
      size();
      measure(); frames = 1;
      last = 0;
      if (!raf) raf = root.requestAnimationFrame(frame);
    },
    stop: function () {
      if (!canvas) return;
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      root.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisible);
      canvas.remove(); canvas = null; ctx = null; pieces = [];
    }
  };
})(window);
