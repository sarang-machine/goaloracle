/* =========================================================================
   auth.js — email-OTP + Google login, with stateless session tokens.

   - requestOtp(email): emails a 6-digit code and stores it for verification.
   - verifyOtp(email, code): checks it, returns the authenticated user.
   - loginWithGoogle(credential): verifies a Google ID token.
   Accounts are unified by email, so Google and email sign-in land on the same
   account. Swap the email provider (Resend/SMTP) to go live; rest is unchanged.
   ========================================================================= */

import crypto from "node:crypto";
import { getUser, saveUser, findUserByEmail, findUserByGoogle, setOtp, getOtp, clearOtp } from "./store.js";

const SECRET = process.env.AUTH_SECRET || "dev-auth-secret-change-me";
const OTP_TTL_MS = 5 * 60 * 1000;

/* ---- Email provider (mock by default) ---- */
async function sendEmail(email, code) {
  const provider = (process.env.EMAIL_PROVIDER || "mock").toLowerCase();
  if (provider === "mock") {
    console.log(`[email:mock] code for ${email} is ${code}`);
    return { sent: true, devCode: code };           // dev convenience only
  }
  if (provider === "resend") {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not set");
    const from = process.env.EMAIL_FROM || "Goal Oracle <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: "Your Goal Oracle code",
        text: `Your Goal Oracle login code is ${code}. It expires in 5 minutes.` }),
    });
    if (!res.ok) throw new Error("resend HTTP " + res.status);
    return { sent: true };
  }
  throw new Error(`Email provider "${provider}" not configured`);
}

function genCode() { return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"); }
function genInvite() { return crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase(); }
export function normEmail(e) { return String(e || "").trim().toLowerCase(); }
function isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

/* ---- Email OTP flow ---- */
export async function requestOtp(email) {
  email = normEmail(email);
  if (!isEmail(email)) throw new Error("enter a valid email address");
  const code = genCode();
  await setOtp(email, { code, expires: Date.now() + OTP_TTL_MS });
  const res = await sendEmail(email, code);
  // In mock mode we return devCode so the UI can prefill it; never in prod.
  return { ok: true, devCode: (process.env.EMAIL_PROVIDER || "mock") === "mock" ? res.devCode : undefined };
}

export async function verifyOtp(email, code) {
  email = normEmail(email);
  const rec = await getOtp(email);
  if (!rec) throw new Error("no code requested for this email");
  if (Date.now() > rec.expires) { await clearOtp(email); throw new Error("code expired — request a new one"); }
  if (String(code) !== rec.code) throw new Error("incorrect code");
  await clearOtp(email);

  // Find or create the account for this email (shared with Google sign-in).
  let user = await findUserByEmail(email);
  if (!user) {
    const userId = "u_" + crypto.randomBytes(6).toString("hex");
    user = await getUser(userId);
    user.email = email;
    user.inviteCode = genInvite();
    user.name = user.name || email.split("@")[0];
    user.friends = user.friends || [];
    await saveUser(user);
  }
  return { user, token: signToken(user.userId) };
}

/* ---- Google Sign-In / One Tap ----
   The browser's Google button returns an ID token (a JWT). We verify it and
   find-or-create the matching account. With no GOOGLE_CLIENT_ID set we run in
   dev/mock mode and accept a "mock.<base64 json>" credential so the whole flow
   is testable without a real Google project. */
export async function loginWithGoogle(credential) {
  const profile = await verifyGoogle(credential);
  if (!profile?.sub) throw new Error("could not read Google profile");

  const email = normEmail(profile.email);
  let user = await findUserByGoogle(profile.sub);
  // Same email signed in via email-OTP before? Link Google to that account.
  if (!user && email) {
    user = await findUserByEmail(email);
    if (user && !user.googleId) { user.googleId = profile.sub; await saveUser(user); }
  }
  if (!user) {
    const userId = "u_" + crypto.randomBytes(6).toString("hex");
    user = await getUser(userId);
    user.googleId = profile.sub;
    user.email = email || null;
    user.name = user.name || profile.name || (email ? email.split("@")[0] : "Player");
    user.inviteCode = genInvite();
    user.friends = user.friends || [];
    await saveUser(user);
  }
  return { user, token: signToken(user.userId) };
}

async function verifyGoogle(credential) {
  if (!credential) throw new Error("missing Google credential");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const mockMode = !clientId || process.env.GOOGLE_AUTH === "mock";

  // Dev/mock credential — only honoured when not in real-client mode.
  if (credential.startsWith("mock.")) {
    if (!mockMode) throw new Error("mock Google credential rejected (GOOGLE_CLIENT_ID is set)");
    try { return JSON.parse(Buffer.from(credential.slice(5), "base64url").toString("utf8")); }
    catch { throw new Error("malformed mock credential"); }
  }
  if (mockMode) throw new Error("Google login not configured — set GOOGLE_CLIENT_ID");

  // Real verification via Google's official library.
  let OAuth2Client;
  try { ({ OAuth2Client } = await import("google-auth-library")); }
  catch { throw new Error("google-auth-library not installed — run `npm install`"); }
  const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken: credential, audience: clientId });
  const p = ticket.getPayload();
  return { sub: p.sub, email: p.email, name: p.name, picture: p.picture };
}

/* ---- Stateless tokens ---- */
export function signToken(userId) {
  const body = Buffer.from(userId).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { return Buffer.from(body, "base64url").toString("utf8"); } catch { return null; }
}

/* Express helper: pull a verified userId from the Authorization header. */
export function authUserId(req) {
  const h = req.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? verifyToken(m[1]) : null;
}

export { genInvite };
