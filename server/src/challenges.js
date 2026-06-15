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

/* World Cup 2026 bank — used when SPORT=football (e.g. the Goal Oracle app). */
const FOOTBALL_BANK = [
  { league:"GROUP A", venue:"Estadio Azteca, Mexico City",
    home:{ name:"Mexico", short:"MEX", color:"#006847" }, away:{ name:"Croatia", short:"CRO", color:"#d10a11" },
    type:"winner", question:"World Cup opener — who wins?", options:["Mexico","Draw","Croatia"], points:100 },
  { league:"GROUP D", venue:"MetLife Stadium, New Jersey",
    home:{ name:"Argentina", short:"ARG", color:"#6cace4" }, away:{ name:"Nigeria", short:"NGA", color:"#008751" },
    type:"top_scorer", question:"Who scores the most goals?", options:["Lionel Messi","Lautaro Martínez","Julián Álvarez","Victor Osimhen"], points:150 },
  { league:"GROUP C", venue:"SoFi Stadium, Los Angeles",
    home:{ name:"France", short:"FRA", color:"#1f3a93" }, away:{ name:"Australia", short:"AUS", color:"#f6c700" },
    type:"total_goals", question:"How many goals in the match?", options:["Under 1.5","2 - 3","4 - 5","Over 5"], points:200 },
  { league:"GROUP F", venue:"Mercedes-Benz Stadium, Atlanta",
    home:{ name:"England", short:"ENG", color:"#243b7a" }, away:{ name:"Netherlands", short:"NED", color:"#f36c21" },
    type:"btts", question:"Both teams to score?", options:["Yes — both score","No"], points:120 },
  { league:"ROUND OF 16", venue:"MetLife Stadium, New Jersey",
    home:{ name:"France", short:"FRA", color:"#1f3a93" }, away:{ name:"England", short:"ENG", color:"#243b7a" },
    type:"winner", question:"Who reaches the quarters?", options:["France","England"], points:100 },
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
