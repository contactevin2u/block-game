/* Visual themes. A theme is data; the renderer reads it. Nothing here touches game rules. */
(function (root) {
  'use strict';

  var THEMES = [
    { id: 'classic', name: 'Arcade Classic', tier: 'free',
      tagline: 'Guideline colours, bevelled blocks, chiptune.',
      bg: ['#0b1020', '#0b1020'], boardBg: '#0f1730', grid: 'rgba(255,255,255,.06)', frame: '#2b3a6b', text: '#e9edf8', accent: '#f2cf1d', garbage: '#5b647d',
      pieces: { I: '#1ec8e8', O: '#f5d020', T: '#a64ddb', S: '#5fd34a', Z: '#e8453c', J: '#3f63e8', L: '#f28c1e' },
      style: 'bevel', clear: 'flash', hudFont: "'Chakra Petch', sans-serif" },
    { id: 'lcd', name: 'Pocket LCD', tier: 'earn',
      tagline: 'Four shades of green. Pieces told apart by pattern.',
      bg: ['#9bbc0f', '#9bbc0f'], boardBg: '#9bbc0f', grid: 'rgba(15,56,15,.14)', frame: '#306230', text: '#0f380f', accent: '#0f380f', garbage: '#306230',
      pieces: { I: '#0f380f', O: '#0f380f', T: '#0f380f', S: '#0f380f', Z: '#0f380f', J: '#0f380f', L: '#0f380f' },
      lcdPattern: { I: 'solid', O: 'hollow', T: 'dot', S: 'hollow', Z: 'solid', J: 'dot', L: 'hollow', G: 'solid' }, lcdLight: '#8bac0f', lcdMid: '#306230',
      style: 'lcd', clear: 'blink', hudFont: "'Chakra Petch', monospace", light: true },
    { id: 'neon', name: 'Neon Grid', tier: 'paid',
      tagline: 'Synthwave arcade. Hollow blocks with glowing edges.',
      bg: ['#12061f', '#1d0b3a'], boardBg: 'rgba(0,0,0,.35)', grid: 'rgba(255,43,214,.14)', frame: '#ff2bd6', text: '#ffe9ff', accent: '#00f0ff', garbage: '#6b5a7a',
      pieces: { I: '#00f0ff', O: '#ffe600', T: '#ff2bd6', S: '#39ff88', Z: '#ff3b5c', J: '#3d7bff', L: '#ff8f1f' },
      style: 'neon', clear: 'glow', hudFont: "'Chakra Petch', sans-serif" },
    { id: 'paper', name: 'Ink and Paper', tier: 'paid',
      tagline: 'Hand-drawn blocks on warm paper.',
      bg: ['#f3ecdc', '#ebe2cf'], boardBg: '#fbf7ee', grid: 'rgba(60,50,40,.13)', frame: '#3a3028', text: '#2b241e', accent: '#c2503a', garbage: '#b9b0a0',
      pieces: { I: '#7fc4c9', O: '#f0cf6a', T: '#b792cf', S: '#9ec77d', Z: '#e38b7b', J: '#7f9bd1', L: '#f0a86a' },
      style: 'paper', clear: 'crumple', hudFont: "'Chakra Petch', sans-serif", light: true },
    { id: 'glass', name: 'Deep Glass', tier: 'paid',
      tagline: 'Translucent blocks over deep water.',
      bg: ['#061a2e', '#0b3350'], boardBg: 'rgba(255,255,255,.04)', grid: 'rgba(255,255,255,.07)', frame: 'rgba(255,255,255,.3)', text: '#e6f4ff', accent: '#7fdcff', garbage: '#5a7a90',
      pieces: { I: '#5fd8ff', O: '#ffd86b', T: '#c48bff', S: '#6fe6a8', Z: '#ff7b8f', J: '#6a9bff', L: '#ffa75f' },
      style: 'glass', clear: 'shatter', hudFont: "'Chakra Petch', sans-serif" },
    { id: 'ember', name: 'Ember Forge', tier: 'paid',
      tagline: 'Cooling iron and open flame.',
      bg: ['#140a06', '#2a1008'], boardBg: '#1c0d08', grid: 'rgba(255,120,40,.09)', frame: '#6b2a12', text: '#ffe3c8', accent: '#ff7a1a', garbage: '#4a3a32',
      pieces: { I: '#e8b33c', O: '#f3d57a', T: '#9b4f8c', S: '#7e9a3c', Z: '#cf3b2a', J: '#4f6a9a', L: '#e0712a' },
      style: 'ember', clear: 'burn', hudFont: "'Chakra Petch', sans-serif" }
  ];

  function byId(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return THEMES[0]; }

  function hex2rgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); var n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(h, a) { if (h[0] !== '#') return h; var c = hex2rgb(h); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function shade(h, amt) { if (h[0] !== '#') return h; var c = hex2rgb(h); function f(v) { return Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)); } return 'rgb(' + f(c[0]) + ',' + f(c[1]) + ',' + f(c[2]) + ')'; }
  function mix(h1, h2, t) { var a = hex2rgb(h1), b = hex2rgb(h2); function f(i) { return Math.round(a[i] + (b[i] - a[i]) * t); } return 'rgb(' + f(0) + ',' + f(1) + ',' + f(2) + ')'; }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  function colorFor(th, type) { return type === 'G' ? th.garbage : (th.pieces[type] || th.garbage); }

  function drawBlock(ctx, th, px, py, s, type, ghost) {
    var col = colorFor(th, type);
    if (ghost) {
      ctx.save();
      if (th.style === 'lcd') { ctx.strokeStyle = th.lcdMid; ctx.setLineDash([s * 0.15, s * 0.15]); }
      else ctx.strokeStyle = rgba(col, 0.55);
      ctx.lineWidth = Math.max(1, s * 0.1);
      ctx.strokeRect(px + s * 0.1, py + s * 0.1, s * 0.8, s * 0.8);
      ctx.restore();
      return;
    }
    var b = Math.max(1, Math.round(s * 0.16));
    switch (th.style) {
      case 'bevel':
        ctx.fillStyle = col; ctx.fillRect(px, py, s, s);
        ctx.fillStyle = type === 'G' ? shade(col, 0.2) : shade(col, 0.45); ctx.fillRect(px, py, s, b); ctx.fillRect(px, py, b, s);
        ctx.fillStyle = shade(col, -0.4); ctx.fillRect(px, py + s - b, s, b); ctx.fillRect(px + s - b, py, b, s);
        break;
      case 'neon':
        ctx.fillStyle = rgba(col, 0.16); ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
        ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = s * 0.5; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, s * 0.11);
        ctx.strokeRect(px + s * 0.14, py + s * 0.14, s * 0.72, s * 0.72); ctx.restore();
        break;
      case 'paper':
        rr(ctx, px + 1, py + 1, s - 2, s - 2, s * 0.2); ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = th.frame; ctx.lineWidth = Math.max(1, s * 0.1); ctx.stroke();
        break;
      case 'lcd':
        ctx.fillStyle = th.pieces.I; ctx.fillRect(px + 0.5, py + 0.5, s - 1, s - 1);
        var pat = th.lcdPattern[type] || 'solid', i1 = s * 0.22, i2 = s * 0.4;
        if (pat === 'hollow') { ctx.fillStyle = th.lcdLight; ctx.fillRect(px + i1, py + i1, s - 2 * i1, s - 2 * i1); }
        else if (pat === 'dot') { ctx.fillStyle = th.lcdLight; ctx.fillRect(px + i1, py + i1, s - 2 * i1, s - 2 * i1); ctx.fillStyle = th.pieces.I; ctx.fillRect(px + i2, py + i2, s - 2 * i2, s - 2 * i2); }
        break;
      case 'glass':
        rr(ctx, px + 0.8, py + 0.8, s - 1.6, s - 1.6, s * 0.22); ctx.fillStyle = rgba(col, 0.68); ctx.fill();
        var g = ctx.createLinearGradient(0, py, 0, py + s); g.addColorStop(0, 'rgba(255,255,255,.42)'); g.addColorStop(0.5, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 0.8; ctx.stroke();
        break;
      case 'ember':
        var eg = ctx.createLinearGradient(0, py, 0, py + s); eg.addColorStop(0, shade(col, 0.2)); eg.addColorStop(1, shade(col, -0.55));
        ctx.fillStyle = eg; ctx.fillRect(px + 0.5, py + 0.5, s - 1, s - 1);
        ctx.strokeStyle = shade(col, -0.7); ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
        break;
      default:
        ctx.fillStyle = col; ctx.fillRect(px, py, s, s);
    }
  }

  // Draw one cell of a clearing row at progress p (0..1).
  function drawClearingCell(ctx, th, px, py, s, type, col, p) {
    switch (th.clear) {
      case 'flash':
        if (p < 0.4) { drawBlock(ctx, th, px, py, s, type, false); ctx.fillStyle = 'rgba(255,255,255,' + (0.95 * (1 - p / 0.4)) + ')'; ctx.fillRect(px, py, s, s); }
        else if (Math.abs(col - 4.5) > (p - 0.4) / 0.6 * 5.2) drawBlock(ctx, th, px, py, s, type, false);
        break;
      case 'glow':
        if (p < 0.85) { drawBlock(ctx, th, px, py, s, type, false); ctx.save(); ctx.shadowColor = '#fff'; ctx.shadowBlur = s * 1.2 * Math.sin(p * Math.PI); ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * Math.sin(p * Math.PI)) + ')'; ctx.lineWidth = Math.max(1, s * 0.12); ctx.strokeRect(px + s * 0.14, py + s * 0.14, s * 0.72, s * 0.72); ctx.restore(); }
        break;
      case 'blink':
        if (Math.floor(p * 6) % 2 === 0) drawBlock(ctx, th, px, py, s, type, false);
        break;
      case 'crumple':
        ctx.save(); ctx.translate(px + s / 2, py + s / 2); ctx.rotate(p * 0.9 * (col % 2 ? 1 : -1)); var sc = Math.max(0.01, 1 - p); ctx.scale(sc, sc); ctx.globalAlpha = 1 - p * 0.6;
        drawBlock(ctx, th, -s / 2, -s / 2, s, type, false); ctx.restore();
        break;
      case 'burn':
        ctx.save(); ctx.globalAlpha = p < 0.45 ? 1 : Math.max(0, 1 - (p - 0.45) / 0.55);
        drawBlock(ctx, th, px, py, s, type, false);
        ctx.fillStyle = p < 0.45 ? rgba('#ff7a1a', p / 0.45 * 0.95) : mix('#ff7a1a', '#000000', (p - 0.45) / 0.55);
        ctx.fillRect(px + 0.5, py + 0.5, s - 1, s - 1); ctx.restore();
        break;
      case 'shatter':
        ctx.save(); ctx.globalAlpha = 1 - p;
        var c = colorFor(th, type), half = s / 2;
        for (var k = 0; k < 4; k++) {
          var ox = (k % 2) * half, oy = Math.floor(k / 2) * half;
          var vx = (col - 4.5) * s * 0.6 + (k % 2 ? s * 0.7 : -s * 0.7), vy = -s * 3 - (k * 7 % 5) * s * 0.5;
          ctx.fillStyle = rgba(c, 0.85);
          ctx.fillRect(px + ox + vx * p * 0.9, py + oy + vy * p * 0.9 + s * 11 * p * p, half - 0.5, half - 0.5);
        }
        ctx.restore();
        break;
      default:
        if (p < 0.5) drawBlock(ctx, th, px, py, s, type, false);
    }
  }

  root.Themes = { list: THEMES, byId: byId, drawBlock: drawBlock, drawClearingCell: drawClearingCell, rgba: rgba, shade: shade, colorFor: colorFor };
})(window);
