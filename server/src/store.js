/* =========================================================================
   store.js — tiny JSON-file persistence.
   Deliberately behind a small async interface so it can be swapped for
   Postgres / Supabase / Firebase without touching the rest of the app:
   just reimplement these exported functions against your DB.
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

let cache = null;

async function ensureFile() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) await writeFile(DB_FILE, JSON.stringify(EMPTY, null, 2));
}

async function read() {
  if (cache) return cache;
  await ensureFile();
  try {
    cache = JSON.parse(await readFile(DB_FILE, "utf8"));
    for (const k of Object.keys(EMPTY)) cache[k] ??= {};
  } catch {
    cache = structuredClone(EMPTY);
  }
  return cache;
}

/* Atomic-ish write: write to a temp file then rename over the real one. */
async function flush() {
  if (!cache) return;
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

export async function findUserByPhone(phone) {
  return (await allUsers()).find((u) => u.phone === phone) || null;
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
