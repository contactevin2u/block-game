/* WebSocket client for online battle. Gets a short-lived token from the API, connects, reconnects on drops. */
(function (root) {
  'use strict';
  var B = root.Backend, env = root.APP_ENV || {};
  var ws = null, handlers = {}, wsUrl = null, guestKey = null, closedByUs = false, retry = 0, queueMsgs = [];

  function emit(t, m) { (handlers[t] || []).forEach(function (f) { try { f(m); } catch (e) { console.error(e); } }); (handlers['*'] || []).forEach(function (f) { f(m); }); }

  var Net = {
    available: function () { return !!(B && B.api); },
    on: function (t, f) { (handlers[t] = handlers[t] || []).push(f); return function () { handlers[t] = (handlers[t] || []).filter(function (x) { return x !== f; }); }; },
    off: function (t) { if (t) delete handlers[t]; else handlers = {}; },
    connected: function () { return !!(ws && ws.readyState === 1); },
    connect: function () {
      if (!this.available()) return Promise.reject(new Error('Online play needs the game server.'));
      if (this.connected()) return Promise.resolve();
      closedByUs = false;
      return B.api('POST', '/ws-token', {}).then(function (d) {
        wsUrl = d.wsUrl; guestKey = guestKey || (function () { try { return localStorage.getItem('bg_guest_ws'); } catch (e) { return null; } })();
        return new Promise(function (resolve, reject) {
          var u = wsUrl + '?token=' + encodeURIComponent(d.token) + (guestKey ? '&guest=' + encodeURIComponent(guestKey) : '');
          var s = new WebSocket(u);
          var opened = false;
          s.onopen = function () { opened = true; retry = 0; ws = s; queueMsgs.splice(0).forEach(function (m) { s.send(JSON.stringify(m)); }); emit('open', {}); resolve(); };
          s.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.t === 'hello' && m.guestKey) { guestKey = m.guestKey; try { localStorage.setItem('bg_guest_ws', guestKey); } catch (e) {} } emit(m.t, m); };
          s.onclose = function () { if (ws === s) ws = null; emit('close', {}); if (!opened) reject(new Error('Could not reach the match server.')); else if (!closedByUs && retry < 6) { retry++; setTimeout(function () { Net.connect().catch(function () {}); }, 800 * retry); } };
          s.onerror = function () {};
        });
      });
    },
    send: function (m) { if (this.connected()) ws.send(JSON.stringify(m)); else queueMsgs.push(m); },
    close: function () { closedByUs = true; queueMsgs = []; if (ws) { try { ws.close(); } catch (e) {} ws = null; } }
  };
  root.Net = Net;
})(window);
