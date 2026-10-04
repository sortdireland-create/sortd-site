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

const TOKEN_TTL_MINUTES = 30;
const SITE_URL = 'https://sortd-ireland.ie';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) { console.warn('BREVO_API_KEY not set — skipping login email to', to); return; }
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

    const link = `${SITE_URL}/.netlify/functions/verify-login?token=${token}`;

    try {
      await sendEmail({
        to: email,
        subject: 'Your sortd login link',
        html: emailShell(`
          <p style="margin:0 0 16px;">Here's your sortd login link — no password needed.</p>
          ${emailButton('Log me in →', link)}
          <p style="margin:0;font-size:14px;color:#5B6783;">This link expires in ${TOKEN_TTL_MINUTES} minutes and works once. If you didn't request this, you can safely ignore this email.</p>
        `, null, { audience: 'parent', eyebrow: 'Your login link' }),
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
