# Pull request: iPay88 payments with Boost, hardened

Follow-up branch `payments-followups` (stacked on this one) adds: Remark text from GAME_NAME, a final iPay88 status check before expiring an order that leaves the order pending if iPay88 cannot be reached, "Quad" wording in the game, and the rename to Linezu.

Branch `payments-ipay88-hardening` → `main`. Do not merge until the Render settings in "Before merging" are done.

## What this adds

- iPay88 (ADAPTIS) as the live payment provider. Boost, Touch 'n Go, GrabPay, ShopeePay, FPX online banking and cards are all methods of the iPay88 payment page. **Boost needs no code of its own: iPay88 switches it on for the merchant account and it appears on their page.** The game never talks to Boost directly.
- Items are granted only when all of these hold: the callback signature is valid, the order exists and is ours, the callback amount equals the stored price in exact cents, the currency is MYR, and iPay88's status API confirms the payment. The browser return page never grants anything.
- Exactly-once grant: a repeated callback for a paid order changes nothing and sends no second receipt.
- Failed, cancelled and expired payments give nothing and show a clear message in the game.
- A background job re-checks every order still pending after 15 minutes with iPay88's status API, so a lost callback still ends in the player getting the item. Orders pending for 2 hours expire.
- `PAYMENTS_ENABLED` safety switch, default off: Buy buttons are replaced with "Purchases open soon" and the server refuses to create orders.
- Mock can never run live: on Render (or `NODE_ENV=production`) the server refuses to start with `PAYMENT_PROVIDER=mock`. With no provider set it starts with purchases closed. `chip` and `ipay88` refuse to start without their keys.
- Every order stores the iPay88 transaction id, paid amount in cents, currency, status, timestamps and the last error, for matching against iPay88's settlement report.
- The game sends only the product type and id. The server sets the price from its own catalogue and ignores any price in the request.

## Files changed

- `server/payments.js`: iPay88 provider (signed request form, signature verification, status re-query), production guards, `none` provider, exact-cents amount parser.
- `server/api.js`: iPay88 start page, browser return and backend callback routes, amount and currency checks, idempotent grant, pending re-check job, `PAYMENTS_ENABLED` gate on orders.
- `server/db.js`: new order columns `paid_amount_cents`, `currency`, `last_error`, `last_checked_at` (added automatically on first start).
- `server/index.js`: `paymentsEnabled` in `/env.js`, startup messages.
- `js/api-backend.js`, `js/ui.js`: Buy buttons hidden while purchases are closed.
- `test/payments.test.js`: new. `test/server.test.js`: updated for the switch. `package.json`: `npm test` runs all four suites.
- `.env.example`, `render.yaml`, `DEPLOY.md`: variable names, go-live checklist, sandbox steps.

## Test results

`npm test` → engine, flows, server and payments suites all pass. The payments suite runs the real server against a fake iPay88 and covers: price tampering, successful payment, duplicate callback, bad signature, wrong amount, wrong currency, callback without status confirmation, failed payment, unknown order, pending order settled by the job, orders refused while the switch is off, and the three production start-up guards.

## Which iPay88 guide the module follows

There is no iPay88 document in this repository. The module is written from the iPay88 OPSG (Online Payment Switching Gateway) merchant integration specification as I know it: form POST to `ePayment/entry.asp` with MerchantCode, PaymentId, RefNo, Amount, Currency, ProdDesc, UserName, UserEmail, UserContact, Remark, Lang, SignatureType, Signature, ResponseURL, BackendURL; request signature SHA256 of MerchantKey + MerchantCode + RefNo + Amount without separators + Currency; response signature SHA256 of MerchantKey + MerchantCode + PaymentId + RefNo + Amount without separators + Currency + Status; re-query by POST to `ePayment/enquiry.asp` returning `00` for a successful payment; backend callback answered with the text `RECEIVEOK`. Please get the current guide from iPay88 and compare these points before the sandbox test. If the account uses the older SHA1 signing, set `IPAY88_SIG_ALGO=sha1`.

## Environment variables to set on Render (names only)

| Variable | Value to set |
|---|---|
| `PAYMENT_PROVIDER` | `ipay88` (or `none` to keep purchases closed) |
| `IPAY88_MERCHANT_CODE` | from iPay88 |
| `IPAY88_MERCHANT_KEY` | from iPay88's "MERCHANT KEY" email |
| `IPAY88_ENTRY_URL` | sandbox: `https://sandbox.ipay88.com.my/epayment/entry.asp`; remove for live |
| `IPAY88_REQUERY_URL` | sandbox: `https://sandbox.ipay88.com.my/epayment/enquiry.asp`; remove for live |
| `PAYMENTS_ENABLED` | `false` until the sandbox test passes |
| `BASE_URL` | `https://block-game-smoky.vercel.app` (already set) |
| `API_URL` | `https://block-game-api.onrender.com` (already set) |

Nothing is set on Vercel. No secret is in the front end or in the repository.

## Callback addresses to give iPay88

- Website to register on the merchant account: `https://block-game-smoky.vercel.app`
- ResponseURL (browser return): `https://block-game-smoky.vercel.app/api/payments/ipay88/response`
- BackendURL (server to server): `https://block-game-api.onrender.com/api/payments/ipay88/backend`

Both URLs are also sent with every payment request, so iPay88 does not need them pre-registered unless their portal asks.

## Before merging

1. On Render set `PAYMENT_PROVIDER=none` (or `ipay88` with sandbox keys). The current value `mock` will make the new server refuse to start.
2. Upgrade to the Starter plan and add the `/data` disk with `DB_PATH=/data/game.db`, per the go-live checklist in `DEPLOY.md`.

## Still unknown

- Whether iPay88 will register the game's address on M09765 or issue a second merchant code.
- Which payment methods are enabled on the account (Boost must be switched on by iPay88).
- Whether the account signs with SHA256 or SHA1, confirmed by the sandbox test.
