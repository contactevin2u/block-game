/* Boot. */
(function () {
  'use strict';
  function start() { window.UI.init(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
