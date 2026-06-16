/* =========================================================================
   store.js — persistence behind a small async interface.

   Two backends, chosen at runtime:
     • Postgres  — when DATABASE_URL is set (durable; survives redeploys).
     • JSON file — otherwise (zero-setup local default).

   Both keep the whole dataset as one document in memory (`cache`) and persist
   it on write, so every exported function below is backend-agnostic. At real
   scale you'd split this into proper tables; the single-document model is plenty
   for an MVP and keeps the interface identical.
   ========================================================================= */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// DATA_DIR is configurable so a host's persistent disk can be mounted here.
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
const DB_FILE = join(DATA_DIR, "db.json");

const EMPTY = { challenges: {}, picks: {}, users: {}, otps: {} };
const USE_PG = !!process.env.DATABASE_URL;

let cache = null;
let pool = null;

/* Lazy Postgres pool + one-time table create (only loaded when USE_PG). */
async function pg() {
  if (pool) return pool;
  const { default: pkg } = await import("pg");
  const ssl = (process.env.PGSSL === "true" || /sslmode=require/.test(process.env.DATABASE_URL || ""))
    ? { rejectUnauthorized: false } : undefined;
  pool = new pkg.Pool({ connectionString: process.env.DATABASE_URL, ssl });
  await pool.query("CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v jsonb NOT NULL)");
  return pool;
}

async function ensureFile() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) await writeFile(DB_FILE, JSON.stringify(EMPTY, null, 2));
}

async function read() {
  if (cache) return cache;
  if (USE_PG) {
    try {
      const r = await (await pg()).query("SELECT v FROM kv WHERE k = 'db'");
      cache = r.rows[0]?.v || structuredClone(EMPTY);
    } catch (e) { console.error("[store] pg read failed:", e.message); cache = structuredClone(EMPTY); }
  } else {
    await ensureFile();
    try { cache = JSON.parse(await readFile(DB_FILE, "utf8")); }
    catch { cache = structuredClone(EMPTY); }
  }
  for (const k of Object.keys(EMPTY)) cache[k] ??= {};
  return cache;
}

async function flush() {
  if (!cache) return;
  if (USE_PG) {
    try {
      await (await pg()).query(
        "INSERT INTO kv (k, v) VALUES ('db', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = $1::jsonb",
        [JSON.stringify(cache)]);
    } catch (e) { console.error("[store] pg flush failed:", e.message); }
    return;
  }
  // file: atomic-ish write (temp then rename)
  await ensureFile();
  const tmp = DB_FILE + ".tmp";
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, DB_FILE);
}

/* ---- Challenges (one per date) ---- */
export async function getChallenge(date) { return (await read()).challenges[date] || null; }
export async function saveChallenge(ch) { (await read()).challenges[ch.date] = ch; await flush(); return ch; }
export async function allChallenges() { return Object.values((await read()).challenges); }

/* ---- Picks ( picks[date][userId] ) ---- */
export async function getPick(date, userId) { return (await read()).picks[date]?.[userId] || null; }
export async function savePick(date, userId, pick) {
  const db = await read();
  (db.picks[date] ??= {})[userId] = pick;
  await flush();
  return pick;
}
export async function picksForDate(date) { return Object.entries((await read()).picks[date] || {}); }
/* Vote distribution for a date: { total, counts: { option: n } }. */
export async function tallyPicks(date) {
  const entries = (await read()).picks[date] || {};
  const counts = {}; let total = 0;
  for (const id in entries) { const o = entries[id].option; if (!o) continue; counts[o] = (counts[o] || 0) + 1; total++; }
  return { total, counts };
}

/* ---- Users (streaks, score, history, identity, friends) ---- */
export async function getUser(userId) {
  const db = await read();
  return (db.users[userId] ??= {
    userId, name: null, streak: 0, best: 0, wins: 0, played: 0, score: 1000, history: [],
    phone: null, googleId: null, email: null, inviteCode: null, friends: [],
  });
}
export async function saveUser(user) { (await read()).users[user.userId] = user; await flush(); return user; }
export async function allUsers() { return Object.values((await read()).users); }

export async function findUserByEmail(email) {
  const e = String(email || "").toLowerCase();
  return (await allUsers()).find((u) => (u.email || "").toLowerCase() === e) || null;
}
export async function findUserByGoogle(googleId) {
  return (await allUsers()).find((u) => u.googleId === googleId) || null;
}
export async function findUserByInvite(code) {
  const c = String(code || "").toUpperCase();
  return (await allUsers()).find((u) => u.inviteCode === c) || null;
}
/* Make two users mutual friends (idempotent). */
export async function linkFriends(idA, idB) {
  if (idA === idB) return false;
  const a = await getUser(idA), b = await getUser(idB);
  a.friends = a.friends || []; b.friends = b.friends || [];
  let changed = false;
  if (!a.friends.includes(idB)) { a.friends.push(idB); changed = true; }
  if (!b.friends.includes(idA)) { b.friends.push(idA); changed = true; }
  if (changed) { await saveUser(a); await saveUser(b); }
  return changed;
}

/* ---- OTP codes (transient) ---- */
export async function setOtp(phone, rec) { (await read()).otps[phone] = rec; await flush(); }
export async function getOtp(phone) { return (await read()).otps[phone] || null; }
export async function clearOtp(phone) { delete (await read()).otps[phone]; await flush(); }

/* For tests / resets. */
export async function _reset() { cache = structuredClone(EMPTY); await flush(); }
