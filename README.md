# 🏏 Cricket Oracle

**The daily cricket prediction game.** One simple prediction every day — match winner, top scorer, or total runs. Lock your pick, build a streak, climb the leaderboard with friends, and share the bragging rights. Free to play, forever.

> Bragging rights are the prize. No real money involved.

## Why it works

- **Massive built-in audience.** Cricket in India = hundreds of millions of fans with daily live matches to predict against.
- **Daily habit loop.** One question a day (same for everyone), a 🔥 streak you don't want to break, and a "come back tomorrow" hook — the Wordle formula applied to cricket.
- **Viral by design.** Shareable emoji result cards + friend leaderboards + invite links drive organic growth.
- **Free-to-play economics.** Monetized through ads and brand sponsorships (sponsor strip + ad slots already wired into the layout), not player wallets.

## Run it

It's a single self-contained file — **just double-click `index.html`** and it opens in your browser. No build step, no server, no internet required.

Prefer a local server? (Optional — gives you a clean `http://localhost` URL.)

```bash
npm start          # serves on http://localhost:5173
```

## What's built (MVP)

| Feature | Status |
|---|---|
| Daily challenge (deterministic by date — everyone gets the same one) | ✅ |
| Three prediction types: winner / top scorer / total runs | ✅ |
| Lock-in mechanic (one pick, no takebacks) | ✅ |
| Streak tracking + best streak + hit rate | ✅ |
| Friends & global leaderboards (you climb as you score) | ✅ |
| Shareable emoji result card (Web Share / clipboard) | ✅ |
| Invite links | ✅ |
| Sponsor strip + ad slot (monetization placeholders) | ✅ |
| Countdown to next match | ✅ |
| First-run how-to-play onboarding | ✅ |
| Persistent progress (localStorage) | ✅ |

## Files

```
index.html          — MAIN build: mobile-first neobrutalist style
                      (cream + bold blocks, hard shadows, arcade type,
                      app-like bottom tab bar). Phone-optimised.
index-classic.html  — original "night pitch" dark-green theme, kept aside
logo.svg            — brand mark: a neobrutalist cricket-ball "oracle"
                      (also wired up as the favicon)
```

Both are single self-contained files (markup + styles + challenge bank +
game logic all inlined). Double-click either to play — no build, no server.

## Design — neobrutalist & phone-first

The main build is styled after a bold neobrutalist look (thick black borders,
hard `6px 6px` offset shadows, sharp corners, **Press Start 2P** + **Space
Mono** type, saffron/gold/indigo/green on cream). It is built **phone-first**,
since most of the Indian audience will play on mobile:

- App-shell layout capped at a phone width, centered on desktop
- A native-feeling **bottom tab bar** (Play · Ranks · Stats · Help)
- Big thumb-friendly tap targets (56px+) with satisfying press feedback
- Safe-area insets for notched phones

## Other editions

- [`goal-oracle/`](goal-oracle/) — the same game re-themed for the **FIFA World
  Cup 2026** (football): pitch-green palette, soccer-ball logo, World Cup nations
  & venues, and football question types (winner/draw, top scorer, total goals,
  both-teams-to-score). Self-contained — `npx serve goal-oracle -l 5174`.

## Backend (automation) — `server/`

The [`server/`](server/) folder is a runnable Node backend that **automates result
resolution**: it publishes the daily challenge, locks picks at match start, and a
scheduler auto-grades every player from real match results (no "reveal" button).
It runs offline with a built-in mock provider, and goes live by adding a
CricketData.org API key. See [server/README.md](server/README.md).

```bash
cd server && npm install && npm start   # API + scheduler on :3001
```

The front-end auto-connects: with the backend running it shows a **🟢 LIVE**
badge, submits picks to the server, and results resolve automatically (no Reveal
button). With no backend it shows **🟡 DEMO** and runs the self-contained
localStorage version. So `index.html` works both standalone and as the live app.

## From MVP → production

This MVP runs entirely client-side so it's instantly demoable. To ship for real:

1. **Backend + auth** — replace `localStorage` with user accounts (phone/Google login) so streaks and leaderboards are server-authoritative and friend graphs are real.
2. **Live cricket data feed** — resolve each day's `answer` automatically from a sports data API (winner, top scorer, totals) instead of the demo reveal button.
3. **Daily challenge scheduler** — an admin/cron job that publishes the day's match & question and locks picks at match start.
4. **Anti-cheat** — server-side pick locking with timestamps so picks can't be changed after the toss.
5. **Push notifications** — "Today's prediction is live" + "Your streak is about to expire" re-engagement nudges.
6. **Ad/sponsor integration** — wire the sponsor strip and ad slot to a real ad network + direct brand deals.

## License

MIT
