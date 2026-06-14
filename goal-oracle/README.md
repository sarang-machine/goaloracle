# ⚽ Goal Oracle — World Cup 2026

The same daily-prediction game as Cricket Oracle, re-themed for the **FIFA World
Cup 2026**. One football prediction a day — match winner (or draw!), top scorer,
total goals, both-teams-to-score — build a streak, climb the leaderboard with
friends, share your results. Free to play.

## Run it

Single self-contained file — **just double-click `index.html`**, or serve it:

```bash
npx serve goal-oracle -l 5174     # then open http://localhost:5174
```

## What's different from the cricket version

Everything *structural* is identical (neobrutalist style, mobile-first layout,
bottom tab bar, streaks, leaderboard, share, LIVE/DEMO modes). Re-themed:

- **Brand & logo** — "Goal Oracle", a neobrutalist football mark (`logo.svg`)
- **Palette** — pitch-green primary, scoreboard-blue ticker, trophy-gold accent
- **Content** — World Cup 2026 nations, real host venues (MetLife, Azteca, SoFi…),
  group + knockout stages, and football question types including **draws** and
  **both-teams-to-score**
- **Isolated storage** — uses `go_*` localStorage keys so it never clashes with
  the cricket app when both are served from the same origin

## Modes

- **🟡 DEMO** (default) — fully self-contained, results via the demo Reveal button.
- **🟢 LIVE** — runs against the backend (defaults to `http://localhost:3002`;
  override with `localStorage.setItem("go_api","…")`). Start a football instance:
  ```bash
  cd ../server && npm install
  SPORT=football PORT=3002 npm start
  ```
  In LIVE mode results resolve automatically (no Reveal button), and you can
  **sign in by phone (OTP)** to save your streak/rank and **add friends** by
  invite code — the Friends leaderboard then shows your real graph. Swap the
  mock SMS/data providers for real ones (MSG91/Twilio, API-Football) to go fully
  live; the API contract is unchanged.

## Accounts & friends

- **Sign in** from the Stats tab (or "Sign In For Real Ranks" on the Ranks tab),
  two ways:
  - **Google** — real One Tap once you set a client ID (`localStorage.go_google_client_id`
    + `GOOGLE_CLIENT_ID` on the server); otherwise a working "Continue with Google" demo button.
  - **Phone → OTP** — in demo mode the code is shown for you.
- Once signed in, your **friend code** appears on the Ranks tab. Share your
  invite link (auto-friends new players) or add a friend by their code.
- Picks are then tied to your **verified account**, so streaks and the friends
  leaderboard are real and can't be faked. Without signing in you can still play
  anonymously on this device.

## Files

```
index.html   the whole app (markup + neobrutalist styles + World Cup data + logic)
logo.svg     football brand mark / favicon
```
