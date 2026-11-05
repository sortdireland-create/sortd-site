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

const PHOTO_URL = SITE_URL + '/images/rachel-ella-email.jpg';
const BODY = "'Nunito','Trebuchet MS',Verdana,Arial,sans-serif";

// A coloured module: rounded tinted block. Gmail keeps tints as-is; Apple
// Mail/Outlook.com dark mode gets the dm-box-* overrides from email-shell.
function module(bg, inner, extraStyle) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr><td class="dm-box" style="background:${bg};border-radius:18px;padding:22px 22px;${extraStyle || ''}">${inner}</td></tr></table>`;
}

// One tile in the 2x2 grid.
function tile(bg, ink, title, text, linkText, url) {
  return `<td class="dm-box" width="48%" style="width:48%;background:${bg};border-radius:16px;padding:18px 16px;vertical-align:top;">
<p style="margin:0 0 4px;font-family:${HEAD};font-weight:800;font-size:17px;line-height:1.25;color:${ink};">${title}</p>
<p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#1E2A44;">${text}</p>
<a href="${url}" style="font-family:${HEAD};font-weight:700;font-size:14px;color:${ink};text-decoration:none;">${linkText}&nbsp;→</a>
</td>`;
}
const TILE_GAP = '<td width="4%" style="width:4%;font-size:0;line-height:0;">&nbsp;</td>';

function pill(text, url, bg, color) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 0;"><tr><td style="border-radius:999px;background:${bg};">
<a href="${url}" style="display:inline-block;padding:12px 24px;color:${color};font-family:${HEAD};font-weight:700;font-size:15px;text-decoration:none;border-radius:999px;">${text}</a>
</td></tr></table>`;
}

function welcomeEmail(firstName, email) {
  const hi = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  return emailShell(`
    ${module('#CFE8F6', `
      <p style="margin:0 0 6px;font-family:${HEAD};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#3D77A3;">You're on the list</p>
      <p style="margin:0 0 10px;font-family:${HEAD};font-size:26px;font-weight:800;line-height:1.2;color:#1E2A44;">Welcome to the Thursday email</p>
      <p style="margin:0 0 10px;color:#1E2A44;">${hi}</p>
      <p style="margin:0;color:#1E2A44;">Every Thursday I'll send one short email: new camps and classes, spaces opening up, and what's on for kids before the weekend. Your first one lands on Thursday. No spam, and you can unsubscribe in one click.</p>
    `)}

    ${module('#E7E1F8', `
      <p style="margin:0 0 6px;font-family:${HEAD};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5B4FCA;">This month's guide</p>
      <p style="margin:0 0 8px;font-family:${HEAD};font-size:21px;font-weight:800;line-height:1.25;color:#1E2A44;">Things to do with the kids, sorted by week</p>
      <p style="margin:0;font-size:15px;line-height:1.55;color:#1E2A44;">Days out, events and plenty of free things to do, checked against each venue. Read it online or keep the free PDF. Every past guide lives on one page too.</p>
      ${pill("See the guides", SITE_URL + '/guides', '#5B4FCA', '#ffffff')}
    `)}

    <p style="margin:18px 0 10px;font-family:${HEAD};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5B6783;">Everything on sortd</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;table-layout:fixed;">
      <tr>
        ${tile('#DCEBF5', '#2F6189', 'Find an activity', 'Holiday camps and weekly classes across Ireland, by age, area and dates.', 'Start searching', SITE_URL + '/find-an-activity')}
        ${TILE_GAP}
        ${tile('#FBD7E4', '#B04A70', 'Save favourites', 'Tap the heart on any camp or class to keep a shortlist.', 'Browse camps', SITE_URL + '/camps')}
      </tr>
      <tr><td colspan="3" style="height:12px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        ${tile('#C9F0DA', '#176B42', 'Beta features', 'Be first to try the summer planner and family calendar. Free.', 'Unlock features', SITE_URL + '/account')}
        ${TILE_GAP}
        ${tile('#FFF2CC', '#8A5A12', 'Weekly classes', 'Swimming, drama, football, art and more, every week of term.', 'See classes', SITE_URL + '/weekly-classes')}
      </tr>
    </table>

    ${module('#FFFFFF', `
      <p style="margin:0 0 4px;font-family:${HEAD};font-size:18px;font-weight:800;color:#1E2A44;">Follow along on Instagram</p>
      <p style="margin:0;font-size:15px;line-height:1.55;color:#1E2A44;">New camps, last-minute spaces and the odd behind-the-scenes, between emails.</p>
      ${pill('Follow @sortd.ireland', INSTAGRAM_URL, '#1B8350', '#ffffff')}
    `, 'border:2px solid #C9F0DA;')}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr>
      <td width="96" style="width:96px;vertical-align:top;padding-right:16px;">
        <img src="${PHOTO_URL}" width="96" height="96" alt="Rachel and her daughter Ella with ice creams in Malahide" style="display:block;width:96px;height:96px;border-radius:20px;border:0;">
      </td>
      <td style="vertical-align:top;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 8px;">Know a camp or class that should be on sortd? Just reply to this email and tell me.</p>
        <p style="margin:0;">Rachel<br><span style="color:#5B6783;">Founder, sortd, and mum to Ella</span></p>
      </td>
    </tr></table>
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
