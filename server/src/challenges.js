/* =========================================================================
   challenges.js — the question bank + the daily-publish logic.

   In production each day's challenge is created from a real fixture (with the
   real API match id). Here we seed from a static bank so the whole pipeline
   runs end-to-end with zero setup; `apiMatchId` is where the real id goes.

   Times are what make the game automatic:
     lockTime   — picks are rejected after this (≈ the toss / match start)
     resultTime — the scheduler tries to resolve the result after this
   ========================================================================= */

const CRICKET_BANK = [
  { league:"IPL", venue:"Wankhede Stadium, Mumbai",
    home:{ name:"Mumbai Indians", short:"MI", color:"#004ba0" },
    away:{ name:"Chennai Super Kings", short:"CSK", color:"#f9cd05" },
    type:"winner", question:"Who wins tonight's blockbuster?",
    options:["Mumbai Indians","Chennai Super Kings"], points:100 },
  { league:"IPL", venue:"M. Chinnaswamy, Bengaluru",
    home:{ name:"RC Bengaluru", short:"RCB", color:"#d31a1a" },
    away:{ name:"Kolkata Knight Riders", short:"KKR", color:"#3a225d" },
    type:"top_scorer", question:"Who tops the run charts tonight?",
    options:["Virat Kohli","Phil Salt","Ajinkya Rahane","Rinku Singh"], points:150 },
  { league:"IPL", venue:"Narendra Modi Stadium, Ahmedabad",
    home:{ name:"Gujarat Titans", short:"GT", color:"#1b2133" },
    away:{ name:"Rajasthan Royals", short:"RR", color:"#ea1a85" },
    type:"total_runs", question:"First innings total bracket?",
    options:["Under 160","160 - 180","181 - 200","Over 200"], points:200 },
  { league:"T20I", venue:"MCG, Melbourne",
    home:{ name:"India", short:"IND", color:"#0d6efd" },
    away:{ name:"Australia", short:"AUS", color:"#f9cd05" },
    type:"winner", question:"Who takes the series-decider?",
    options:["India","Australia"], points:100 },
  { league:"T20I", venue:"Wanderers, Johannesburg",
    home:{ name:"South Africa", short:"RSA", color:"#007749" },
    away:{ name:"England", short:"ENG", color:"#1f3a93" },
    type:"winner", question:"Who closes out the chase?",
    options:["South Africa","England"], points:100 },
];

/* World Cup 2026 bank — used when SPORT=football (e.g. the Goal Oracle app).
   Winner-only: every challenge is "which team will win?" (knockout ties, so
   there's always a clear winner — no draws to resolve). To edit the daily
   matches, change the entries below; keep type:"winner" and two options. */
const FOOTBALL_BANK = [
  { league:"ROUND OF 32", venue:"AT&T Stadium, Dallas",
    home:{ name:"Brazil", short:"BRA", color:"#009b3a" }, away:{ name:"Morocco", short:"MAR", color:"#c1272d" },
    type:"winner", question:"Which team will win?", options:["Brazil","Morocco"], points:100 },
  { league:"ROUND OF 32", venue:"Lumen Field, Seattle",
    home:{ name:"Spain", short:"ESP", color:"#c60b1e" }, away:{ name:"Uruguay", short:"URU", color:"#5aa0d8" },
    type:"winner", question:"Which team will win?", options:["Spain","Uruguay"], points:100 },
  { league:"ROUND OF 16", venue:"MetLife Stadium, New Jersey",
    home:{ name:"France", short:"FRA", color:"#1f3a93" }, away:{ name:"England", short:"ENG", color:"#243b7a" },
    type:"winner", question:"Which team will win?", options:["France","England"], points:100 },
  { league:"ROUND OF 16", venue:"SoFi Stadium, Los Angeles",
    home:{ name:"Argentina", short:"ARG", color:"#6cace4" }, away:{ name:"Netherlands", short:"NED", color:"#f36c21" },
    type:"winner", question:"Which team will win?", options:["Argentina","Netherlands"], points:100 },
  { league:"ROUND OF 16", venue:"Mercedes-Benz Stadium, Atlanta",
    home:{ name:"Portugal", short:"POR", color:"#d52b1e" }, away:{ name:"Germany", short:"GER", color:"#111111" },
    type:"winner", question:"Which team will win?", options:["Portugal","Germany"], points:100 },
  { league:"QUARTER-FINAL", venue:"AT&T Stadium, Dallas",
    home:{ name:"Argentina", short:"ARG", color:"#6cace4" }, away:{ name:"Spain", short:"ESP", color:"#c60b1e" },
    type:"winner", question:"Which team will win?", options:["Argentina","Spain"], points:100 },
  { league:"SEMI-FINAL", venue:"SoFi Stadium, Los Angeles",
    home:{ name:"Brazil", short:"BRA", color:"#009b3a" }, away:{ name:"France", short:"FRA", color:"#1f3a93" },
    type:"winner", question:"Which team will win?", options:["Brazil","France"], points:100 },
  { league:"FINAL", venue:"MetLife Stadium, New Jersey",
    home:{ name:"Argentina", short:"ARG", color:"#6cace4" }, away:{ name:"France", short:"FRA", color:"#1f3a93" },
    type:"winner", question:"Who lifts the World Cup?", options:["Argentina","France"], points:100 },
];

/* Pick the bank by sport. Defaults to football (Goal Oracle) — the app this
   server is set up to serve/deploy. Run cricket with SPORT=cricket. */
export const BANK = (process.env.SPORT || "football").toLowerCase() === "cricket" ? CRICKET_BANK : FOOTBALL_BANK;

/* Local YYYY-MM-DD key. */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function dayNumber(d = new Date()) {
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000) + d.getFullYear() * 366;
}

/* Build (but don't persist) the challenge object for a given date. The store
   layer decides whether to keep an already-published one. */
export function buildChallenge(date = new Date(), opts = {}) {
  const key = dateKey(date);
  const base = BANK[dayNumber(date) % BANK.length];

  // Defaults are handy for local demos: lock 30s from now, result 90s from now,
  // so you can watch the whole automatic flow in under two minutes. In prod
  // these come from the real fixture start / expected end times.
  const now = Date.now();
  const lockTime = opts.lockTime ?? new Date(now + 30_000).toISOString();
  const resultTime = opts.resultTime ?? new Date(now + 90_000).toISOString();

  return {
    id: key,          // per-fixture key (date-based for the single daily challenge)
    date: key,
    ...base,
    apiMatchId: opts.apiMatchId ?? null, // ← real fixture id goes here in prod
    lockTime,
    resultTime,
    status: "open",   // open → locked → resolved
    answer: null,     // filled by the resolver from real match data
  };
}

/* Derive live status from the clock (without mutating). */
export function liveStatus(ch, at = Date.now()) {
  if (ch.status === "resolved") return "resolved";
  if (at >= new Date(ch.lockTime).getTime()) return "locked";
  return "open";
}
