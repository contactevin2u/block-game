# Going live with GitHub, Render and Vercel

- **GitHub** keeps the code. Render and Vercel deploy from it automatically on every push.
- **Render** runs the server: accounts, database, emails, payments.
- **Vercel** serves the game files to players.

Two layouts are possible. Read the box before choosing.

> **Important for iPhone players.** When the game is on `something.vercel.app` and the server on `something.onrender.com`, the login cookie is a cross-site cookie. Safari on iPhone and iPad blocks those, so players on Apple devices could not stay logged in. The fix is one custom domain for both, for example `play.yourgame.com` on Vercel and `api.yourgame.com` on Render. Cookies between those two count as same-site and work everywhere.
>
> So: **Layout A** (Render serves everything, Vercel not needed) works with no domain at all. **Layout B** (Vercel + Render) needs a custom domain before real players use it. You can start with A today and move to B when the domain is ready; the code supports both.

Accounts you must create yourself, because they need your identity or a card: GitHub (free), Render (free tier exists, paid tier recommended, about USD 7 a month), Vercel (free), a domain registrar (about RM 50 a year), Resend for email (free tier), CHIP for payments (free to open, fees per transaction).

## 1. Push the code to GitHub

The folder is already a Git repository with one commit. On GitHub, click New repository, name it `block-game`, keep it empty (no README), create it. Then in a terminal in `C:\Users\HP\tetris-game`:

```
git remote add origin https://github.com/YOUR_USERNAME/block-game.git
git push -u origin main
```

Git asks you to sign in to GitHub in the browser the first time. After this, every change is `git add -A`, `git commit -m "what changed"`, `git push`, and both hosts redeploy.

## 2. Render: the server

1. On Render, click New, then Blueprint, and pick the `block-game` repository. Render reads `render.yaml` and proposes one web service with a 1 GB disk at `/data`. Approve it.
2. It asks for the blank values. For now:
   - `BASE_URL`: leave blank until step 3 or 4 tells you the address, then fill it in.
   - `API_URL`: same.
   - `CORS_ORIGIN`: blank for Layout A. For Layout B, your Vercel address.
   - Email and payment keys: blank for now. The server starts in simulated mode.
3. Deploy. Render gives an address like `https://block-game-api.onrender.com`. Open it: the game loads from Render itself (Layout A works immediately).
4. Go to Environment, set `BASE_URL` and `API_URL` to that address, save. Render redeploys.
5. Check `https://block-game-api.onrender.com/api/health` shows `{"ok":true,...}`.

The free tier sleeps after 15 minutes without visitors and takes about 30 seconds to wake, which players notice. The Starter plan stays awake. The disk is required on either plan, or every deploy wipes the accounts.

## 3. Vercel: the game files (Layout B)

1. Edit `env.js` in the repository: set `apiBase` to your Render address, for example `apiBase: 'https://block-game-api.onrender.com'`. Commit and push.
2. On Vercel, Add New Project, import `block-game`. Framework preset: Other. Build command: empty. Output directory: `.` (the root). Deploy. `.vercelignore` keeps the server code out of the upload.
3. Vercel gives `https://block-game.vercel.app`. On Render, set `CORS_ORIGIN=https://block-game.vercel.app` and `BASE_URL=https://block-game.vercel.app`, keep `API_URL` as the Render address. Save.
4. Open the Vercel address on a PC and create an account. It works. On an iPhone it will not stay logged in until step 4 is done.

## 4. Custom domain (needed for Layout B, nice for Layout A)

1. Buy `yourgame.com`.
2. Vercel: project Settings, Domains, add `play.yourgame.com`. Add the CNAME it shows at your registrar.
3. Render: service Settings, Custom Domains, add `api.yourgame.com`. Add the CNAME it shows.
4. Update environment on Render: `BASE_URL=https://play.yourgame.com`, `API_URL=https://api.yourgame.com`, `CORS_ORIGIN=https://play.yourgame.com`, and `COOKIE_DOMAIN=.yourgame.com`.
5. Update `env.js` to `apiBase: 'https://api.yourgame.com'`, push.
6. Test on an iPhone: create an account, close Safari, reopen. Still logged in.

For Layout A with a domain, just add `play.yourgame.com` on Render and set `BASE_URL` and `API_URL` to it.

## 5a. Real email with Brevo (no domain needed)

1. Create a free account at brevo.com. Go to Senders, add your own email address as a sender, and click the verification link Brevo emails you.
2. Go to SMTP and API, then API Keys, create a key, copy it.
3. On Render set `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY=xkeysib-...`, `EMAIL_FROM=Block Game <you@example.com>` using the exact address you verified.
4. Test: Forgot password. The email arrives in the player's real inbox.

Free plan: 300 emails a day, which covers thousands of players. Later, verifying a domain in Brevo improves deliverability.

## 5b. Real email with Resend (needs a domain)

1. Create a Resend account, add your domain, add the three DNS records it shows (SPF, DKIM, DMARC) at your registrar, wait for the green tick.
2. Create an API key.
3. On Render set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=re_...`, `EMAIL_FROM=Block Game <noreply@yourgame.com>`. The From address must be on the verified domain.
4. Test: Forgot password. The email arrives in your real inbox within seconds.

Without a domain, Resend can only send to your own email address, which is fine for testing.

## 6. Real payments with CHIP

1. Register at chip-in.asia as a merchant. Verification takes a few days.
2. In the portal: create a Brand, copy the Brand ID. Create an API key, copy the Secret key. Enable FPX, DuitNow QR, Touch 'n Go eWallet, cards, and Apple Pay on the brand.
3. On Render set `PAYMENT_PROVIDER=chip`, `CHIP_BRAND_ID=...`, `CHIP_SECRET_KEY=...`. Make sure `BASE_URL` (where the player returns) and `API_URL` (where CHIP calls back) are correct.
4. CHIP provides test keys first. Make a RM 1 test purchase: the player is sent to CHIP's page, pays, returns to the game, sees Payment received, and the item shows as Owned. Then switch to live keys.

How it is secured: the server creates the order and asks CHIP for the checkout page. After payment CHIP calls `/api/payments/chip/callback`. The server does not trust that call; it asks CHIP's API for the purchase status and only then grants the item and emails the receipt. If the callback is lost, the return page keeps asking the server, which asks CHIP, so the player still receives the item.

The request fields in `server/payments.js` follow CHIP's Purchases API. When your account is approved, compare them once with the current documentation.

## 7. Final checks

- `/api/health` on the Render address returns `provider: "chip"` and `email: "resend"`.
- Create an account on a phone and a PC. Welcome email arrives.
- Forgot password link works and logs out other devices.
- One real purchase of the cheapest item. Receipt email arrives. Item shows as Owned after a reload on another device.
- Back up `/data/game.db` from the Render disk weekly (Render shell: Disk tab). Losing it loses every account and purchase.

## Changing the name

`js/config.js` `GAME_NAME`, `<title>` in `index.html`, and `GAME_NAME` on Render. Do not use "Tetris" in the name or branding without a licence from The Tetris Company.
