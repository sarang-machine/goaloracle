/* =========================================================================
   providers.js — cricket-result data sources.

   A provider's job: given a published challenge, return the resolved answer
   (one of challenge.options) once the match is over, or null if not ready.

   Two implementations:
     • mock    — deterministic pseudo-result, no network, no key. Default.
     • cricapi — real results from CricketData.org (cricapi.com).

   Selected by the PROVIDER env var. To add Sportmonks/RapidAPI/etc., write
   another object with the same getResult() shape and register it below.
   ========================================================================= */

/* ---- Deterministic mock: stable per (date, match) so reruns agree ---- */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const mock = {
  name: "mock",
  async getResult(ch) {
    // Pretend the match has finished and pick a stable "winner" from options.
    const idx = hash(ch.date + "|" + ch.home.short + ch.away.short) % ch.options.length;
    return { answer: ch.options[idx], source: "mock", detail: "Simulated result" };
  },
};

/* ---- Real: CricketData.org (free tier at https://cricketdata.org) ----
   Flow in production:
     1. challenge.apiMatchId is a real fixture id (set when you publish).
     2. GET match_info?id=… returns status + scorecard once the game ends.
     3. Map the scorecard to one of challenge.options based on challenge.type.
   Returns null (not throw) when the match isn't finished yet, so the
   scheduler simply tries again next tick. */
const cricapi = {
  name: "cricapi",
  async getResult(ch) {
    const key = process.env.CRICAPI_KEY;
    if (!key) throw new Error("CRICAPI_KEY is not set");
    if (!ch.apiMatchId) { console.warn(`[cricapi] no apiMatchId for ${ch.date}; cannot resolve`); return null; }

    const url = `https://api.cricapi.com/v1/match_info?apikey=${key}&id=${ch.apiMatchId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`cricapi HTTP ${res.status}`);
    const body = await res.json();
    const data = body?.data;
    if (!data) throw new Error("cricapi: unexpected response shape");

    // Not finished yet → tell the scheduler to retry later.
    if (!data.matchEnded) return null;

    const answer = deriveAnswer(ch, data);
    if (!answer) { console.warn(`[cricapi] could not map result to options for ${ch.date}`); return null; }
    return { answer, source: "cricapi", detail: data.status };
  },
};

/* Map a finished-match payload to one of the challenge's options. */
function deriveAnswer(ch, data) {
  if (ch.type === "winner") {
    // data.status is usually "Team X won by ...". Match it to an option.
    const status = (data.status || "").toLowerCase();
    return ch.options.find((o) => status.includes(o.toLowerCase())) || null;
  }
  if (ch.type === "total_runs") {
    const total = firstInningsTotal(data); // number or null
    if (total == null) return null;
    return ch.options.find((o) => inBracket(total, o)) || null;
  }
  if (ch.type === "top_scorer") {
    const top = topScorerName(data); // string or null
    if (!top) return null;
    return ch.options.find((o) => top.toLowerCase().includes(o.toLowerCase().split(" ").pop())) || null;
  }
  return null;
}

/* --- helpers that parse cricapi's scorecard shape (best-effort) --- */
function firstInningsTotal(data) {
  const inn = data.score?.[0];
  return typeof inn?.r === "number" ? inn.r : null;
}
function inBracket(total, label) {
  const l = label.toLowerCase();
  if (l.startsWith("under")) return total < parseInt(l.replace(/\D/g, ""), 10);
  if (l.startsWith("over")) return total > parseInt(l.replace(/\D/g, ""), 10);
  const nums = l.match(/\d+/g)?.map(Number);
  return nums?.length === 2 ? total >= nums[0] && total <= nums[1] : false;
}
function topScorerName(data) {
  const batters = (data.scorecard || []).flatMap((s) => s.batting || []);
  if (!batters.length) return null;
  batters.sort((a, b) => (b.r ?? 0) - (a.r ?? 0));
  return batters[0]?.batsman?.name || batters[0]?.batsman || null;
}

/* ---- Real: football-data.org (free tier covers the FIFA World Cup) ----
   Set FOOTBALLDATA_KEY and publish challenges with apiMatchId = the
   football-data.org match id. Resolves winner / draw / total goals / both-
   teams-to-score from the final score. Returns null until the match is
   FINISHED, so the scheduler just retries. */
const footballdata = {
  name: "footballdata",
  async getResult(ch) {
    const key = process.env.FOOTBALLDATA_KEY;
    if (!key) throw new Error("FOOTBALLDATA_KEY is not set");
    if (!ch.apiMatchId) { console.warn(`[footballdata] no apiMatchId for ${ch.date}; cannot resolve`); return null; }

    const res = await fetch(`https://api.football-data.org/v4/matches/${ch.apiMatchId}`, {
      headers: { "X-Auth-Token": key },
    });
    if (res.status === 429) throw new Error("footballdata rate limit (429) — will retry");
    if (!res.ok) throw new Error(`footballdata HTTP ${res.status}`);
    const m = await res.json();

    if (m.status !== "FINISHED") return null;       // not over yet → retry later

    const answer = deriveFootballAnswer(ch, m);
    if (!answer) { console.warn(`[footballdata] could not map result to options for ${ch.date}`); return null; }
    return { answer, source: "footballdata", detail: m.status };
  },
};

function deriveFootballAnswer(ch, m) {
  const ft = m.score?.fullTime || {};
  const home = ft.home, away = ft.away;
  const pick = (re) => ch.options.find((o) => re.test(o));
  const byTeam = (name) => ch.options.find((o) => o.toLowerCase().includes(String(name||"").toLowerCase())) || name;

  if (ch.type === "winner") {
    const w = m.score?.winner;                       // HOME_TEAM | AWAY_TEAM | DRAW
    if (w === "DRAW") return pick(/draw/i) || "Draw";
    if (w === "HOME_TEAM") return byTeam(m.homeTeam?.name) || ch.options[0];
    if (w === "AWAY_TEAM") return byTeam(m.awayTeam?.name) || ch.options[ch.options.length - 1];
    return null;
  }
  if (ch.type === "total_goals") {
    if (typeof home !== "number" || typeof away !== "number") return null;
    return ch.options.find((o) => inGoalBracket(home + away, o)) || null;
  }
  if (ch.type === "btts") {
    if (typeof home !== "number" || typeof away !== "number") return null;
    const both = home > 0 && away > 0;
    return both ? (pick(/^yes/i) || pick(/yes/i)) : (pick(/^no/i) || pick(/no/i));
  }
  if (ch.type === "top_scorer") {
    const goals = m.goals || [];                     // may be absent on the free tier
    if (!goals.length) return null;
    const tally = {};
    for (const g of goals) { const n = g.scorer?.name; if (n) tally[n] = (tally[n] || 0) + 1; }
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!top) return null;
    const last = top.toLowerCase().split(" ").pop();
    return ch.options.find((o) => o.toLowerCase().includes(last)) || null;
  }
  return null;
}

/* Float-aware bracket match, e.g. "Under 1.5", "2 - 3", "Over 5". */
function inGoalBracket(total, label) {
  const l = label.toLowerCase();
  const nums = (l.match(/\d+(\.\d+)?/g) || []).map(Number);
  if (l.startsWith("under")) return total < nums[0];
  if (l.startsWith("over")) return total > nums[0];
  return nums.length === 2 ? total >= nums[0] && total <= nums[1] : false;
}

const PROVIDERS = { mock, cricapi, footballdata };

export function getProvider() {
  const name = (process.env.PROVIDER || "mock").toLowerCase();
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown PROVIDER "${name}" (have: ${Object.keys(PROVIDERS).join(", ")})`);
  return p;
}
