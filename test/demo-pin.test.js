// Pretend wallet PIN: accepts 123456 only, clears after a wrong try, and never leaves the browser.
// Run: node test/demo-pin.test.js
var store = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.navigator = { userAgent: 'node-test' };
globalThis.document = { addEventListener: function () {}, readyState: 'complete', getElementById: function () { return null; }, documentElement: { setAttribute: function () {}, removeAttribute: function () {} } };
globalThis.location = { hash: '' };
globalThis.requestAnimationFrame = function () { return 0; };
globalThis.matchMedia = function () { return { matches: false }; };
var logged = [];
var origLog = console.log, origWarn = console.warn, origError = console.error;
console.log = function () { logged.push([].slice.call(arguments).join(' ')); origLog.apply(console, arguments); };
console.warn = function () { logged.push([].slice.call(arguments).join(' ')); };
console.error = function () { logged.push([].slice.call(arguments).join(' ')); };

window.APP_ENV = { mode: 'server', provider: 'mock', paymentsEnabled: true, demoMode: true };
['config', 'engine', 'bot', 'themes', 'renderer', 'input', 'backend', 'store', 'demo-pin', 'adventure', 'play', 'ui'].forEach(function (f) { require('../js/' + f + '.js'); });
var fails = 0;
function check(name, cond) { if (!cond) { fails++; origLog('FAIL ' + name); } else origLog('ok   ' + name); }
var D = window.DemoPin;

var pin = D.create();
check('starts empty', pin.count() === 0 && !pin.complete());
'123456'.split('').forEach(function (d) { pin.press(d); });
check('six digits complete the PIN', pin.complete());
pin.press('7');
check('a seventh digit is ignored', pin.count() === 6);
check('123456 is accepted', pin.check() === 'ok');
check('check clears the entry', pin.count() === 0);
'111111'.split('').forEach(function (d) { pin.press(d); });
check('a wrong PIN is rejected', pin.check() === 'wrong');
check('wrong try is cleared', pin.count() === 0);
'12a456'.split('').forEach(function (d) { pin.press(d); });
check('non-digits are ignored', pin.count() === 5);
pin.backspace(); pin.backspace();
check('backspace removes one digit at a time', pin.count() === 3);
pin.clear();
check('clear empties it', pin.count() === 0);
check('the PIN value is never exposed by the state object', Object.keys(pin).every(function (k) { return typeof pin[k] !== 'string'; }) && JSON.stringify(pin) === '{"length":6}');

var order = { id: 'ord_X', item: { name: 'Neon Grid', price: 12.99 } };
var money = function (n) { return 'RM ' + n.toFixed(2); };
var banner = '<div class="notice demo"><b>Demo: no real money is charged</b></div>';
var s1 = D.summaryHtml(order, money, banner), s2 = D.pinHtml(order, money, banner, 'Wrong PIN, try again'), s3 = D.processingHtml(banner), s4 = D.successHtml(banner, order, money);
check('summary shows merchant Linezu, item and amount', /Pay with Boost \(Demo\)/.test(s1) && /Linezu/.test(s1) && /Neon Grid/.test(s1) && /RM 12\.99/.test(s1));
check('PIN screen shows the demo PIN hint and a keypad', /Demo PIN: <b>123456<\/b>/.test(s2) && (s2.match(/data-key="/g) || []).length === 11 && /data-key="back"/.test(s2));
check('PIN field is password type with autocomplete off', /type="password"/.test(s2) && /autocomplete="off"/.test(s2) && /inputmode="numeric"/.test(s2));
check('wrong PIN message is shown', /Wrong PIN, try again/.test(s2));
check('every step keeps the demo label', [s1, s2, s3, s4].every(function (h) { return /Demo: no real money is charged/.test(h); }));
check('every interactive step has a Cancel button', /data-cancel/.test(s1) && /data-cancel/.test(s2));
check('no wallet logo or image is used', ![s1, s2, s3, s4].some(function (h) { return /<img|<svg|logo/i.test(h); }));

// The approve call sends only the order action, never a PIN, and nothing about the PIN was logged.
var sent = [];
window.Backend = Object.assign({}, window.Backend, { api: function (m, p, body) { sent.push({ m: m, p: p, body: body }); return Promise.resolve({ order: { id: 'ord_X', status: 'processing' } }); } });
delete require.cache[require.resolve('../js/store.js')];
require('../js/store.js');
window.Store.approve('ord_X').then(function () {
  check('approve sends only the order action to the server', sent.length === 1 && JSON.stringify(sent[0].body) === '{"action":"approve"}' && !/pin/i.test(JSON.stringify(sent[0])));
  check('nothing about the PIN was logged', !logged.some(function (l) { return /123456|pin/i.test(l); }));
  origLog(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
});
