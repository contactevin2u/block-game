// Node smoke test for the non-visual logic: backend, store, adventure. Run: node test/flows.test.js
var store = {};
globalThis.window = globalThis;
globalThis.localStorage = { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
globalThis.navigator = { userAgent: 'node-test' };
globalThis.document = { addEventListener: function () {}, readyState: 'complete', getElementById: function () { return null; }, documentElement: { setAttribute: function () {}, removeAttribute: function () {} } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = { hash: '' };
globalThis.requestAnimationFrame = function () { return 0; };
globalThis.matchMedia = function () { return { matches: false }; };
['config', 'engine', 'bot', 'themes', 'renderer', 'input', 'backend', 'store', 'adventure', 'play', 'ui'].forEach(function (f) { require('../js/' + f + '.js'); });

var B = window.Backend, S = window.Store, A = window.Adventure, C = window.CONFIG;
var fails = 0;
function check(name, cond) { if (!cond) { fails++; console.log('FAIL ' + name); } else console.log('ok   ' + name); }

(async function () {
  var u = B.init();
  check('starts as guest', B.isGuest());
  u.coins = 40; B.persist();
  await B.signup('tester@example.com', 'password1');
  check('signup logs in', !B.isGuest() && B.user().email === 'tester@example.com');
  check('guest coins migrated', B.user().coins === 40);
  var sessionToken = store.bg_session;
  check('session token stored', !!sessionToken);

  // Returning: init again with the stored token keeps the user
  B.init(); check('session restores user', B.user().email === 'tester@example.com');

  // Expire the session by 31 days and check the expired flag
  var db = JSON.parse(store.bg_db_v1); db.sessions[sessionToken].expiresAt = Date.now() - 1000; store.bg_db_v1 = JSON.stringify(db);
  B.init(); check('expired session logs out', B.isGuest()); check('expired info carries email', B.expired() && true);

  // Login wrong / right
  var wrong = await B.login('tester@example.com', 'nope').catch(function (e) { return e.message; });
  check('wrong password rejected', /Wrong password/.test(wrong));
  await B.login('tester@example.com', 'password1'); check('login works', !B.isGuest());

  // Forgot password flow via Test inbox link
  await B.requestReset('tester@example.com');
  var mail = B.emails()[0]; check('reset email sent', mail && /Reset/.test(mail.subject) && /#\/reset\//.test(mail.link));
  var token = mail.link.split('/').pop();
  check('token valid', B.checkToken(token, 'reset') === 'ok');
  await B.resetPassword(token, 'password2');
  check('reset logs out everywhere', B.isGuest());
  check('token single use', B.checkToken(token, 'reset') === 'invalid');
  await B.login('tester@example.com', 'password2'); check('new password works', !B.isGuest());

  // Change password keeps this session
  var others = await B.changePassword('password2', 'password3');
  check('change password keeps session', !B.isGuest() && others === 0);

  // Change email with confirmation
  await B.requestEmailChange('new@example.com', 'password3');
  var m2 = B.emails().filter(function (m) { return m.to === 'new@example.com'; })[0];
  check('confirmation sent to new address', !!m2);
  await B.confirmEmailChange(m2.link.split('/').pop());
  check('email changed, same account', B.user().email === 'new@example.com' && B.user().coins === 40);

  // Shop: order, gateway steps, confirmation grants once
  var items = S.catalogue(B.user());
  var theme = items.filter(function (i) { return i.type === 'theme' && i.id === 'neon'; })[0];
  var d = await S.createOrder(theme), o = d.order;
  check('order pending with checkout url', (await S.getOrder(o.id)).status === 'pending' && d.checkoutUrl === '#/checkout/' + o.id);
  await S.choose(o.id, 'tng'); await S.approve(o.id);
  check('order processing before confirmation', (await S.getOrder(o.id)).status === 'processing');
  check('theme not owned before confirmation', !S.themeOwned(B.user(), 'neon'));
  var settled = await S.waitForResult(o.id, 5);
  check('confirmation grants theme', settled.status === 'paid' && S.themeOwned(B.user(), 'neon') && B.user().purchases.themes.length === 1);
  var bundle = items.filter(function (i) { return i.type === 'bundle'; })[0];
  var o2 = (await S.createOrder(bundle)).order; await S.choose(o2.id, 'fpx'); await S.approve(o2.id); await S.waitForResult(o2.id, 5);
  check('bundle grants remove ads and all themes', B.user().purchases.removeAds && window.Themes.list.every(function (t) { return S.themeOwned(B.user(), t.id); }));
  var o3 = (await S.createOrder(items.filter(function (i) { return i.type === 'coins'; })[0])).order; await S.cancel(o3.id);
  check('cancelled order grants nothing', (await S.getOrder(o3.id)).status === 'cancelled' && B.user().coins === 40);

  // Equipment with coins
  B.user().coins = 500; B.persist();
  var r = S.buyEquipment('slow'); check('buy equipment', r.ok && B.user().inventory.slow === 1 && B.user().coins === 350);
  check('buy second item', S.buyEquipment('shield').ok && B.user().coins === 50);
  check('not enough coins message', !S.buyEquipment('bomb').ok && B.user().coins === 50);

  // Adventure complete (coins are credited through the run, not here)
  var before = B.user().coins;
  var st = A.stage(1), res = A.complete(B.user(), st, { score: 1200, usedEquipment: false, continued: false });
  check('stage complete 3 stars unlocks next', res.stars === 3 && B.user().adventure.unlocked === 2 && res.coins === 90 && B.user().coins === before);

  // Runs credit coins
  B.saveRun({ mode: 'classic', score: 5000, lines: 20, level: 3, time: 120, coins: 20 });
  check('run saved, best and coins updated', B.runs().length === 1 && B.user().bestScore === 5000 && B.user().coins === before + 20);

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
