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
const SOURCES = new Set(['footer', 'about_page', 'parent_login', 'popup', 'newsletter_page', 'guide_page']);
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

const INSTAGRAM_URL = 'https://www.instagram.com/sortd.ireland/';
const HEAD = "'Baloo 2','Trebuchet MS',Verdana,Arial,sans-serif";

// One "what's on sortd" row: a coloured square tile, a title, a line, a link.
function snapRow(tint, ink, letter, title, text, linkText, url) {
  return `<tr><td style="padding:0 0 16px;vertical-align:top;width:52px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="dm-box" style="width:40px;height:40px;border-radius:12px;background:${tint};color:${ink};text-align:center;font-family:${HEAD};font-weight:800;font-size:18px;line-height:40px;">${letter}</td></tr></table>
</td><td style="padding:0 0 16px;vertical-align:top;font-size:15px;line-height:1.55;">
<strong>${title}</strong><br><span style="color:#5B6783;">${text}</span><br>
<a class="dm-link" href="${url}" style="color:#1B8350;font-weight:700;text-decoration:none;">${linkText} →</a>
</td></tr>`;
}

function welcomeEmail(firstName, email) {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  return emailShell(`
    <p style="margin:0 0 6px;font-family:${HEAD};font-size:24px;font-weight:800;line-height:1.25;">Welcome to the Thursday email</p>
    <p style="margin:0 0 16px;">${hi}</p>
    <p style="margin:0 0 16px;">Thanks for signing up. Every Thursday I'll send one short email with new camps and classes, spaces opening up, and what's on for kids before the weekend. No spam, and you can unsubscribe in one click.</p>
    <p style="margin:0 0 22px;">Your first one lands on Thursday. Until then, here's everything you can do on sortd.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;">
      ${snapRow('#E7E1F8', '#5B4FCA', 'G', 'Monthly guides', "Days out, events and free things to do with the kids, sorted by week. Each one has a free PDF to keep.", 'See the guides', SITE_URL + '/guides')}
      ${snapRow('#DCEBF5', '#3D77A3', 'F', 'Find an activity', 'Holiday camps and weekly classes across Ireland. Search by age, area and dates.', 'Start searching', SITE_URL + '/find-an-activity')}
      ${snapRow('#FBD7E4', '#C66686', 'S', 'Save your favourites', 'Tap the heart on any camp or class to keep a shortlist.', 'Browse camps', SITE_URL + '/camps')}
      ${snapRow('#C9F0DA', '#176B42', 'B', 'Unlock the beta features', 'Add your email on your account page to be first to try the summer planner, family calendar and more. Free.', 'Unlock features', SITE_URL + '/account')}
    </table>

    ${emailButton('See this month\'s guide', SITE_URL + '/guides')}

    <p style="margin:0 0 12px;">For quick updates between emails, we're on Instagram:</p>
    <a class="dm-link" href="${INSTAGRAM_URL}" style="display:inline-block;margin:0 0 22px;padding:11px 22px;border:2px solid #1B8350;border-radius:999px;color:#1B8350;font-family:${HEAD};font-weight:700;font-size:15px;text-decoration:none;">Follow @sortd.ireland</a>

    <p style="margin:0 0 16px;">Know a camp or class that should be on sortd? Just reply to this email and tell me.</p>
    <p style="margin:0;">Rachel<br><span style="color:#5B6783;">Founder, sortd</span></p>
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
        subject: "Welcome to the Thursday email from sortd",
        html: welcomeEmail(firstName.trim().slice(0, 100), email),
      });
    } catch (emailErr) {
      console.error('subscribe welcome email error:', emailErr);
    }
  }

  return json(200, { success: true, isNew: result.isNew });
};

// Exported for previews/tests only.
exports._welcomeEmail = welcomeEmail;
