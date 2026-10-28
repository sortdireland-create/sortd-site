// Netlify serverless function — early access sign-ups for the Sortd family
// calendar, sent by ManyChat (Instagram comment "EARLY" → DM → email).
//
// ManyChat calls this with an External Request after the email question:
//   POST https://sortd-ireland.ie/.netlify/functions/early-access
//   Header  X-Sortd-Key: <MANYCHAT_SECRET>
//   Body    {"email": "...", "first_name": "...", "ig_username": "...", "consent": true}
//
// The contact goes on the same Brevo newsletter list as every other sign-up
// (lib/brevo-newsletter.js), with SIGNUP_SOURCE = instagram_early_access and
// EARLY_ACCESS = calendar, so a Brevo segment on EARLY_ACCESS is the launch
// list. New contacts get a short "you're on the list" email.
//
// Requires: BREVO_API_KEY, MANYCHAT_SECRET (Netlify env, production).
// Consent: the DM tells people they're joining early access and the weekly
// email before asking for their address; that wording is stored as the
// consent record below. ManyChat must send consent: true.

const { addNewsletterContact } = require('./lib/brevo-newsletter');
const { emailShell, emailButton } = require('./lib/email-shell');

const SITE_URL = 'https://sortd-ireland.ie';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONSENT_TEXT = "Instagram DM: Pop your email below and you'll be first in when the Sortd family calendar opens. We'll also send you our weekly what's-on email (unsubscribe any time).";

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function welcomeEmail(firstName, email) {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  return emailShell(`
    <p style="margin:0 0 16px;">${hi}</p>
    <p style="margin:0 0 16px;">You're on the early access list for the Sortd family calendar. I'll email you as soon as it opens.</p>
    <p style="margin:0 0 16px;">It puts your kids' weekly classes, school holidays, days out and summer camps in one calendar, and sends the lot to Google Calendar. Free for parents.</p>
    <p style="margin:0 0 4px;">You'll also get the Thursday what's-on email. In the meantime, have a browse:</p>
    ${emailButton('Find an activity', SITE_URL + '/find-an-activity')}
    <p style="margin:0;">Rachel<br>sortd</p>
  `, `${SITE_URL}/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}`, { audience: 'parent', eyebrow: 'Early access' });
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ sender: { name: 'Rachel at Sortd', email: 'hello@sortd-ireland.ie' }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!res.ok) console.error('early-access welcome email failed:', await res.text());
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const secret = process.env.MANYCHAT_SECRET;
  const given = event.headers['x-sortd-key'] || event.headers['X-Sortd-Key'];
  if (!secret) { console.error('early-access: MANYCHAT_SECRET not set'); return json(500, { success: false, error: 'not_configured' }); }
  if (given !== secret) return json(401, { success: false, error: 'unauthorised' });

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { success: false, error: 'bad_json' }); }

  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_RE.test(email) || email.length > 254) return json(400, { success: false, error: 'invalid_email' });
  const consent = data.consent === true || data.consent === 'true';
  if (!consent) return json(400, { success: false, error: 'no_consent' });

  const firstName = typeof data.first_name === 'string' ? data.first_name.trim().slice(0, 100) : '';
  const ig = typeof data.ig_username === 'string' ? data.ig_username.replace(/^@/, '').slice(0, 60) : '';

  const result = await addNewsletterContact({
    email,
    firstName,
    source: 'instagram_early_access',
    consentText: CONSENT_TEXT,
    pageUrl: ig ? `https://instagram.com/${ig}` : 'instagram',
    extra: { EARLY_ACCESS: 'calendar' },
  });
  if (!result.ok) return json(502, { success: false, error: 'brevo_failed' });

  if (result.isNew) {
    try { await sendEmail({ to: email, subject: "You're on the early access list", html: welcomeEmail(firstName, email) }); }
    catch (e) { console.error('early-access welcome email error:', e); }
  }
  return json(200, { success: true, isNew: result.isNew });
};
