/* Publish today's challenge immediately.
   Usage:  node scripts/seed.js [lockSeconds] [resultSeconds]
   Defaults to lock in 30s / result in 90s so you can watch the full
   automatic flow quickly. */

import "dotenv/config";
import { buildChallenge } from "../src/challenges.js";
import { saveChallenge } from "../src/store.js";

const lockSec = Number(process.argv[2] ?? 30);
const resultSec = Number(process.argv[3] ?? 90);
const now = Date.now();

const ch = await saveChallenge(buildChallenge(new Date(), {
  lockTime: new Date(now + lockSec * 1000).toISOString(),
  resultTime: new Date(now + resultSec * 1000).toISOString(),
}));

console.log(`Published ${ch.date}: ${ch.home.short} v ${ch.away.short} — "${ch.question}"`);
console.log(`  locks at  ${ch.lockTime}`);
console.log(`  resolves  ${ch.resultTime}`);
process.exit(0);
