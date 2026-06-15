# 🚀 Deploying Goal Oracle (World Cup 2026)

The whole app ships as **one service**: the Node server runs the API + the
auto-resolve scheduler **and** serves the front-end (same origin → no CORS, one
URL). So you deploy a single Node web service and you're live.

> What I (Claude) set up: single-service code, deploy configs, and this guide.
> What you do: the steps below need **your** hosting account login, so they're
> yours to run. Pick **one** path.

---

## Prerequisites (one time)
1. Put this repo on GitHub:
   ```bash
   # already a local git repo with an initial commit
   git remote add origin https://github.com/<you>/goal-oracle.git
   git branch -M main
   git push -u origin main
   ```

---

## Option A — Render (recommended, free, no Docker)

1. Go to **render.com** → sign in with GitHub.
2. **New → Blueprint**, select this repo. Render reads [`render.yaml`](render.yaml)
   and provisions the web service (it auto-generates `ADMIN_TOKEN` / `AUTH_SECRET`).
3. Click **Apply**. In ~2 min you get a URL like `https://goal-oracle.onrender.com`.
4. Open it — the game loads in **🟢 LIVE** mode (mock data/SMS until you add keys).

Free tier notes: the service sleeps after inactivity (first hit is slow), and the
filesystem is **ephemeral** (data resets on redeploy). For durable data add a
Disk (mount `/data`, set `DATA_DIR=/data`) or a Postgres (see below).

## Option B — Railway / Fly.io / any container host (uses the Dockerfile)

```bash
# Railway
railway init && railway up          # detects the Dockerfile

# Fly.io
fly launch --dockerfile Dockerfile  # follow prompts, then: fly deploy
```
Set the same env vars (below) in the host's dashboard.

## Option C — Split hosting (static front-end + API)
Host `goal-oracle/` on Netlify/Vercel (static) and the `server/` on Render, then
in the browser console set `localStorage.setItem("go_api","https://<your-api>")`.
The single-service options above are simpler — prefer them.

---

## Environment variables

| Var | Dev default | For production |
|---|---|---|
| `SPORT` | `football` | `football` (or `cricket`) |
| `PORT` | host-provided | leave to the host |
| `ADMIN_TOKEN` | dev value | **strong secret** (Render auto-generates) |
| `AUTH_SECRET` | dev value | **strong random** (Render auto-generates) |
| `PROVIDER` | `mock` | `cricapi` + `CRICAPI_KEY` for real results |
| `SMS_PROVIDER` | `mock` | a real gateway (MSG91/Twilio) for live OTP |
| `GOOGLE_CLIENT_ID` | _empty_ | your OAuth Web client id for real One Tap |
| `DATA_DIR` | `server/data` | a mounted persistent disk path |

After deploying, to enable **real Google One Tap**: set `GOOGLE_CLIENT_ID` on the
server, add your deployed origin to the OAuth client's *Authorized JavaScript
origins*, and in the browser run
`localStorage.setItem("go_google_client_id","<id>")`.

---

## Go-live checklist
- [ ] Strong `ADMIN_TOKEN` + `AUTH_SECRET`
- [ ] Real data provider (`PROVIDER=cricapi`, `CRICAPI_KEY`) + publish fixtures with real match ids
- [ ] Real SMS gateway (`SMS_PROVIDER`) and/or `GOOGLE_CLIENT_ID`
- [ ] Durable storage (persistent disk or Postgres) — the JSON store is single-instance/ephemeral
- [ ] A custom domain (optional)

---

## Run the production build locally first (sanity check)
```bash
cd server
npm install
node src/server.js
```
Then open **http://localhost:3001** → the Goal Oracle front-end + API on one
port, in 🟢 LIVE mode. No env vars needed (football is the default; the server
serves the `goal-oracle/` front-end). To run the cricket version instead, set
`SPORT=cricket` and `STATIC_DIR=..` (PowerShell: `$env:SPORT="cricket"`).
