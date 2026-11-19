# Blokzu

Browser block-stacking game with Guideline rules: SRS rotation, 7-bag, hold, ghost, lock delay, T-spins, back-to-back, combos, perfect clears. Classic, Adventure with equipment, Battle against the computer, local 2-player, six themes, accounts, shop, history.

## Two ways to run it

**Browser only** (no server, everything stored in the browser, payments and emails simulated): open `index.html`.

**With the server** (real accounts in a database, real email and payments when configured):

```
copy .env.example .env
npm start
```

Open http://localhost:3000. Out of the box the server uses simulated payments (`PAYMENT_PROVIDER=mock`) and prints emails to the console and the in-game Test inbox (`EMAIL_PROVIDER=console`). See `DEPLOY.md` to switch on Resend and CHIP and put it on the internet.

## Tests

```
npm test                    # engine + browser flows
node test/server.test.js    # starts the real server and runs the API end to end
```

## Music

`music/` holds the background songs, listed in `js/config.js` under `MUSIC`. The two included tracks, Easy Lemon and Dreamy Flashback, are by Kevin MacLeod (incompetech.com) under Creative Commons Attribution 4.0, so the credit shown in Settings must stay while they are used. To use your own song, drop an MP3 in `music/`, add it to the list, and remove the ones you no longer want.

## Change the name

`js/config.js` → `GAME_NAME`, and `<title>` in `index.html`. Or set `GAME_NAME` in `.env` and the server passes it to the game.

## Files

- `index.html`, `css/app.css` shell
- `env.js` tells the game whether a server is present (the server overrides it)
- `js/engine.js` game rules, no DOM
- `js/bot.js` computer opponent
- `js/themes.js` the 6 visual themes and block drawing
- `js/renderer.js` canvas rendering
- `js/input.js` keyboard (DAS/ARR), touch buttons, swipe
- `js/backend.js` browser-only backend (localStorage)
- `js/api-backend.js` same interface against the server API
- `js/store.js` shop, orders, checkout
- `js/adventure.js` stages, stars, rewards
- `js/play.js` the game screen for all modes
- `js/ui.js` every other screen and the router
- `server/index.js` web server, `server/api.js` REST API, `server/db.js` SQLite, `server/auth.js` passwords and sessions, `server/email.js` Resend or console, `server/payments.js` CHIP or mock
