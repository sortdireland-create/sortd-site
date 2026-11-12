// netlify/functions/request-login.js
// Handles "send me a login link" at sortd-ireland.ie/login
//
// POST {email} → writes a one-time token to the "Parent Login Tokens"
// Airtable table and emails a magic link. Always returns the same
// generic success response for any validly-formatted email, since
// signup is open to anyone (no newsletter-subscriber gate, no checking
// whether an account already exists) — unlike the provider portal's
// request-link.js, which only sends a link if the email matches an
// existing listing's Provider Email.
//
// The "Parent Login Tokens" table is deliberately separate from the
// provider portal's "Login Tokens" table (tblR2PKvtvhV016jN) — see
// netlify/functions/lib/session.js for why. A token from this table can
// only ever be consumed by verify-login.js below, never by the portal's
// verify-link.js, and vice versa.
//
// Requires these Netlify env vars (same ones already used by
// subscribe.js / claim-listing.js / submit-listing.js):
//   AIRTABLE_API_KEY
//   BREVO_API_KEY

const crypto = require('crypto');
const { emailShell, emailButton, emailBox } = require('./lib/email-shell');

const BASE_ID = 'appuyWkAmTRI4lN5r';
const LOGIN_TOKENS_TABLE_ID = 'tbliAI9vbuHyZdT9K'; // "Parent Login Tokens"
const LT = {
  EMAIL: 'Email',
  TOKEN: 'Token',
  CREATED_AT: 'CreatedAt',
  EXPIRES_AT: 'ExpiresAt',
  USED: 'Used',
  NEWSLETTER_OPT_IN: 'NewsletterOptIn',
};

// Parent login links last 30 days and can be reused within that time
// (see verify-login.js).
const TOKEN_TTL_MINUTES = 60 * 24 * 30;
const SITE_URL = 'https://sortd-ireland.ie';
const INSTAGRAM_URL = 'https://www.instagram.com/sortd.ireland/';

// Secondary CTA: outlined pill, so the login button stays the main action.
function outlineButton(text, url) {
  return `<a class="dm-link" href="${url}" style="display:inline-block;margin:0 8px 10px 0;padding:11px 22px;border:2px solid #1B8350;border-radius:999px;color:#1B8350;font-family:'Baloo 2','Trebuchet MS',Verdana,Arial,sans-serif;font-weight:700;font-size:15px;text-decoration:none;">${text}</a>`;
}

function featureRow(title, text) {
  return `<tr><td style="padding:0 0 10px;font-size:15px;line-height:1.55;"><strong>${title}</strong><br><span style="color:#5B6783;">${text}</span></td></tr>`;
}

// Sent for every parent login request.
// Login link first, then what the account does, then the calendar,
// then Instagram and the Thursday email (its own sign-up on /newsletter).
function unlockWelcomeHtml(link) {
  return emailShell(`
    <p style="margin:0 0 6px;font-family:'Baloo 2','Trebuchet MS',Verdana,Arial,sans-serif;font-size:24px;font-weight:800;line-height:1.25;">You're in. Welcome to sortd.</p>
    <p style="margin:0 0 4px;">Thanks for unlocking your account. Tap below to log in, and your saved camps and classes will follow you to any device.</p>
    ${emailButton('Log me in →', link)}
    <p style="margin:-8px 0 26px;font-size:13px;color:#5B6783;">This button logs you in any time for the next 30 days, on any device. For your security it stops working after that, and you can get a new one any time at <a class="dm-link" href="${SITE_URL}/account" style="color:#1B8350;">sortd-ireland.ie/account</a>. Please don't forward this email: anyone with the button can get into your account.</p>

    <p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5B6783;">Ready now</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
      ${featureRow('Save camps and classes', 'Tap the heart on any listing and it is kept in your account.')}
      ${featureRow('Find an activity', 'Holiday camps and weekly classes across Ireland, by age, area and dates.')}
      ${featureRow("What's on this month", 'Our free monthly guide to days out and things to do with the kids.')}
    </table>

    ${emailBox(`
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5B4FCA;">Your Sortd calendar</p>
      <p style="margin:0 0 10px;line-height:1.6;">Free with your account, and ready to use now:</p>
      <p style="margin:0 0 10px;line-height:1.9;">
        <strong>Family calendar</strong>: classes, days out and camps for each child<br>
        <strong>School days off</strong>: midterms and bank holidays built in, plus your own school's days off<br>
        <strong>Summer planner</strong>: plan the summer week by week, with drop-offs and pick-ups<br>
        <strong>Friends</strong>: see which camps your friends' kids are going to<br>
        <strong>Add to your calendar</strong>: Google, Apple or Outlook<br>
        <strong>Costs and annual leave</strong>: what the summer costs, and the days off you'll need
      </p>
      <div style="margin:0 0 12px;">${outlineButton('Open my calendar', SITE_URL + '/planner')}</div>
      <p style="margin:0;line-height:1.6;">It's new, so if anything looks off, just reply to this email.</p>
    `, 'provider')}

    <p style="margin:6px 0 12px;">Want to hear what's new first?</p>
    <div style="margin:0 0 18px;">
      ${outlineButton('Follow @sortd.ireland', INSTAGRAM_URL)}
      ${outlineButton('Get the Thursday email', SITE_URL + '/newsletter')}
    </div>

    <p style="margin:0;">Rachel<br><span style="color:#5B6783;">Founder, sortd</span></p>
  `, null, { audience: 'parent', eyebrow: 'Features unlocked' });
}

// The login email itself: short, 1 button, no emoji, plus a plain-text
// part. Microsoft (Hotmail/Outlook/Live) was silently not accepting the
// longer welcome email (5 buttons, emoji subject) in Nov 2026, while Gmail
// delivered it fine. A plain transactional email gets through far better.
// unlockWelcomeHtml above is kept for reference / a separate welcome email.
function loginEmail(link, isSanta) {
  const what = isSanta ? 'your Sortd Santa List' : 'your sortd account';
  const html = emailShell(`
    <p style="margin:0 0 6px;font-family:'Baloo 2','Trebuchet MS',Verdana,Arial,sans-serif;font-size:24px;font-weight:800;line-height:1.25;">Here's your login link</p>
    <p style="margin:0 0 4px;">Tap the button to open ${what}.</p>
    ${emailButton('Log me in', link)}
    <p style="margin:-8px 0 18px;font-size:13px;color:#5B6783;">The button works for 30 days, on any device. Please don't forward this email: anyone with the button can get into your account. If you didn't ask for this, you can ignore it.</p>
    <p style="margin:0;">Rachel<br><span style="color:#5B6783;">sortd</span></p>
  `, null, { audience: 'parent', eyebrow: isSanta ? 'Santa List' : 'Log in' });
  const text = [
    "Here's your login link for " + what + ':',
    '',
    link,
    '',
    "The link works for 30 days, on any device. Please don't forward this email: anyone with the link can get into your account. If you didn't ask for this, you can ignore it.",
    '',
    'Rachel',
    'sortd · sortd-ireland.ie',
  ].join('\n');
  return { html, text };
}

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) { console.warn('BREVO_API_KEY not set — skipping login email to', to); return; }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Rachel at Sortd', email: 'hello@sortd-ireland.ie' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text || undefined,
      tags: ['parent-login'],
    }),
  });
  if (!res.ok) console.error('Brevo login email failed:', await res.text());
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'AIRTABLE_API_KEY not set' }) };
  }

  let data;
  try {
    if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
      data = JSON.parse(event.body);
    } else {
      data = Object.fromEntries(new URLSearchParams(event.body));
    }
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const email = String(data.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Please enter a valid email address.' }),
    };
  }

  // The newsletter checkbox on /login — unticked by default, its own
  // separate opt-in from account creation (see parent-login-auth-method
  // decision doc / GDPR: marketing consent needs its own unticked box,
  // can't be bundled with "create my account"). A browser form only
  // includes a checkbox's name in FormData/the POST body when it's
  // checked, so any of these shapes mean "checked": 'on' (native form
  // submit), true/'true' (a JSON body posting a real boolean).
  const newsletterOptIn = data.newsletterOptIn === 'on' || data.newsletterOptIn === true || data.newsletterOptIn === 'true';

  try {
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const now = new Date();
    const expires = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60 * 1000);

    const createRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${LOGIN_TOKENS_TABLE_ID}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{
          fields: {
            [LT.EMAIL]: email,
            [LT.TOKEN]: token,
            [LT.CREATED_AT]: now.toISOString(),
            [LT.EXPIRES_AT]: expires.toISOString(),
            [LT.USED]: false,
            [LT.NEWSLETTER_OPT_IN]: newsletterOptIn,
          },
        }],
      }),
    });

    if (!createRes.ok) {
      console.error('request-login: Parent Login Tokens write failed:', await createRes.text());
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Something went wrong. Please try again shortly.' }),
      };
    }

    // Optional page to land on after login (e.g. /christmas for the Santa
    // List). Same internal-paths-only rule verify-login.js applies.
    const next = String(data.next || '');
    const safeNext = /^\/[a-z0-9\-\/.]*(\?[a-z0-9=&_\-]*)?$/i.test(next) && next.indexOf('//') === -1 ? next : '';
    const isSanta = safeNext.indexOf('/christmas') === 0;
    const link = `${SITE_URL}/.netlify/functions/verify-login?token=${token}` + (safeNext ? `&next=${encodeURIComponent(safeNext)}` : '');

    try {
      // One email for every parent login request (account unlock, /login,
      // class pages). It replaced the old plain "Your sortd login link" email.
      const msg = loginEmail(link, isSanta);
      await sendEmail({
        to: email,
        subject: isSanta ? 'Your Sortd Santa List login link' : 'Your sortd login link',
        html: msg.html,
        text: msg.text,
      });
    } catch (emailErr) {
      // Never let an email-sending failure hide the fact that the token
      // itself was created fine — but it does mean the person won't get
      // their link, so this is worth knowing about if it happens a lot.
      console.error('request-login email error:', emailErr);
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, message: "Check your inbox — we've sent you a login link." }),
    };
  } catch (err) {
    console.error('request-login error:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Something went wrong. Please try again shortly.' }),
    };
  }
};

// Exported for previews/tests only.
exports._unlockWelcomeHtml = unlockWelcomeHtml;
exports._loginEmail = loginEmail;
