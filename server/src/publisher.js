/* =========================================================================
   publisher.js — turn REAL fixtures into the daily challenge.

   When PROVIDER=footballdata and a key is set, this fetches the day's actual
   World Cup match from football-data.org and builds a challenge wired to the
   real match id (so the result resolves automatically). If there's no key or
   no match that day, the caller falls back to the static demo bank.
   ========================================================================= */

import { dateKey } from "./challenges.js";

const TEAM_COLORS = {
  Argentina:"#6cace4", France:"#1f3a93", Brazil:"#009b3a", England:"#243b7a",
  Spain:"#c60b1e", Germany:"#111111", Portugal:"#d52b1e", Netherlands:"#f36c21",
  Italy:"#0d6efd", Belgium:"#e30613", Croatia:"#d10a11", Uruguay:"#5aa0d8",
  Mexico:"#006847", "United States":"#1c3578", USA:"#1c3578", Canada:"#d80621",
  Morocco:"#c1272d", Japan:"#1c1c70", "South Korea":"#0a3b8c", Senegal:"#00853f",
  Nigeria:"#008751", Ghana:"#006b3f", Australia:"#f6c700", Switzerland:"#d52b1e",
  Denmark:"#c8102e", Poland:"#dc143c", Colombia:"#fcd116", Ecuador:"#14387f",
};
function teamColor(name) { return TEAM_COLORS[name] || "#2d3b4d"; }
function tla(name, fallbackName) {
  if (name) return name.toUpperCase();
  return (fallbackName || "").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "TBD";
}
function stageLabel(stage) {
  const s = (stage || "").toUpperCase();
  const map = {
    GROUP_STAGE: "GROUP STAGE", LAST_16: "ROUND OF 16", ROUND_OF_16: "ROUND OF 16",
    QUARTER_FINALS: "QUARTER-FINAL", QUARTER_FINAL: "QUARTER-FINAL",
    SEMI_FINALS: "SEMI-FINAL", SEMI_FINAL: "SEMI-FINAL",
    THIRD_PLACE: "3RD PLACE", FINAL: "FINAL",
  };
  return map[s] || (s ? s.replace(/_/g, " ") : "WORLD CUP 2026");
}

/* Seed ("house") votes so a poll never starts at zero. Deterministic per match
   and unevenly split, so it looks like real early votes. SEED_VOTES_BASE=0
   disables it; admins can override per match via /api/admin/seed. */
export function seedVotes(options, idStr) {
  const base = process.env.SEED_VOTES_BASE !== undefined ? Number(process.env.SEED_VOTES_BASE) : 100;
  if (!base || base <= 0 || !options?.length) return {};
  let s = 0; for (const c of String(idStr)) s = (s * 31 + c.charCodeAt(0)) & 0x7fffffff;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const total = Math.round(base * (0.5 + rnd()));          // base×0.5 … base×1.5
  const weights = options.map(() => 0.25 + rnd());
  const wsum = weights.reduce((a, b) => a + b, 0);
  const counts = {};
  options.forEach((o, i) => { counts[o] = Math.max(1, Math.round(total * weights[i] / wsum)); });
  return counts;
}

/* Map one football-data match object → our challenge shape. */
export function fixtureToChallenge(m, day) {
  const home = m.homeTeam?.name || "Home", away = m.awayTeam?.name || "Away";
  const isGroup = (m.stage || "").toUpperCase().includes("GROUP");
  // Earliest the result can be expected: 90' + half-time + stoppage for group
  // games; allow for extra-time + penalties on knockouts. The resolver retries
  // anyway, but this avoids asking too early on every tick.
  const resultHours = isGroup ? 2.25 : 3.5;
  const options = isGroup ? [home, "Draw", away] : [home, away];
  return {
    id: String(m.id),                                   // keyed per fixture
    date: day || (m.utcDate ? m.utcDate.slice(0, 10) : dateKey()),
    league: stageLabel(m.stage),
    venue: m.venue || "FIFA World Cup 2026",
    home: { name: home, short: tla(m.homeTeam?.tla, home), color: teamColor(home) },
    away: { name: away, short: tla(m.awayTeam?.tla, away), color: teamColor(away) },
    type: "winner",
    // Group games can draw, so offer Draw; knockouts always have a winner.
    question: isGroup ? "Match result?" : "Which team will win?",
    options,
    points: 100,
    apiMatchId: String(m.id),
    lockTime: m.utcDate,
    resultTime: new Date(new Date(m.utcDate).getTime() + resultHours * 3600 * 1000).toISOString(),
    status: "open",
    answer: null,
    seed: seedVotes(options, String(m.id)),             // house votes so the poll isn't empty
  };
}

/* Fetch the NEXT real World Cup fixture (today or upcoming) and return a
   challenge keyed to `date` (or null). Looking ahead a window means rest days
   show the next match instead of a placeholder. */
export async function buildChallengeFromFixtures(date = new Date()) {
  const key = process.env.FOOTBALLDATA_KEY;
  if (!key) return null;
  const comp = process.env.WC_COMPETITION || "WC";   // FIFA World Cup code on football-data
  const day = dateKey(date);
  const horizon = Number(process.env.FIXTURE_LOOKAHEAD_DAYS || 12);
  const end = dateKey(new Date(date.getTime() + horizon * 86400000));

  const url = `https://api.football-data.org/v4/competitions/${comp}/matches?dateFrom=${day}&dateTo=${end}`;
  let res;
  try { res = await fetch(url, { headers: { "X-Auth-Token": key } }); }
  catch (e) { console.warn("[publisher] fetch failed:", e.message); return null; }
  if (!res.ok) { console.warn(`[publisher] fixtures HTTP ${res.status}`); return null; }

  const body = await res.json();
  const matches = body.matches || [];
  // Earliest match that hasn't finished — i.e. the next one to predict.
  matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const m = matches.find((x) => x.status !== "FINISHED");
  if (!m) { console.warn(`[publisher] no upcoming World Cup match within ${horizon}d of ${day}`); return null; }

  const ch = fixtureToChallenge(m, day);
  const when = m.utcDate.slice(0, 10);
  console.log(`[publisher] ${day}: next fixture ${ch.home.short} v ${ch.away.short} on ${when} (id ${ch.apiMatchId})`);
  return ch;
}

/* Fetch a window of fixtures and return the next N upcoming + last N recent,
   each as a challenge object (id = fixture id). Returns null with no key. */
export async function fetchBoardFixtures(date = new Date(), n = Number(process.env.BOARD_SIZE) || 5) {
  const key = process.env.FOOTBALLDATA_KEY;
  if (!key) return null;
  const comp = process.env.WC_COMPETITION || "WC";
  const from = dateKey(new Date(date.getTime() - 7 * 86400000));
  const to = dateKey(new Date(date.getTime() + 14 * 86400000));

  let res;
  try { res = await fetch(`https://api.football-data.org/v4/competitions/${comp}/matches?dateFrom=${from}&dateTo=${to}`, { headers: { "X-Auth-Token": key } }); }
  catch (e) { console.warn("[publisher] board fetch failed:", e.message); return null; }
  if (!res.ok) { console.warn(`[publisher] board HTTP ${res.status}`); return null; }

  const ms = (await res.json()).matches || [];
  const upcoming = ms.filter((m) => m.status !== "FINISHED")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate)).slice(0, n)
    .map((m) => fixtureToChallenge(m));
  const recent = ms.filter((m) => m.status === "FINISHED")
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate)).slice(0, n)
    .map((m) => {
      const c = fixtureToChallenge(m);
      // The feed already says FINISHED — resolve now, don't wait for the stage
      // result-time floor (which is only there to avoid asking during a live game).
      c.resultTime = m.utcDate;
      c.status = "locked";
      return c;
    });
  return { upcoming, recent };
}
