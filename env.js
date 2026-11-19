/* Front-end environment.
   - Served by server/index.js: the server replaces this file and the game talks to /api on the same site.
   - Hosted on Vercel (static): set apiBase to your Render server address so the game talks to it across sites.
   - apiBase empty and no server: browser-only test mode, everything stored in this browser. */
window.APP_ENV = {
  mode: 'auto',
  apiBase: 'https://block-game-api.onrender.com'   // the Render server (no trailing slash)
};
