// The demo banner must show on the shop and checkout screens whenever payments are a demo. Run: node test/demo-ui.test.js
var store = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.navigator = { userAgent: 'node-test' };
globalThis.document = { addEventListener: function () {}, readyState: 'complete', getElementById: function () { return null; }, documentElement: { setAttribute: function () {}, removeAttribute: function () {} } };
globalThis.location = { hash: '' };
globalThis.requestAnimationFrame = function () { return 0; };
globalThis.matchMedia = function () { return { matches: false }; };
window.APP_ENV = { mode: 'server', provider: 'mock', paymentsEnabled: true, demoMode: true };
['config', 'engine', 'bot', 'themes', 'renderer', 'input', 'backend', 'store', 'adventure', 'play', 'ui'].forEach(function (f) { require('../js/' + f + '.js'); });
var fails = 0;
function check(name, cond) { if (!cond) { fails++; console.log('FAIL ' + name); } else console.log('ok   ' + name); }
var screens = window.UI.screens;
window.Backend.init();

var shop = screens.shop(['themes']);
check('shop shows the demo banner', /Demo: no real money is charged/.test(shop));
check('shop banner explains nothing real is collected', /real card numbers, real PINs or phone numbers/.test(shop));
check('shop offers Buy buttons in demo mode', /data-buy="theme:neon"/.test(shop));
var coins = screens.shop(['coins']);
check('coins tab shows the banner too', /Demo: no real money is charged/.test(coins));

var methods = window.CONFIG.PAYMENT_METHODS.map(function (m) { return m.name; }).join('|');
check('checkout methods: the demo Boost wallet plus plain names', methods === 'Boost|E-wallet|Online banking|Card');
check('no other bank, wallet or card brand names in the method list', !/Touch|Grab|Shopee|FPX|DuitNow|Maybank|Apple|Visa|Master/i.test(JSON.stringify(window.CONFIG.PAYMENT_METHODS)));

// Not a demo: no banner.
window.APP_ENV = { mode: 'server', provider: 'ipay88', paymentsEnabled: true, demoMode: false };
check('no demo banner with a real provider', !/Demo: no real money/.test(screens.shop(['themes'])));

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
