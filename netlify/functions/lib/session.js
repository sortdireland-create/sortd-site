// netlify/functions/lib/session.js
//
// Minimal signed-cookie session helper for PARENT accounts (sortd-ireland.ie
// itself — not the provider portal, which is a separate repo/deployment
// with its own lib/auth.js). Deliberately zero npm dependencies, matching
// every other function in this repo (subscribe.js, claim-listing.js, etc.
// only ever use Node's built-in `crypto` and global `fetch`) — this repo
// has no package.json today, so pulling in `jsonwebtoken` would mean
// adding a build step that doesn't otherwise exist here.
//
// What this is: a JSON payload, base64url-encoded, with an HMAC-SHA256
// signature appended — functionally the same guarantee as a JWT (can't be
// forged or tampered with without the secret) without the library. Not a
// generic JWT implementation, just enough for one cookie holding one email
// and one expiry.
//
// Cookie name (sortd_session) and secret env var (PARENT_SESSION_SECRET)
// are both intentionally different from the provider portal's
// sortd_provider_session / SESSION_SECRET, so the two systems can never
// read or be confused with each other's sessions — they don't even share
// a cookie domain (this runs on sortd-ireland.ie, the portal on
// portal.sortd-ireland.ie) but keeping the names/secrets distinct too
// means a future change to one can't accidentally affect the other.
//
// Requires: PARENT_SESSION_SECRET (set in Netlify env vars — any long
// random string, e.g. `openssl rand -hex 32`)

const crypto = require('crypto');

const COOKIE_NAME = 'sortd_session';
// Separate, non-HttpOnly marker cookie — carries no auth power on its own
// (it's just the string "1"), but lets client-side JS (js/account.js) show
// "My account" vs "Log in" in the nav without a server round-trip and
// without ever exposing the real session cookie to JS. Every action that
// actually matters still checks the HttpOnly cookie above, server-side.
const FLAG_COOKIE_NAME = 'sortd_logged_in';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.PARENT_SESSION_SECRET;
  if (!secret) throw new Error('Missing PARENT_SESSION_SECRET env var.');
  return secret;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function sign(payloadB64) {
  return base64url(crypto.createHmac('sha256', getSecret()).update(payloadB64).digest());
}

// Returns the two Set-Cookie header values (session + display flag) for a
// successful login. Netlify's classic Lambda-compat handler only supports
// one 'Set-Cookie' string per response via the `headers` object, so
// callers use `multiValueHeaders` — see verify-login.js.
function createSessionCookies(email) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payloadB64 = base64url(JSON.stringify({ email, exp }));
  const sig = sign(payloadB64);
  const sessionCookie = `${COOKIE_NAME}=${payloadB64}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
  const flagCookie = `${FLAG_COOKIE_NAME}=1; Path=/; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
  return [sessionCookie, flagCookie];
}

function clearSessionCookies() {
  return [
    `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    `${FLAG_COOKIE_NAME}=; Path=/; Secure; SameSite=Lax; Max-Age=0`,
  ];
}

function parseCookies(cookieHeader) {
  const out = {};
  (cookieHeader || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// Returns { email } if the request carries a valid, unexpired, correctly
// signed session cookie — otherwise null. Any malformed/tampered/expired
// cookie is treated as "not logged in" rather than an error.
function getSessionFromEvent(event) {
  const cookieHeader = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
  const value = parseCookies(cookieHeader)[COOKIE_NAME];
  if (!value) return null;

  const dotIndex = value.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const payloadB64 = value.slice(0, dotIndex);
  const sig = value.slice(dotIndex + 1);

  let expectedSig;
  try {
    expectedSig = sign(payloadB64);
  } catch (e) {
    return null; // e.g. PARENT_SESSION_SECRET not set
  }

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  } catch (e) {
    return null;
  }

  if (!payload.email || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return { email: payload.email };
}

module.exports = {
  COOKIE_NAME,
  FLAG_COOKIE_NAME,
  createSessionCookies,
  clearSessionCookies,
  getSessionFromEvent,
};
