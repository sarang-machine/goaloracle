# 🏏 Cricket Oracle — Backend

This is the automation layer. It publishes the daily challenge, **locks picks at
match start**, and after the match **auto-grades every player from real results**
— no manual "reveal" button anywhere.

It runs immediately with a built-in **mock** result provider (zero setup), and
goes live by adding a real cricket-data API key.

## Quick start (mock — works offline, no keys)

```bash
cd server
npm install
cp .env.example .env          # optional; defaults are fine for mock

# Watch the whole automatic loop in ~1.5 minutes:
npm start                     # API on http://localhost:3001, scheduler running
```

In another terminal, drive it:

```bash
# publish a fast match (locks in 3s, resolves in 5s)
curl -X POST localhost:3001/api/admin/publish -H "X-Admin-Token: dev-secret-change-me" \
  -H "Content-Type: application/json" \
  -d "{\"lockTime\":\"$(node -e 'console.log(new Date(Date.now()+3000).toISOString())')\",\"resultTime\":\"$(node -e 'console.log(new Date(Date.now()+5000).toISOString())')\"}"

# make a pick
curl -X POST localhost:3001/api/pick -H "Content-Type: application/json" \
  -d '{"userId":"phone_99","name":"Siva","option":"Mumbai Indians"}'

# ...wait ~5s. The scheduler resolves it automatically. Then:
curl localhost:3001/api/me/phone_99        # streak + score updated, no manual step
curl localhost:3001/api/leaderboard
```

> Tip: the default seed times (30s / 90s) and `RESOLVE_CRON=*/5 * * * *` are for
> demos. For a fast loop, run the server with `RESOLVE_CRON="*/2 * * * * *"`.

## How the automation works

```
publish ──► open ──(lockTime: toss)──► locked ──(resultTime: match ends)──► resolved
   ▲                    ▲                              │
admin/cron        picks rejected                 scheduler polls the data
publishes         after this                     provider, grades all picks,
the fixture                                      updates streaks + leaderboard
```

- **Locking is server-authoritative.** `POST /api/pick` returns `409` once
  `lockTime` has passed — nobody can change a pick after seeing how the match
  is going.
- **Resolution is scheduled.** `node-cron` calls `resolveDue()` on
  `RESOLVE_CRON`. Each tick it finds matches past their `resultTime`, asks the
  data provider for the result, and grades everyone. `resolveDay()` is
  idempotent, so retries are safe.

## Go live with real results

1. Get a free API key at **https://cricketdata.org** (cricapi.com).
2. In `.env`:
   ```
   PROVIDER=cricapi
   CRICAPI_KEY=your_key_here
   ADMIN_TOKEN=<a long random string>
   ```
3. Publish with the **real fixture id** so the resolver knows what to look up:
   ```bash
   curl -X POST localhost:3001/api/admin/publish -H "X-Admin-Token: $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"apiMatchId":"<cricapi-match-id>","lockTime":"<toss ISO>","resultTime":"<approx end ISO>"}'
   ```

Two real adapters ship in `src/providers.js` (swapping in another is just one
more object with the same `getResult()` shape):

- **`footballdata`** — [football-data.org](https://football-data.org) (free tier
  covers the FIFA World Cup). Resolves winner / draw / total goals /
  both-teams-to-score from the final score, and returns `null` until the match is
  `FINISHED` so the scheduler retries. Set `PROVIDER=footballdata` +
  `FOOTBALLDATA_KEY`, and publish each challenge with `apiMatchId` = the
  football-data match id.
- **`cricapi`** — CricketData.org for the cricket app.

Example — publish a World Cup match wired to real data:
```bash
curl -X POST $URL/api/admin/publish -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"apiMatchId":"<football-data-match-id>","lockTime":"<kickoff ISO>","resultTime":"<approx end ISO>"}'
```

## Deploy the scheduler (pick one)

- **Always-on server** — `npm start` on Render/Railway/Fly/a VPS. The in-process
  cron handles everything.
- **Vercel Cron** — deploy the API as serverless functions; [`vercel.json`](vercel.json)
  pings `/api/admin/resolve` on a schedule (add `ADMIN_TOKEN` as an env var and
  send it as a header, or relax the check for Vercel's cron source).
- **GitHub Actions** — [`.github/workflows/resolve.yml`](.github/workflows/resolve.yml)
  runs `scripts/resolve.js` every 10 min, no server needed (point the store at a
  hosted DB so state persists between runs).

## API

| Method & path | Purpose |
|---|---|
| `GET  /api/health` | liveness + active provider |
| `GET  /api/today` | today's challenge (answer hidden until resolved) |
| `POST /api/pick` | `{ option, name? }` — identity from `Bearer` token, else `userId` in body. Locks at `lockTime` |
| `GET  /api/result/:date` | resolved answer for a date |
| `GET  /api/leaderboard` | top 100 players by score |
| `GET  /api/leaderboard?scope=friends` | you + your friends *(Bearer token)* |
| `GET  /api/me/:userId` | a player's streak / stats / history / invite code |
| `POST /api/auth/request-otp` | `{ phone }` → sends a code (mock returns `devCode`) |
| `POST /api/auth/verify-otp` | `{ phone, code, ref? }` → `{ token, userId, name, inviteCode }` |
| `POST /api/auth/google` | `{ credential, ref? }` — Google ID token → `{ token, userId, name, inviteCode }` |
| `GET  /api/friends` | your invite code + friends list *(Bearer token)* |
| `POST /api/friends/add` | `{ code }` — befriend by invite code *(Bearer token)* |
| `POST /api/admin/publish` | publish a day's challenge *(X-Admin-Token)* |
| `POST /api/admin/resolve` | force-resolve now *(X-Admin-Token)* |

## Accounts & friends

Two login options, both issuing the same **stateless HMAC token** (no session
store), and **unified by email** (Google + email sign-in land on one account):

- **Email OTP** — a 6-digit code emailed to the user. `EMAIL_PROVIDER=mock`
  (default) prints/returns the code so it runs with zero setup; set
  `EMAIL_PROVIDER=resend` + `RESEND_API_KEY` + `EMAIL_FROM` to send real email
  (free tier at resend.com; no SMS fees or India DLT registration).
- **Google Sign-In / One Tap** — leave `GOOGLE_CLIENT_ID` blank for dev (the
  front-end shows a working "Continue with Google" demo button). To go live:
  create an OAuth Web Client ID, add your origin to *Authorized JavaScript
  origins*, set `GOOGLE_CLIENT_ID` here **and** `localStorage.go_google_client_id`
  in the browser, then `npm install` (pulls `google-auth-library`, which verifies
  the ID token's signature/audience server-side).

Picks made with a token are tied to the *verified* account, so the leaderboard
can't be spoofed by sending a fake `userId`. Friends connect by **invite code**
(or an invite link's `?ref=` that auto-friends on signup), and `?scope=friends`
ranks just you and your friends.

## Running two sports

The same server powers both apps via the `SPORT` env var:

```bash
SPORT=cricket  PORT=3001 npm start    # Cricket Oracle  (default)
SPORT=football PORT=3002 npm start    # Goal Oracle / World Cup 2026
```

## Front-end integration (done)

`../index.html` is already wired to this API and runs in two modes automatically:

- **🟢 LIVE** — when the backend is reachable, it pulls the challenge from
  `GET /api/today`, submits picks to `POST /api/pick`, restores state on reload
  via `GET /api/pick/:date/:userId`, shows stats from `GET /api/me/:userId`, and
  polls until the scheduler resolves the result — then shows ✅/❌. **No Reveal
  button** in this mode; resolution is automatic.
- **🟡 DEMO** — if the backend can't be reached, it falls back to the
  self-contained `localStorage` demo (with the manual Reveal button) so the file
  still works when opened on its own.

It uses an anonymous device id (`co_uid` in `localStorage`) as `userId`. Point it
at a deployed backend by setting the base URL in the browser console once:

```js
localStorage.setItem("co_api", "https://your-api.example.com"); // then reload
```

Swap the anonymous id for real phone/Google auth when you add accounts.

## Files

```
src/server.js      Express API + node-cron scheduler
src/resolver.js    locks → fetch result → grade everyone (idempotent)
src/providers.js   data sources: mock (default) + cricapi (real)
src/challenges.js  question bank + daily publish + lock/result times
src/store.js       JSON-file persistence (swap for Postgres/Supabase)
scripts/seed.js    publish today's challenge
scripts/resolve.js one-shot resolver for cron / CI
vercel.json        example Vercel Cron config
.github/workflows/resolve.yml   example scheduled GitHub Action
```

## Production checklist

- [ ] Real provider key (`PROVIDER=cricapi`, `CRICAPI_KEY`)
- [ ] Strong `ADMIN_TOKEN`
- [x] Durable storage — set `DATABASE_URL` (Postgres) and the store persists there; render.yaml provisions a free DB. (No `DATABASE_URL` → local JSON file.)
- [ ] Real auth so `userId` can't be spoofed
- [ ] Publish fixtures from a real schedule (cron that reads upcoming matches)
- [ ] Rate-limit `/api/pick`
```
