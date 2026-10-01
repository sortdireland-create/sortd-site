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

const BASE_ID = 'appuyWkAmTRI4lN5r';
const LOGIN_TOKENS_TABLE_ID = 'tbliAI9vbuHyZdT9K'; // "Parent Login Tokens"
const LT = {
  EMAIL: 'Email',
  TOKEN: 'Token',
  CREATED_AT: 'CreatedAt',
  EXPIRES_AT: 'ExpiresAt',
  USED: 'Used',
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

// Same branded shell as subscribe.js / claim-listing.js / submit-listing.js
// — kept in sync by hand across all four, there's no shared template yet.
function emailShell(innerHtml) {
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
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
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
          <p style="margin:24px 0;">
            <a href="${link}" style="background:#4782A8;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:800;font-family:'Baloo 2',Verdana,sans-serif;display:inline-block;">Log me in →</a>
          </p>
          <p style="margin:0;font-size:13px;color:#888;">This link expires in ${TOKEN_TTL_MINUTES} minutes and works once. If you didn't request this, you can safely ignore this email.</p>
        `),
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
