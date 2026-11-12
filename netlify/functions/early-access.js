// Netlify serverless function — Instagram sign-ups for the Sortd family
// calendar, sent by ManyChat (Instagram comment "CALENDAR" or the older
// "EARLY" → DM → email).
//
// The calendar is open to everyone now (Nov 2026), so this no longer puts
// people on an early access list. It:
//   1. adds them to the Brevo newsletter list (they agreed in the DM), and
//   2. emails them a login button that creates their free account and opens
//      their calendar at /planner (a normal 30-day parent login link).
//
// ManyChat calls this with an External Request after the email question
// (URL unchanged, so the ManyChat request doesn't need editing):
//   POST https://sortd-ireland.ie/.netlify/functions/early-access
//   Header  X-Sortd-Key: <MANYCHAT_SECRET>
//   Body    {"email": "...", "first_name": "...", "ig_username": "...", "consent": true}
//
// Requires: AIRTABLE_API_KEY, BREVO_API_KEY, MANYCHAT_SECRET (Netlify env).
// Consent: CONSENT_TEXT must match the wording of the DM that asks for the
// email; it is stored as the consent record. ManyChat must send consent: true.

const crypto = require('crypto');
const { addNewsletterContact } = require('./lib/brevo-newsletter');
const { emailShell, emailButton } = require('./lib/email-shell');

const SITE_URL = 'https://sortd-ireland.ie';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONSENT_TEXT = "Instagram DM: Pop your email below and I'll send you a link to your free Sortd calendar. You'll also get our weekly what's-on email (unsubscribe any time).";

// Same table and lifetime as request-login.js (parent login links).
const BASE_ID = 'appuyWkAmTRI4lN5r';
const LOGIN_TOKENS_TABLE_ID = 'tbliAI9vbuHyZdT9K';
const TOKEN_TTL_MINUTES = 60 * 24 * 30;

function json(statusCode, obj) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function createLoginLink(email) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) return null;
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const now = new Date();
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${LOGIN_TOKENS_TABLE_ID}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields: {
      Email: email, Token: token, CreatedAt: now.toISOString(),
      ExpiresAt: new Date(now.getTime() + TOKEN_TTL_MINUTES * 60000).toISOString(),
      Used: false, NewsletterOptIn: true,
    } }] }),
  });
  if (!res.ok) { console.error('early-access: login token write failed:', await res.text()); return null; }
  return `${SITE_URL}/.netlify/functions/verify-login?token=${token}&next=${encodeURIComponent('/planner')}`;
}

function calendarEmail(firstName, email, link) {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const open = link || `${SITE_URL}/planner`;
  return emailShell(`
    <p style="margin:0 0 16px;">${hi}</p>
    <p style="margin:0 0 16px;">Your free Sortd calendar is ready. Tap below and you're in: no password, no app to download.</p>
    ${emailButton('Open my calendar →', open)}
    <p style="margin:-8px 0 20px;font-size:13px;color:#5B6783;">${link ? "The button logs you in for the next 30 days, on any device. Please don't forward this email: anyone with the button can get into your account." : 'Pop your email in on that page and we\'ll send you a login link.'}</p>
    <p style="margin:0 0 8px;"><strong>What you can do in it:</strong></p>
    <p style="margin:0 0 16px;line-height:1.8;">
      Add your kids' weekly classes, with midterms and bank holidays already taken out<br>
      Pick your school and see its inset days and half days<br>
      Add days out from our What's on page in one tap<br>
      Share with other parents and plan summer camps together<br>
      Send the lot to Google, Apple or Outlook
    </p>
    <p style="margin:0 0 16px;">You'll also get the Thursday what's-on email. If anything looks off, just reply to this email.</p>
    <p style="margin:0;">Rachel<br>sortd</p>
  `, `${SITE_URL}/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}`, { audience: 'parent', eyebrow: 'Your calendar' });
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ sender: { name: 'Rachel at Sortd', email: 'hello@sortd-ireland.ie' }, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!res.ok) console.error('early-access calendar email failed:', await res.text());
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
    source: 'instagram_calendar',
    consentText: CONSENT_TEXT,
    pageUrl: ig ? `https://instagram.com/${ig}` : 'instagram',
    extra: { EARLY_ACCESS: 'calendar' },
  });
  if (!result.ok) return json(502, { success: false, error: 'brevo_failed' });

  // Everyone who asks gets their calendar link, new or already subscribed.
  try {
    const link = await createLoginLink(email);
    await sendEmail({ to: email, subject: 'Your free Sortd calendar is ready', html: calendarEmail(firstName, email, link) });
  } catch (e) { console.error('early-access calendar email error:', e); }

  return json(200, { success: true, isNew: result.isNew });
};
