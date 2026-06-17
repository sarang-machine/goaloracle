# Handoff: swap the house-ad banner for a real AdSense ad

Context for a fresh session. The task: replace the placeholder "house ad" in the
Goal Oracle web app with a real Google AdSense ad unit.

## What this project is
**Goal Oracle** — a daily FIFA World Cup 2026 prediction game (neobrutalist,
mobile-first). Players predict upcoming matches, build streaks, climb a
leaderboard, add friends. Free-to-play; intended monetization = ads + sponsors.

- **Repo root:** `C:\Users\Sarang\appski1`
- **Deployed (live):** https://goal-oracle.onrender.com (Render, free tier)
- **One service:** the Node server in `server/` serves BOTH the API (`/api/*`)
  and the front-end (`goal-oracle/index.html`) on the same origin.
- **Front-end:** `goal-oracle/index.html` — a single self-contained file
  (inline CSS + JS). Edit it in place. (There's also a `goal-oracle/logo.svg`.)
- **Backend:** `server/src/*.js` (Express + node-cron). Real match data via
  football-data.org; accounts (Google sign-in in the UI; email-OTP exists in the
  backend); Postgres when `DATABASE_URL` is set; seed/house votes on polls.
- **Git:** active repo; commit per change. `git push` → Render auto-redeploys
  (~2 min). NOTE: confirm whether the latest commits are pushed — ask the user.
- **Secrets live in the Render dashboard**, never in git (`.env` is gitignored).
  Relevant env: `FOOTBALLDATA_KEY`, `GOOGLE_CLIENT_ID`, `ADMIN_TOKEN`,
  `AUTH_SECRET`, `DATABASE_URL`, `SEED_VOTES_BASE`, `BOARD_SIZE`.

## Where the ad goes
In `goal-oracle/index.html`, search for `id="adSlot"` (bottom of the
`#screen-play` section). It currently holds a house ad: a "Sponsor… your brand
here" line + an **Invite Friends** button (`#adInvite`, wired to `copyInvite()`).
A code comment right above it marks where the real ad unit goes.

To insert AdSense you need:
1. The loader script in `<head>` (once):
   `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXX" crossorigin="anonymous"></script>`
2. The unit where `#adSlot` is:
   `<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-XXXX" data-ad-slot="YYYY" data-ad-format="auto" data-full-width-responsive="true"></ins>`
   then `(adsbygoogle = window.adsbygoogle || []).push({});` (run after the element exists).
3. **Keep the house ad as a fallback** behind the `<ins>` (AdSense renders
   nothing when unfilled → would leave a blank box otherwise).

## ⚠️ Blockers to resolve BEFORE AdSense will work (flag these to the user)
1. **A custom domain you own.** AdSense generally will NOT approve a free
   `*.onrender.com` subdomain (you must own the site). The user currently has
   only the `goal-oracle.onrender.com` URL. → They likely must buy a domain
   (~$10/yr), point it at Render (custom domain, free on Render), and submit
   THAT to AdSense. Confirm domain ownership first; without it, AdSense is a
   dead end and a **directly-sold sponsor banner** is the better near-term path.
2. **A privacy policy page.** Required by AdSense (and genuinely needed — the app
   collects emails / Google profile on login). Doesn't exist yet. Add a simple
   `/privacy` page and link it in the footer.
3. **AdSense account + site review.** Sign up at adsense.com, add the site, paste
   the verification snippet, wait for approval (days). Approval needs real
   content + traffic; a brand-new low-traffic site can be rejected.
4. **Cookie/consent (regional).** AdSense personalized ads need a consent banner
   in some regions. The app currently has none.

## Front-end facts that matter for ads
- The page is self-contained with **inline** scripts. There is currently **no
  Content-Security-Policy**, so the external AdSense script will load fine. If
  one is ever added, it must allowlist `*.googlesyndication.com` /
  `*.googleadservices.com` / `*.doubleclick.net`.
- Ads only render over the real **https** origin, not when opening the file via
  `file://`. Test on the deployed URL (or the local server at
  `http://localhost:3001`).
- The layout is a phone-width column; use a responsive ad unit so it fits.

## Recommended near-term alternative (no AdSense needed)
Because of blocker #1, the fastest revenue is a **directly-sold sponsor banner**:
make `#adSlot` show a configurable image + click-through link (a sponsor pays the
user directly). No ad network, no approval, fits the "ads + sponsorships" model.
The existing ticker already rotates text sponsors as a precedent.

## Run / verify locally
```bash
cd server && npm install
node src/server.js          # serves API + front-end on http://localhost:3001
```
Front-end shows 🟢 LIVE when the backend is reachable; 🟡 DEMO standalone.

## Don't break
- Keep `goal-oracle/index.html` a single self-contained file.
- Escape any user/provider strings before inserting as HTML (there was a stored
  XSS fixed via an `esc()` helper — reuse it for any new dynamic content).
- The board (`/api/board`), picks, votes (incl. seed), and Google login must keep
  working. Verify in the browser preview after changes.
