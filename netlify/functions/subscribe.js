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

const SITE_URL = 'https://sortd-ireland.ie';
const SOURCES = new Set(['footer', 'about_page', 'parent_login']);
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
      sender: { name: 'sortd', email: 'hello@sortd-ireland.ie' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) console.error('Brevo welcome email failed:', await res.text());
}

// ── Branded email shell — matches sortd-brand-foundations:
// muted palette (navy #293148, blue #4782A8 accent, NEVER red),
// Baloo 2 for headings/logo, Nunito for body, ~18px card radius,
// rounded corners only (never circles). Same shell as the other
// transactional emails, kept in sync manually. ──
function emailShell(innerHtml, unsubscribeUrl) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@400;600;700;800&family=Caveat:wght@600&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#F7F7F7;font-family:'Nunito',Verdana,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F7F7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 4px 20px rgba(41,49,72,.08);">
<tr><td style="background:#293148;padding:24px 32px;text-align:center;">
<span style="font-family:'Baloo 2',Verdana,sans-serif;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:.5px;">sortd</span>
</td></tr>
<tr><td style="padding:32px;color:#293148;font-size:15px;font-family:'Nunito',Verdana,Arial,sans-serif;font-weight:600;line-height:1.6;">
${innerHtml}
</td></tr>
<tr><td style="background:#293148;padding:20px 32px;text-align:center;">
<p style="margin:0;font-size:12px;color:#D1E9F5;font-family:'Nunito',Verdana,Arial,sans-serif;">sortd · Dublin, Ireland<br>
<a href="https://sortd-ireland.ie" style="color:#D1E9F5;text-decoration:none;font-weight:700;">sortd-ireland.ie</a></p>
<p style="margin:10px 0 0;font-size:11px;color:#8fa5b8;font-family:'Nunito',Verdana,Arial,sans-serif;">Questions? <a href="mailto:hello@sortd-ireland.ie" style="color:#8fa5b8;text-decoration:underline;">hello@sortd-ireland.ie</a> · <a href="https://sortd-ireland.ie/privacy-policy" style="color:#8fa5b8;text-decoration:underline;">Privacy Policy</a></p>
${unsubscribeUrl ? `<p style="margin:6px 0 0;font-size:11px;color:#8fa5b8;font-family:'Nunito',Verdana,Arial,sans-serif;"><a href="${unsubscribeUrl}" style="color:#8fa5b8;text-decoration:underline;">Unsubscribe</a> from the Thursday email</p>` : ''}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function welcomeEmail(firstName, email) {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  return emailShell(`
    <p style="margin:0 0 16px;">${hi}</p>
    <p style="margin:0 0 16px;">You're on the list. Thanks for signing up.</p>
    <p style="margin:0 0 16px;">Every Thursday I'll send one short email: new camps and classes, spaces opening up, and anything worth knowing before the weekend. No spam, and you can unsubscribe in one click.</p>
    <p style="margin:0 0 16px;">Your first one lands next Thursday. In the meantime, <a href="${SITE_URL}" style="color:#4782A8;font-weight:700;text-decoration:none;">have a browse</a>.</p>
    <p style="margin:16px 0 0;font-family:'Caveat',cursive;font-size:20px;color:#4782A8;">Rachel, sortd →</p>
  `, `${SITE_URL}/.netlify/functions/unsubscribe?email=${encodeURIComponent(email)}`);
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
