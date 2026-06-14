/* One-shot resolver — run from cron, GitHub Actions, or by hand.
   Usage:  node scripts/resolve.js [YYYY-MM-DD]
   With no date it resolves every due challenge. */

import "dotenv/config";
import { resolveDay, resolveDue } from "../src/resolver.js";
import { dateKey } from "../src/challenges.js";

const date = process.argv[2];
const out = date ? [await resolveDay(date)] : await resolveDue();
console.log(JSON.stringify({ ran: date || "all-due", at: dateKey(), results: out }, null, 2));
process.exit(0);
