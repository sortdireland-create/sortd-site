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

const HEAD = "'Baloo 2','Trebuchet MS',Verdana,Arial,sans-serif";

// One "what you can do" row: coloured tile with an emoji, title, line.
function featureRow(icon, bg, title, text) {
  return `<tr><td style="padding:0 0 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="44" valign="top" style="width:44px;"><div style="width:36px;height:36px;line-height:36px;border-radius:10px;background:${bg};text-align:center;font-size:18px;">${icon}</div></td>
      <td valign="top" style="font-size:15px;line-height:1.5;color:#27314A;"><strong style="font-family:${HEAD};font-size:16px;">${title}</strong><br><span style="color:#5B6783;">${text}</span></td>
    </tr></table>
  </td></tr>`;
}

// Little sample week, like the /planner landing page.
function weekRow(day, chips) {
  return `<tr><td width="44" valign="top" style="width:44px;padding:4px 0;font-size:12px;font-weight:700;color:#5B6783;">${day}</td><td style="padding:3px 0;">${chips}</td></tr>`;
}
function chip(text, bg, bar, color) {
  return `<span style="display:inline-block;margin:0 4px 4px 0;padding:4px 9px;border-left:3px solid ${bar};border-radius:6px;background:${bg};font-size:13px;font-weight:700;color:${color || '#27314A'};">${text}</span>`;
}

function calendarEmail(firstName, email, link) {
  const name = firstName ? escapeHtml(firstName) : '';
  const open = link || `${SITE_URL}/planner`;
  return emailShell(`
    <p style="margin:0 0 6px;font-family:${HEAD};font-size:28px;font-weight:800;line-height:1.15;color:#27314A;">${name ? `${name}, your` : 'Your'} family's week, <span style="color:#3D77A3;">sorted.</span></p>
    <p style="margin:0 0 18px;font-size:16px;color:#5B6783;">Your free Sortd calendar is ready. One tap and you're in: no password, no app to download.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;background:#E3F1FA;border-radius:16px;"><tr><td style="padding:16px 18px;">
      <p style="margin:0 0 8px;font-family:${HEAD};font-size:16px;font-weight:800;color:#27314A;">This week</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${weekRow('Mon', chip('Inset day · no school', '#FBD7E4', '#D45F86', '#9B3C5E'))}
        ${weekRow('Tue', chip('4pm Swimming', '#ffffff', '#3D77A3'))}
        ${weekRow('Thu', chip('5pm Irish dancing', '#ffffff', '#5B4FCA'))}
        ${weekRow('Sat', chip('10am Ballet', '#ffffff', '#3D77A3') + chip('Day out', '#FFF0C2', '#A6812F'))}
      </table>
    </td></tr></table>

    ${emailButton('Open my calendar →', open).replace('<table role="presentation"', '<table role="presentation" align="center"').replace('margin:24px 0;', 'margin:24px auto;')}
    <p style="margin:-8px 0 26px;font-size:12px;line-height:1.5;color:#5B6783;text-align:center;">${link ? "This button logs you in for 30 days, on any device.<br>Please don't forward it: anyone with it can get into your account." : "Pop your email in on that page and we'll send you a login link."}</p>

    <p style="margin:0 0 12px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5B6783;">What you can do in it</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;">
      ${featureRow('📅', '#E3F1FA', 'Every class, every child', 'Midterms, school holidays and bank holidays already taken out.')}
      ${featureRow('🏫', '#FBD7E4', "Your school's days off", 'Pick your school to see its inset days and half days.')}
      ${featureRow('🎡', '#FFF0C2', 'Days out, sorted', "Add things from What's on to the right weekend in one tap.")}
      ${featureRow('👋', '#C9F0DA', 'Share with other parents', 'See where friends’ kids are going and plan summer camps together.')}
      ${featureRow('📲', '#E7E1F8', 'On your phone too', 'Send the lot to Google, Apple or Outlook calendar.')}
    </table>

    <p style="margin:0 0 18px;padding-top:16px;border-top:1px solid #E4EBF2;font-size:15px;color:#5B6783;">You'll also get the Thursday what's-on email. It's all new, so if anything looks off, just reply. I read every one.</p>
    <p style="margin:0;font-family:'Caveat','Comic Sans MS',cursive;font-size:24px;line-height:1.1;color:#27314A;">Rachel</p>
    <p style="margin:0;font-size:13px;color:#5B6783;">Founder, sortd · a mum in Malahide</p>
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
