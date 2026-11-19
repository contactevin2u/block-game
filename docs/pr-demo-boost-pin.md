# Pull request: pretend PIN step for the demo Boost payment

Branch `demo-boost-pin` → `payments-boost`. Demo checkout only (`PAYMENT_PROVIDER=mock`). Not merged, not deployed.

## What players see

1. In the demo checkout the first method is **Boost**. Picking it opens "Pay with Boost (Demo)" with merchant Linezu, the item and the amount, plus Continue to PIN and Cancel.
2. **PIN step**: six dots, a number keypad with delete, the hint "Demo PIN: 123456", and a Pay button that enables at six digits. Only 123456 is accepted; anything else shows "Wrong PIN, try again" and clears. A keyboard works too through a hidden password-type field with autocomplete off, so browsers never offer to save it.
3. Correct PIN: "Processing" for 2 seconds, then "Payment successful", then back to the game's result page with the item given. This uses the same approve call the mock checkout already used.
4. Cancel on every step: the order is cancelled, nothing is charged, nothing is given.
5. The PIN never leaves the browser: it is compared in `js/demo-pin.js`, never sent, never stored, never logged, and the state object never exposes it.
6. The "Demo: no real money is charged" label is on every step. Game colours and components only; no wallet logo or app design.

## Files

- `js/demo-pin.js`: new, the PIN state machine and the four step screens.
- `js/ui.js`: the Boost branch of the demo checkout; banner wording now says "real card numbers, real PINs".
- `js/config.js`: Boost added to the demo method list. `css/app.css`: dots and keypad. `index.html`, `artifact.html`: script tag.
- `test/demo-pin.test.js`: new. `test/demo-ui.test.js`: method list updated. `package.json`: added to `npm test`.

## Tests

`demo-pin.test.js`: accepts 123456 only, rejects and clears a wrong PIN, ignores non-digits and a seventh digit, backspace, clear, the state object exposes no PIN value, the four screens carry the demo label, the hint, the keypad, a Cancel on each interactive step, the password-type field with autocomplete off, no image or logo, the approve call sends only the order action, and nothing PIN-like was logged. Full suite result in the pull request comment.
