/* Keyboard with DAS/ARR, on-screen touch buttons, and swipe gestures. */
(function (root) {
  'use strict';
  var C = root.CONFIG;

  var KEYMAPS = {
    p1: { left: ['ArrowLeft'], right: ['ArrowRight'], soft: ['ArrowDown'], hard: [' ', 'Space'], cw: ['ArrowUp', 'x', 'X'], ccw: ['z', 'Z', 'Control'], hold: ['c', 'C', 'Shift'], pause: ['Escape', 'p', 'P'] },
    p2: { left: ['a', 'A'], right: ['d', 'D'], soft: ['s', 'S'], hard: ['w', 'W'], cw: ['e', 'E'], ccw: ['q', 'Q'], hold: ['f', 'F'], pause: [] }
  };

  function Input(game, opts) {
    opts = opts || {};
    this.game = game;
    this.map = KEYMAPS[opts.keymap || 'p1'];
    this.onPause = opts.onPause || function () {};
    this.onEquip = opts.onEquip || null;
    this.enabled = true;
    this.das = (opts.das || C.DAS_MS) / 1000; this.arr = (opts.arr || C.ARR_MS) / 1000;
    this.dir = 0; this.dasTimer = 0; this.arrTimer = 0; this.charged = false;
    this.pressed = {};
    this.keydown = this.keydown.bind(this); this.keyup = this.keyup.bind(this);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    this.touchTimers = {};
  }

  Input.prototype.destroy = function () {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    this.enabled = false;
  };

  Input.prototype.action = function (name) {
    var m = this.map;
    for (var k in m) if (m[k].indexOf(name) >= 0) return k;
    return null;
  };

  Input.prototype.keydown = function (e) {
    if (!this.enabled) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    var a = this.action(e.key);
    if (!a && this.onEquip && /^[1-5]$/.test(e.key)) { this.onEquip(e.key); e.preventDefault(); return; }
    if (!a) return;
    e.preventDefault();
    if (e.repeat) return;
    this.press(a);
  };
  Input.prototype.keyup = function (e) {
    var a = this.action(e.key);
    if (!a) return;
    this.release(a);
  };

  Input.prototype.press = function (a) {
    var g = this.game;
    this.pressed[a] = true;
    switch (a) {
      case 'left': this.dir = -1; this.dasTimer = 0; this.charged = false; g.moveLeft(); break;
      case 'right': this.dir = 1; this.dasTimer = 0; this.charged = false; g.moveRight(); break;
      case 'soft': g.setSoftDrop(true); break;
      case 'hard': g.hardDrop(); break;
      case 'cw': g.rotateCW(); break;
      case 'ccw': g.rotateCCW(); break;
      case 'hold': g.holdPiece(); break;
      case 'pause': this.onPause(); break;
    }
  };
  Input.prototype.release = function (a) {
    this.pressed[a] = false;
    if (a === 'left' && this.dir === -1) this.dir = this.pressed.right ? 1 : 0;
    if (a === 'right' && this.dir === 1) this.dir = this.pressed.left ? -1 : 0;
    if (a === 'left' || a === 'right') { this.dasTimer = 0; this.charged = false; }
    if (a === 'soft') this.game.setSoftDrop(false);
  };

  // Call every frame for DAS / ARR auto-shift.
  Input.prototype.update = function (dt) {
    if (!this.dir) return;
    var g = this.game;
    this.dasTimer += dt;
    if (!this.charged) { if (this.dasTimer >= this.das) { this.charged = true; this.arrTimer = 0; } else return; }
    this.arrTimer += dt;
    if (this.arr <= 0) { while (this.dir < 0 ? g.moveLeft() : g.moveRight()) {} return; }
    while (this.arrTimer >= this.arr) { this.arrTimer -= this.arr; if (this.dir < 0) g.moveLeft(); else g.moveRight(); }
  };

  // Bind on-screen buttons: elements with data-act. Hold left/right for auto-shift.
  Input.prototype.bindButtons = function (container) {
    var self = this;
    var buttons = container.querySelectorAll('[data-act]');
    Array.prototype.forEach.call(buttons, function (btn) {
      var act = btn.getAttribute('data-act');
      var down = function (e) { e.preventDefault(); if (!self.enabled) return; btn.classList.add('is-down'); self.press(act); };
      var up = function (e) { e.preventDefault(); btn.classList.remove('is-down'); self.release(act); };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    });
  };

  // Swipe gestures on the board: drag sideways to move, tap to rotate, flick down to hard drop, drag down for soft drop.
  Input.prototype.bindSwipe = function (canvas) {
    var self = this, start = null, moved = 0, cellPx = 24, lastX = 0, softOn = false;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      start = { x: e.clientX, y: e.clientY, t: performance.now() }; lastX = e.clientX; moved = 0; softOn = false;
      cellPx = Math.max(16, canvas.clientWidth / 10);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!start || !self.enabled) return;
      var dx = e.clientX - lastX;
      while (Math.abs(dx) >= cellPx) { if (dx > 0) { self.game.moveRight(); dx -= cellPx; lastX += cellPx; } else { self.game.moveLeft(); dx += cellPx; lastX -= cellPx; } moved++; }
      var dy = e.clientY - start.y;
      if (dy > cellPx * 1.2 && !softOn) { softOn = true; self.game.setSoftDrop(true); moved++; }
      if (dy < cellPx * 0.6 && softOn) { softOn = false; self.game.setSoftDrop(false); }
    });
    var end = function (e) {
      if (!start) return;
      var dt = performance.now() - start.t, dy = e.clientY - start.y, dx = Math.abs(e.clientX - start.x);
      if (softOn) { self.game.setSoftDrop(false); softOn = false; }
      if (self.enabled) {
        if (dy > cellPx * 2.5 && dt < 260 && dx < cellPx * 1.5) self.game.hardDrop();
        else if (moved === 0 && dt < 250 && Math.abs(dy) < 12 && dx < 12) {
          var rect = canvas.getBoundingClientRect();
          if (e.clientX - rect.left < rect.width / 2) self.game.rotateCCW(); else self.game.rotateCW();
        }
      }
      start = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', function () { if (softOn) self.game.setSoftDrop(false); start = null; });
  };

  root.Input = Input;
  root.Input.KEYMAPS = KEYMAPS;
})(window);
