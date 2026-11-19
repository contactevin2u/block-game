/* Front-end environment.
   - mode 'server' with an empty apiBase: the game talks to /api on the same website. On Vercel, vercel.json forwards
     /api to the Render server, so login cookies stay first-party and work on iPhone and iPad. Served by server/index.js
     directly, the server replaces this file with the same setting.
   - apiBase set to a full address: the game talks to that server across sites (needs CORS_ORIGIN on the server and a
     shared custom domain for Safari).
   - mode 'local': browser-only test mode, everything stored in this browser (see env.local.js). */
window.APP_ENV = {
  mode: 'server',
  apiBase: ''
};
