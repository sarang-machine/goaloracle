/* =========================================================================
   auth.js — phone-OTP login + stateless session tokens.

   - requestOtp(phone): generates a 6-digit code, "sends" it via the SMS
     provider, and stores it (hashed window) for verification.
   - verifyOtp(phone, code): checks the code, returns the authenticated user.
   - signToken(userId) / verifyToken(token): stateless HMAC session tokens
     (no session store needed). Swap the SMS provider for Twilio / MSG91 to
     go live; the rest is unchanged.
   ========================================================================= */

import crypto from "node:crypto";
import { getUser, saveUser, findUserByPhone, findUserByGoogle, setOtp, getOtp, clearOtp } from "./store.js";

const SECRET = process.env.AUTH_SECRET || "dev-auth-secret-change-me";
const OTP_TTL_MS = 5 * 60 * 1000;

/* ---- SMS provider (mock by default) ---- */
async function sendSms(phone, code) {
  const provider = (process.env.SMS_PROVIDER || "mock").toLowerCase();
  if (provider === "mock") {
    console.log(`[sms:mock] OTP for ${phone} is ${code}`);
    return { sent: true, devCode: code };           // dev convenience only
  }
  // e.g. MSG91 / Twilio would POST to their API here using process.env keys.
  throw new Error(`SMS provider "${provider}" not configured`);
}

function genCode() { return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"); }
function genInvite() { return crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase(); }
function normPhone(p) { return String(p || "").replace(/[^\d+]/g, ""); }

/* ---- OTP flow ---- */
export async function requestOtp(phone) {
  phone = normPhone(phone);
  if (phone.length < 7) throw new Error("invalid phone number");
  const code = genCode();
  await setOtp(phone, { code, expires: Date.now() + OTP_TTL_MS });
  const res = await sendSms(phone, code);
  // In mock mode we return devCode so the UI can prefill it; never in prod.
  return { ok: true, devCode: (process.env.SMS_PROVIDER || "mock") === "mock" ? res.devCode : undefined };
}

export async function verifyOtp(phone, code) {
  phone = normPhone(phone);
  const rec = await getOtp(phone);
  if (!rec) throw new Error("no code requested for this number");
  if (Date.now() > rec.expires) { await clearOtp(phone); throw new Error("code expired — request a new one"); }
  if (String(code) !== rec.code) throw new Error("incorrect code");
  await clearOtp(phone);

  // Find or create the account for this phone.
  let user = await findUserByPhone(phone);
  if (!user) {
    const userId = "u_" + crypto.randomBytes(6).toString("hex");
    user = await getUser(userId);
    user.phone = phone;
    user.inviteCode = genInvite();
    user.name = user.name || ("Player" + phone.slice(-4));
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

  let user = await findUserByGoogle(profile.sub);
  if (!user) {
    const userId = "u_" + crypto.randomBytes(6).toString("hex");
    user = await getUser(userId);
    user.googleId = profile.sub;
    user.email = profile.email || null;
    user.name = user.name || profile.name || (profile.email ? profile.email.split("@")[0] : "Player");
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
