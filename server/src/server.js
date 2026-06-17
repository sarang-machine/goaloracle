/* =========================================================================
   server.js — HTTP API + the in-process scheduler.

   Endpoints (all JSON):
     GET  /api/health
     GET  /api/today                 → today's challenge (+ live status)
     POST /api/pick                  → { userId, name?, option }  (locks at lockTime)
     GET  /api/result/:date          → resolved answer for a date
     GET  /api/leaderboard           → top players
     GET  /api/me/:userId            → a player's streak / stats
     POST /api/admin/publish         → publish a day's challenge   (admin token)
     POST /api/admin/resolve         → force a resolve right now    (admin token)

   The scheduler (node-cron) calls resolveDue() on RESOLVE_CRON, so results
   grade themselves with no human in the loop.
   ========================================================================= */

import "dotenv/config";
import express from "express";
import cron from "node-cron";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { dateKey, buildChallenge } from "./challenges.js";
import { getChallenge, saveChallenge, getPick, savePick, getUser, allUsers, findUserByInvite, linkFriends, tallyPicks } from "./store.js";
import { resolveDay, resolveDue, syncStatus } from "./resolver.js";
import { requestOtp, verifyOtp, loginWithGoogle, authUserId } from "./auth.js";
import { buildChallengeFromFixtures } from "./publisher.js";
import { activeProviderName } from "./providers.js";

const app = express();
app.use(express.json());

// Permissive CORS so the static front-end (file:// or localhost:5173) can call in.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token, Authorization");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-secret-change-me";
const requireAdmin = (req, res, next) =>
  req.get("X-Admin-Token") === ADMIN_TOKEN ? next() : res.status(401).json({ error: "bad admin token" });

/* Ensure today's challenge exists (auto-publish on first request).
   With PROVIDER=footballdata + a key, publish the REAL fixture of the day;
   otherwise fall back to the static demo bank. */
async function ensureToday() {
  const key = dateKey();
  let ch = await getChallenge(key);
  if (ch) return syncStatus(ch);

  const sport = (process.env.SPORT || "football").toLowerCase();
  let built = null;
  if (sport === "football") {
    if (activeProviderName() === "footballdata") {
      try { built = await buildChallengeFromFixtures(); }
      catch (e) { console.warn("[publisher]", e.message); }
    }
    // No real fixture yet (no key, or no upcoming match) → don't invent one.
    // Returning null makes /api/today report "pending" so the UI shows loading.
    if (!built) return null;
  } else {
    built = buildChallenge();   // cricket uses its static bank
  }
  return syncStatus(await saveChallenge(built));
}

/* Strip fields the client shouldn't see before the match resolves. */
function publicChallenge(ch) {
  const { answer, status } = ch;
  return { ...ch, answer: status === "resolved" ? answer : null };
}

app.get("/api/health", (_req, res) => res.json({ ok: true, provider: activeProviderName(),
  googleClientId: process.env.GOOGLE_CLIENT_ID || null }));   // public — client IDs aren't secret

app.get("/api/today", async (_req, res) => {
  const ch = await ensureToday();
  if (!ch) return res.json({ pending: true });   // no real fixture yet → UI shows loading
  res.json({ ...publicChallenge(ch), votes: await tallyPicks(ch.date) });
});

app.post("/api/pick", async (req, res) => {
  const { name, option } = req.body || {};
  // Identity: a verified token wins; otherwise fall back to an anonymous id.
  const userId = authUserId(req) || req.body?.userId;
  if (!userId || !option) return res.status(400).json({ error: "userId/token and option required" });

  const ch = await ensureToday();
  if (!ch) return res.status(409).json({ error: "no match available right now" });
  if (!ch.options.includes(option)) return res.status(400).json({ error: "invalid option" });

  // Server-authoritative lock: no picks (or changes) once the match starts.
  if (Date.now() >= new Date(ch.lockTime).getTime())
    return res.status(409).json({ error: "picks are locked for this match" });

  const existing = await getPick(ch.date, userId);
  if (existing?.locked) return res.status(409).json({ error: "you already locked a pick" });

  if (name) { const u = await getUser(userId); if (!u.email) { u.name = name; } } // don't let anon overwrite a verified name
  const pick = await savePick(ch.date, userId, { option, locked: true, ts: new Date().toISOString(), correct: null });
  res.json({ ok: true, date: ch.date, pick });
});

/* ---- Auth (email OTP) ---- */
app.post("/api/auth/request-otp", async (req, res) => {
  try { res.json(await requestOtp(req.body?.email)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const { user, token } = await verifyOtp(req.body?.email, req.body?.code, req.body?.priorId);
    // Optional: auto-friend whoever referred them (invite code).
    if (req.body?.ref) { const f = await findUserByInvite(req.body.ref); if (f) await linkFriends(user.userId, f.userId); }
    res.json({ ok: true, token, userId: user.userId, name: user.name, inviteCode: user.inviteCode });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const { user, token } = await loginWithGoogle(req.body?.credential, req.body?.priorId);
    if (req.body?.ref) { const f = await findUserByInvite(req.body.ref); if (f) await linkFriends(user.userId, f.userId); }
    res.json({ ok: true, token, userId: user.userId, name: user.name, inviteCode: user.inviteCode });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ---- Friends ---- */
app.get("/api/friends", async (req, res) => {
  const me = authUserId(req);
  if (!me) return res.status(401).json({ error: "sign in required" });
  const u = await getUser(me);
  const friends = await Promise.all((u.friends || []).map(async (id) => {
    const f = await getUser(id);
    return { userId: f.userId, name: f.name || "Anon", streak: f.streak, score: f.score };
  }));
  res.json({ inviteCode: u.inviteCode, friends });
});

app.post("/api/friends/add", async (req, res) => {
  const me = authUserId(req);
  if (!me) return res.status(401).json({ error: "sign in required" });
  const friend = await findUserByInvite(req.body?.code);
  if (!friend) return res.status(404).json({ error: "no player with that code" });
  if (friend.userId === me) return res.status(400).json({ error: "that's your own code" });
  await linkFriends(me, friend.userId);
  res.json({ ok: true, friend: { userId: friend.userId, name: friend.name || "Anon" } });
});

app.get("/api/result/:date", async (req, res) => {
  const ch = await getChallenge(req.params.date);
  if (!ch) return res.status(404).json({ error: "no challenge for that date" });
  res.json({ date: ch.date, status: ch.status, answer: ch.status === "resolved" ? ch.answer : null, source: ch.resultSource || null });
});

app.get("/api/leaderboard", async (req, res) => {
  let pool = await allUsers();
  // scope=friends → just me + my friends (requires a token)
  if (req.query.scope === "friends") {
    const me = authUserId(req);
    if (!me) return res.status(401).json({ error: "sign in required" });
    const u = await getUser(me);
    const ids = new Set([me, ...(u.friends || [])]);
    pool = pool.filter((p) => ids.has(p.userId));
  }
  const rows = pool
    .map((u) => ({ userId: u.userId, name: u.name || "Anon", streak: u.streak, best: u.best, score: u.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);
  res.json(rows);
});

app.get("/api/me/:userId", async (req, res) => {
  const u = await getUser(req.params.userId);
  res.json({ userId: u.userId, name: u.name, streak: u.streak, best: u.best, wins: u.wins, played: u.played,
    score: u.score, history: u.history.slice(-30),
    inviteCode: u.inviteCode, isAccount: !!(u.phone || u.googleId), friendCount: (u.friends || []).length });
});

/* A user's pick for a date — lets the front-end restore state on reload. */
app.get("/api/pick/:date/:userId", async (req, res) => {
  const p = await getPick(req.params.date, req.params.userId);
  res.json(p || { option: null, locked: false, correct: null });
});

app.post("/api/admin/publish", requireAdmin, async (req, res) => {
  const { date, lockTime, resultTime, apiMatchId } = req.body || {};
  const when = date ? new Date(date) : new Date();
  const ch = await saveChallenge(buildChallenge(when, { lockTime, resultTime, apiMatchId }));
  res.json({ ok: true, challenge: ch });
});

app.post("/api/admin/resolve", requireAdmin, async (req, res) => {
  const date = req.body?.date || dateKey();
  res.json(await resolveDay(date));
});

/* ---- Serve the front-end (same origin → no CORS, one deployable service) ----
   STATIC_DIR defaults to the Goal Oracle app folder. Set it to serve a different
   build (e.g. the cricket app at "..", relative to repo root). */
const STATIC_DIR = process.env.STATIC_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "goal-oracle");
if (existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  // SPA fallback: any non-API GET returns index.html.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(STATIC_DIR, "index.html")));
  console.log(`[static] serving front-end from ${STATIC_DIR}`);
}

/* ---- Scheduler: auto-resolve finished matches ---- */
const CRON = process.env.RESOLVE_CRON || "*/5 * * * *";
if (cron.validate(CRON)) {
  cron.schedule(CRON, async () => {
    const done = (await resolveDue()).filter((r) => r.ok && r.graded !== undefined);
    if (done.length) console.log("[cron] resolved:", done);
  });
  console.log(`[cron] auto-resolve scheduled (${CRON})`);
} else {
  console.warn(`[cron] invalid RESOLVE_CRON "${CRON}" — scheduler disabled`);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Oracle server on :${PORT}  (sport: ${process.env.SPORT || "football"}, provider: ${process.env.PROVIDER || "mock"})`);
});
