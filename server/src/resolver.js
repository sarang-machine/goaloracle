/* =========================================================================
   resolver.js — the heart of the automation.

   resolveDay(date): if the match is over and we have a result, grade every
   pick for that date, update streaks / scores / history, and mark the
   challenge resolved. Idempotent — safe to call repeatedly (the scheduler
   does). Returns a summary of what happened.
   ========================================================================= */

import { getChallenge, saveChallenge, picksForDate, getUser, saveUser } from "./store.js";
import { getProvider } from "./providers.js";
import { liveStatus } from "./challenges.js";

export async function resolveDay(date) {
  const ch = await getChallenge(date);
  if (!ch) return { date, ok: false, reason: "no challenge published" };
  if (ch.status === "resolved") return { date, ok: true, reason: "already resolved", graded: 0 };

  // Don't even ask the provider until the match should be over.
  if (Date.now() < new Date(ch.resultTime).getTime()) {
    return { date, ok: false, reason: "too early (match not finished)" };
  }

  let result;
  try {
    result = await getProvider().getResult(ch);
  } catch (err) {
    return { date, ok: false, reason: `provider error: ${err.message}` };
  }
  if (!result || !result.answer) return { date, ok: false, reason: "result not available yet" };

  // ---- Persist the answer ----
  ch.answer = result.answer;
  ch.status = "resolved";
  ch.resolvedAt = new Date().toISOString();
  ch.resultSource = result.source;
  await saveChallenge(ch);

  // ---- Grade every pick ----
  const picks = await picksForDate(date);
  let correctCount = 0;
  for (const [userId, pick] of picks) {
    const correct = pick.option === ch.answer;
    pick.correct = correct;
    pick.gradedAt = ch.resolvedAt;

    const user = await getUser(userId);
    user.played += 1;
    user.history.push({ date, correct });
    if (user.history.length > 60) user.history = user.history.slice(-60);
    if (correct) {
      user.wins += 1;
      user.streak += 1;
      user.best = Math.max(user.best, user.streak);
      user.score += ch.points + user.streak * 10; // streak bonus
      correctCount += 1;
    } else {
      user.streak = 0;
    }
    await saveUser(user);
  }
  // picksForDate returns live references from the store cache, so the mutations
  // above are already persisted by the saveUser flush; re-save picks explicitly
  // is unnecessary here.

  return { date, ok: true, answer: ch.answer, source: result.source, graded: picks.length, correct: correctCount };
}

/* Scan all published-but-unresolved challenges whose result time has passed
   and try to resolve them. Called by the scheduler each tick. */
export async function resolveDue() {
  const { allChallenges } = await import("./store.js");
  const out = [];
  for (const ch of await allChallenges()) {
    if (ch.status !== "resolved" && Date.now() >= new Date(ch.resultTime).getTime()) {
      out.push(await resolveDay(ch.date));
    }
  }
  return out;
}

/* Helper used by the API to keep a challenge's stored status in sync with the
   clock (open → locked) without waiting for resolution. */
export async function syncStatus(ch) {
  const s = liveStatus(ch);
  if (s !== ch.status && ch.status !== "resolved") { ch.status = s; await saveChallenge(ch); }
  return ch;
}
