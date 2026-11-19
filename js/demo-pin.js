/* Pretend wallet PIN for the demo checkout. Everything here stays in the browser: the PIN is compared locally,
   never sent, never stored, never logged. The accepted demo PIN is shown on screen on purpose. */
(function (root) {
  'use strict';
  var DEMO_PIN = '123456', LENGTH = 6;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // State machine: digits in, 'ok' or 'wrong' out. No side effects.
  function create() {
    var entered = '';
    return {
      length: LENGTH,
      press: function (d) { if (/^[0-9]$/.test(String(d)) && entered.length < LENGTH) entered += String(d); return entered.length; },
      backspace: function () { entered = entered.slice(0, -1); return entered.length; },
      clear: function () { entered = ''; return 0; },
      count: function () { return entered.length; },
      complete: function () { return entered.length === LENGTH; },
      // Compares and clears. The PIN value is never returned to callers.
      check: function () { var ok = entered === DEMO_PIN; entered = ''; return ok ? 'ok' : 'wrong'; }
    };
  }

  // Screens for the three steps. The game's own colours and components; no wallet logo or app design.
  function summaryHtml(order, money, banner) {
    return banner + '<h1>Pay with Boost (Demo)</h1>' +
      '<div class="card order"><div class="row"><span class="muted">Merchant</span><b>Linezu</b></div><div class="row"><span class="muted">Item</span><b>' + esc(order.item.name) + '</b></div><div class="row"><span class="muted">Amount</span><b>' + esc(money(order.item.price)) + '</b></div></div>' +
      '<div class="panel-actions"><button type="button" class="btn btn-primary" data-pin-continue>Continue to PIN</button><button type="button" class="btn btn-secondary" data-cancel>Cancel</button></div>';
  }
  function pinHtml(order, money, banner, message) {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
    return banner + '<h1>Enter your PIN</h1><p class="lead">Pay ' + esc(money(order.item.price)) + ' for ' + esc(order.item.name) + ' · Demo PIN: <b>123456</b></p>' +
      '<form class="pin" autocomplete="off" novalidate><label for="demo-pin" class="sr-only">PIN</label>' +
      '<input id="demo-pin" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="6-digit PIN">' +
      '<div class="pin-dots" aria-hidden="true">' + '<i></i>'.repeat(LENGTH) + '</div>' +
      '<p class="err pin-msg" aria-live="polite">' + esc(message || '') + '</p>' +
      '<div class="keypad">' + keys.map(function (k) { return k === '' ? '<span></span>' : '<button type="button" class="key' + (k === 'back' ? ' key-back' : '') + '" data-key="' + k + '" aria-label="' + (k === 'back' ? 'Delete' : k) + '">' + (k === 'back' ? '&#9003;' : k) + '</button>'; }).join('') + '</div>' +
      '<div class="panel-actions"><button type="button" class="btn btn-primary" data-pin-submit disabled>Pay ' + esc(money(order.item.price)) + '</button><button type="button" class="btn btn-secondary" data-cancel>Cancel</button></div></form>';
  }
  function processingHtml(banner) { return banner + '<div class="center pad"><div class="ring spin">&#8635;</div><h1>Processing</h1><p class="lead">Please wait</p></div>'; }
  function successHtml(banner, order, money) { return banner + '<div class="center pad"><div class="ring good">&#10003;</div><h1>Payment successful</h1><p class="lead">' + esc(money(order.item.price)) + ' for ' + esc(order.item.name) + '. Taking you back to the game.</p></div>'; }

  root.DemoPin = { create: create, summaryHtml: summaryHtml, pinHtml: pinHtml, processingHtml: processingHtml, successHtml: successHtml, LENGTH: LENGTH };
})(window);
