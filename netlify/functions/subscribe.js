// Netlify serverless function — sortd newsletter signup → Brevo
// Place this file at: netlify/functions/subscribe.js
//
// Handles every public "get the Thursday email" form (site footer on every
// page, and the About page). Adds the person to the Brevo newsletter list
// with a consent record (when, what wording, which page), then sends a
// one-off welcome email through Brevo's transactional API.
//
// Previously wrote to Customer.io; moved to Brevo (Oct 2026) so the list and
// the sending tool are the same place. The shared Brevo code lives in
// lib/brevo-newsletter.js.
//
// Requires: BREVO_API_KEY. Optional: BREVO_NEWSLETTER_LIST_ID (see the lib).
//
// Consent: the request must say consent === true. The forms enforce that
// with a required, unticked checkbox; this check is the server-side backstop
// so nothing can sign someone up without it.

const { addNewsletterContact } = require('./lib/brevo-newsletter');
const { emailShell, emailButton } = require('./lib/email-shell');

const SITE_URL = 'https://sortd-ireland.ie';
const SOURCES = new Set(['footer', 'about_page', 'parent_login', 'popup', 'newsletter_page']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) { console.warn('BREVO_API_KEY not set — skipping welcome email to', to); return; }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Rachel at Sortd', email: 'hello@sortd-ireland.ie' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) console.error('Brevo welcome email failed:', await res.text());
}

function welcomeEmail(firstName, email) {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  return emailShell(`
    <p style="margin:0 0 16px;">${hi}</p>
    <p style="margin:0 0 16px;">You're on the list. Thanks for signing up.</p>
    <p style="margin:0 0 16px;">Every Thursday I'll send one short email: new camps and classes, spaces opening up, and anything worth knowing before the weekend. No spam, and you can unsubscribe in one click.</p>
    <p style="margin:0 0 4px;">Your first one lands next Thursday. In the meantime, have a browse:</p>
    ${emailButton('Browse camps and classes', SITE_URL)}
    <p style="margin:0;">Rachel<br>sortd</p>
  `, `${SITE_URL}/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}`, { audience: 'parent', eyebrow: 'The Thursday email' });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try {
    if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
      data = JSON.parse(event.body);
    } else {
      data = Object.fromEntries(new URLSearchParams(event.body));
    }
  } catch (e) {
    return json(400, { error: 'Invalid request body' });
  }

  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return json(400, { error: 'Please enter a valid email address' });
  }

  // Consent backstop. The forms send consent: true only when the box is
  // ticked; form-encoded posts send the string "true"/"on".
  const consent = data.consent === true || data.consent === 'true' || data.consent === 'on';
  if (!consent) {
    return json(400, { error: 'Please tick the box to confirm you want the email' });
  }

  const source = SOURCES.has(data.source) ? data.source : 'footer';
  const firstName = typeof data['first-name'] === 'string' ? data['first-name'] : (typeof data.firstName === 'string' ? data.firstName : '');
  const county = typeof data.county === 'string' ? data.county : '';

  const result = await addNewsletterContact({
    email,
    firstName,
    county,
    source,
    consentText: typeof data.consentText === 'string' ? data.consentText : '',
    pageUrl: typeof data.pageUrl === 'string' ? data.pageUrl : '',
  });

  if (!result.ok) {
    return json(502, { error: 'Something went wrong on our side. Please try again.' });
  }

  // Welcome email for brand-new subscribers only, so re-submitting the form
  // doesn't send it again. Best-effort: never fail the sign-up over it.
  if (result.isNew) {
    try {
      await sendEmail({
        to: email,
        subject: "You're on the list",
        html: welcomeEmail(firstName.trim().slice(0, 100), email),
      });
    } catch (emailErr) {
      console.error('subscribe welcome email error:', emailErr);
    }
  }

  return json(200, { success: true, isNew: result.isNew });
};
