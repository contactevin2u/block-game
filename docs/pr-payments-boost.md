# Pull request: Boost Connect as the live payment provider

Branch `payments-boost` → `payments-followups`. Not merged, not deployed, no Render setting changed, no call to the real Boost.

## What it does

- New provider `PAYMENT_PROVIDER=boost`. The player taps Buy, picks Boost, Touch 'n Go, Online banking (FPX) or Card in our own picker, is sent to Boost's payment page, and comes back to the game's result page.
- Items are granted exactly once, only when the read-back `GET /v1/payments/refs/{referenceId}` says `succeeded` with the stored uuid, the exact amount in cents, currency MYR and not reversed. A succeeded payment where any detail disagrees becomes status REVIEW with the reason logged, no grant. canceled, cancelled, expired, failed, denied and error become failed, no grant.
- The callback is unsigned and the return page is the player's browser: both only trigger a read-back. Neither grants anything.
- Boost rules followed exactly: Basic auth over HMAC-SHA256 of METHOD + bare `/v1/...` path (never `/gateway`) + the exact body bytes; body serialised once and sent as signed; `created` 10 seconds in the past in ISO-8601 UTC with milliseconds; `description` limited to letters, digits, space, dot and hyphen, 60 characters; amount from the server's price as a JSON number with two decimals; `referenceId` = `LZ-<orderId>-<8 hex>`, a new one for every attempt, never retried; `returnUrl` on BASE_URL and `callbackUrl` on API_URL, both required to be https; reply checked for an https `paymentUrl` and a matching `referenceId` before the uuid is stored.
- Timing: pending orders re-read every 5 minutes; expired 45 minutes after creation (page life 15 minutes plus 30); expired orders re-read for 3 days and granted once on a late success.
- Kept: server-side prices, exact-cents checks, PAYMENTS_ENABLED default off, production start guards, Linezu name, iPay88 and mock code in place and unused. The server refuses to start with `PAYMENT_PROVIDER=boost` if any of the three BCPG variables is missing.

## Commits

See `git log payments-followups..payments-boost`. One commit: "Boost Connect provider: signed init, read-back only grants, REVIEW holds, expiry with late-success re-read, method picker, tests".

## Files changed

- `server/payments.js`: Boost provider (sign, call, initBody, createCheckout, verify), start guard, numeric amount parsing.
- `server/api.js`: method on order creation, `/api/payments/boost/callback`, `/api/payments/boost/return`, REVIEW handling in settle, expired re-read in the background job.
- `server/db.js`: `reference_id` column and index.
- `js/config.js`: `BOOST_METHODS`. `js/store.js`: method passed on order creation. `js/ui.js`: method picker screen, REVIEW and expired wording on the result page, route.
- `test/boost.test.js`: new, against a fake Boost. `package.json`: added to `npm test`.
- `.env.example`, `render.yaml`, `DEPLOY.md`: variable names and the Boost section.

## Test results

`npm test` runs engine, flows, demo UI, server, payments and boost suites. Five consecutive full runs: see the pull request comment with the run log.

Boost suite covers: signature for a fixed example; GET signed with an empty body; bare path signed (the fake rejects a `/gateway` signature); signed bytes equal sent bytes (the fake recomputes over the raw body); created 10 s in the past; start refused without the secret; orders refused with the switch off; a method required; price from the catalogue; fresh reference per attempt; an init 500 reported and not retried, next attempt gets a new reference; a callback alone grants nothing; success grants once; duplicate callbacks change nothing and send no second receipt; return page redirects to the result page; wrong amount, wrong uuid, wrong currency and reversed each become REVIEW with no grant and a logged reason; cancelled becomes failed; expired then late success granted once and only once.

## Environment variable names

`PAYMENT_PROVIDER` (`boost`), `BCPG_BASE_URL`, `BCPG_CLIENT_ID`, `BCPG_CLIENT_SECRET`, `PAYMENTS_ENABLED`, plus the existing `BASE_URL` and `API_URL`. Optional tuning: `PENDING_AGE_MS`, `RECHECK_INTERVAL_MS`, `PENDING_EXPIRE_MS`, `EXPIRED_RECHECK_MS`.

## URLs Boost will receive

- callbackUrl: `https://block-game-api.onrender.com/api/payments/boost/callback`
- returnUrl: `https://block-game-smoky.vercel.app/api/payments/boost/return?ref=LZ-...` (the game's address; Vercel forwards `/api` to Render, so the player's session cookie travels with it)

## Still unclear

- The callback body's field name for the reference. The handler accepts `referenceId`, `reference_id`, `ref` in the body or `?ref=` in the query; if Boost uses another name, the callback is a harmless no-op and the 5-minute re-read still settles the order.
- Whether Boost returns `amount` as a number or a string in the read-back. Both are accepted, in exact cents.
- Whether the read-back flags a reversal as `reversed: true` or another field. Only `reversed` is checked.
- The amount is sent as a JSON number with two decimals, as the rules say "ringgit with 2 decimals". If Boost expects a string, that is a one-line change.
