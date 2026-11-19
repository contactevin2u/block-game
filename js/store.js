/* Shop catalogue, orders and checkout. Every order function returns a Promise so the screens work the same
   against the browser-only backend (simulated gateway) and the real server (CHIP hosted checkout). */
(function (root) {
  'use strict';
  var C = root.CONFIG, B = root.Backend, T = root.Themes;
  var SERVER = !!B.api;

  function money(n) { return C.CURRENCY + ' ' + n.toFixed(2); }
  function uid() { return 'ord_' + Math.random().toString(36).slice(2, 8).toUpperCase(); }

  function themeOwned(user, id) {
    var th = T.byId(id);
    if (th.tier === 'free') return true;
    if (user.purchases.themes.indexOf(id) >= 0) return true;
    if (id === 'lcd' && (user.bestLevel || 1) >= C.LCD_UNLOCK_LEVEL) return true;
    return false;
  }

  function catalogue(user) {
    var items = [];
    items.push({ type: 'removeAds', id: 'removeAds', name: 'Remove Ads', price: C.PRICES.removeAds, owned: user.purchases.removeAds, desc: 'No ad breaks. Continue once per run with no wait.' });
    T.list.forEach(function (th) {
      if (th.tier === 'free') return;
      items.push({ type: 'theme', id: th.id, name: th.name, price: C.PRICES.themes[th.id], owned: themeOwned(user, th.id), desc: th.tagline, earn: th.id === 'lcd' ? 'Free at level ' + C.LCD_UNLOCK_LEVEL : null });
    });
    var allOwned = user.purchases.removeAds && T.list.every(function (th) { return themeOwned(user, th.id); });
    items.push({ type: 'bundle', id: 'bundle', name: 'Everything bundle', price: C.PRICES.bundle, owned: allOwned, desc: 'All five themes plus Remove Ads. Worth ' + money(C.PRICES.removeAds + Object.keys(C.PRICES.themes).reduce(function (s, k) { return s + C.PRICES.themes[k]; }, 0)) + ' separately.' });
    C.PRICES.coins.forEach(function (p) { items.push({ type: 'coins', id: p.id, name: p.coins.toLocaleString() + ' coins', price: p.price, owned: false, desc: p.label + (p.bonus ? ' · ' + p.bonus + ' bonus' : ''), coins: p.coins }); });
    return items;
  }

  // ---- browser-only simulated gateway -----------------------------------------------
  function grantLocal(user, item) {
    if (item.type === 'removeAds') user.purchases.removeAds = true;
    else if (item.type === 'theme') { if (user.purchases.themes.indexOf(item.id) < 0) user.purchases.themes.push(item.id); }
    else if (item.type === 'bundle') { user.purchases.removeAds = true; T.list.forEach(function (th) { if (th.tier !== 'free' && user.purchases.themes.indexOf(th.id) < 0) user.purchases.themes.push(th.id); }); }
    else if (item.type === 'coins') user.coins += item.coins;
    B.persist();
  }
  function localOrder(id) { var o = B.orders()[id]; if (o && o.status === 'pending' && o.expiresAt < Date.now()) { o.status = 'expired'; B.saveOrder(o); } return o || null; }
  function localGrant(id) {
    var o = localOrder(id); if (!o) return null;
    if (o.status === 'processing') { o.status = 'paid'; o.paidAt = Date.now(); var u = B.user(); if (u.id === o.userId) grantLocal(u, o.item); B.saveOrder(o); }
    return o;
  }

  var Store = {
    money: money,
    themeOwned: themeOwned,
    catalogue: catalogue,
    isServer: SERVER,

    // -> Promise<{ order, checkoutUrl }>
    createOrder: function (item) {
      if (SERVER) return B.api('POST', '/orders', { type: item.type, id: item.id });
      var u = B.user();
      var o = { id: uid(), userId: u.id, item: { type: item.type, id: item.id, name: item.name, price: item.price, coins: item.coins || 0 }, status: 'pending', method: null, createdAt: Date.now(), expiresAt: Date.now() + 30 * 60000 };
      B.saveOrder(o);
      return Promise.resolve({ order: o, checkoutUrl: '#/checkout/' + o.id });
    },
    // -> Promise<order|null>. On the server this also re-verifies pending orders with the gateway.
    getOrder: function (id) {
      if (SERVER) return B.api('GET', '/orders/' + encodeURIComponent(id)).then(function (d) { var u = B.user(); if (d.user && !u.guest) { u.purchases = d.user.purchases; u.coins = d.user.coins; } return d.order; }).catch(function () { return null; });
      return Promise.resolve(localOrder(id));
    },
    // Simulated gateway steps (mock provider only).
    choose: function (id, method) {
      if (SERVER) return B.api('POST', '/orders/' + id + '/mock', { action: 'choose', method: method }).then(function (d) { return d.order; });
      var o = localOrder(id); if (o && o.status === 'pending') { o.method = method; o.status = 'authorizing'; B.saveOrder(o); } return Promise.resolve(o);
    },
    approve: function (id) {
      if (SERVER) return B.api('POST', '/orders/' + id + '/mock', { action: 'approve' }).then(function (d) { return d.order; });
      var o = localOrder(id); if (o && o.status === 'authorizing') { o.status = 'processing'; B.saveOrder(o); setTimeout(function () { localGrant(id); }, 1500); } return Promise.resolve(o);
    },
    cancel: function (id) {
      if (SERVER) return B.api('POST', '/orders/' + id + '/mock', { action: 'cancel' }).then(function (d) { return d.order; }).catch(function () { return null; });
      var o = localOrder(id); if (o && (o.status === 'pending' || o.status === 'authorizing')) { o.status = 'cancelled'; B.saveOrder(o); } return Promise.resolve(o);
    },
    // Poll until the order settles. Resolves with the final order (or the last seen one after the timeout).
    waitForResult: function (id, tries) {
      var self = this, n = tries || 20;
      return new Promise(function (resolve) {
        (function tick(left) {
          self.getOrder(id).then(function (o) {
            if (!o) return resolve(null);
            if (['paid', 'failed', 'cancelled', 'expired'].indexOf(o.status) >= 0 || left <= 0) return resolve(o);
            setTimeout(function () { tick(left - 1); }, 1500);
          });
        })(n);
      });
    },

    buyEquipment: function (id) {
      var u = B.user(), eq = C.EQUIPMENT.filter(function (e) { return e.id === id; })[0];
      if (!eq) return { ok: false, error: 'Unknown item.' };
      if (u.coins < eq.cost) return { ok: false, error: 'Not enough coins. You have ' + u.coins + ', this costs ' + eq.cost + '.' };
      u.coins -= eq.cost; u.inventory[id] = (u.inventory[id] || 0) + 1; B.persist();
      return { ok: true };
    },
    useEquipment: function (id) {
      var u = B.user();
      if (!u.inventory[id]) return false;
      u.inventory[id]--; B.persist(); return true;
    }
  };

  root.Store = Store;
})(window);
