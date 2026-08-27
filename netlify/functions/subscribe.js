// Netlify serverless function — sortd newsletter/waitlist signup → Customer.io
// Place this file at: netlify/functions/subscribe.js
//
// MIGRATED from MailerLite to Customer.io. This creates/updates a customer
// PROFILE in Customer.io (their "Track API") — it does NOT send a newsletter
// itself. Actual newsletter sends happen from Customer.io's dashboard
// (Campaigns/Broadcasts), same as they did manually in MailerLite before.
//
// It DOES send a one-off transactional "you're on the list" confirmation
// right after signup (added — Rachel wanted something in place while the
// full Customer.io Campaign-based welcome flow is still TBD). Uses the same
// Customer.io transactional Send API + branded template as submit-listing.js
// and claim-listing.js, so it needs that same app API key alongside the
// Track API credentials below.
//
// Requires these Netlify env vars:
//   CUSTOMERIO_SITE_ID       — Track API site ID (Customer.io → Settings → API Credentials)
//   CUSTOMERIO_TRACK_API_KEY — Track API key, same location
//   CUSTOMERIO_REGION        — "us" or "eu", depending which region you picked at signup
//                              (get this wrong and every request silently fails)
//   CUSTOMERIO_APP_API_KEY   — Transactional "App" API key (same one used by
//                              submit-listing.js / claim-listing.js) — for the
//                              confirmation email only. Signup still succeeds
//                              without it; the email is just skipped.

const REGION = (process.env.CUSTOMERIO_REGION || 'us').toLowerCase();
const TRACK_HOST = REGION === 'eu' ? 'track-eu.customer.io' : 'track.customer.io';
// The transactional Send API is region-locked too — an EU-region App API
// key is rejected (401) by the default api.customer.io (US) host, same
// issue as the Track API host above. Was previously hardcoded to the US
// host regardless of REGION, so every confirmation send silently failed.
const SEND_HOST = REGION === 'eu' ? 'api-eu.customer.io' : 'api.customer.io';

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.CUSTOMERIO_APP_API_KEY;
  if (!apiKey) { console.warn('CUSTOMERIO_APP_API_KEY not set — skipping confirmation email to', to); return; }
  const res = await fetch(`https://${SEND_HOST}/v1/send/email`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      from: 'sortd <hello@sortd-ireland.ie>',
      subject,
      body: html,
      identifiers: { email: to },
    }),
  });
  if (!res.ok) console.error('Customer.io confirmation email failed:', await res.text());
}

// ── Branded email shell — matches sortd-brand-foundations exactly:
// muted/dusty palette (navy #293148, blue #4782A8 accent, NEVER red),
// Baloo 2 for headings/logo, Nunito for body, ~18px card radius,
// rounded corners only (never circles). Same shell as the other two
// transactional emails, kept in sync manually. ──
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

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const siteId = process.env.CUSTOMERIO_SITE_ID;
  const apiKey = process.env.CUSTOMERIO_TRACK_API_KEY;
  if (!siteId || !apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Customer.io Track API credentials not set' }) };
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

  const { email, 'first-name': firstName, county, 'child1-age': child1Age, 'child2-age': child2Age } = data;

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email is required' }) };
  }

  const cleanEmail = email.trim().toLowerCase();

  // Customer.io identifies profiles by an ID you choose — using the email
  // itself as the ID is the simplest approach for a newsletter-only use case.
  const attributes = {
    email: cleanEmail,
    subscribed_at: Math.floor(Date.now() / 1000), // Customer.io wants unix timestamps
  };
  if (firstName) attributes.first_name = firstName.trim();
  if (county)    attributes.county = county.trim();
  if (child1Age) attributes.child1_age = parseInt(child1Age, 10);
  if (child2Age) attributes.child2_age = parseInt(child2Age, 10);

  try {
    const auth = Buffer.from(`${siteId}:${apiKey}`).toString('base64');
    const response = await fetch(`https://${TRACK_HOST}/api/v1/customers/${encodeURIComponent(cleanEmail)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify(attributes),
    });

    if (response.ok) {
      // Best-effort confirmation email — never let a failure here fail the
      // signup itself (the profile is already saved in Customer.io either way).
      try {
        await sendEmail({
          to: cleanEmail,
          subject: "You're on the list — sortd",
          html: emailShell(`
            <p style="margin:0 0 16px;">Hi${firstName ? ' ' + firstName.trim() : ''},</p>
            <p style="margin:0 0 16px;">You're on the list! sortd already brings together every kids' summer camp in Dublin &amp; beyond — and from September, we're adding weekly classes, after-school clubs and more.</p>
            <p style="margin:0 0 16px;">We'll email you the moment it's live. No spam, unsubscribe any time.</p>
            <p style="margin:16px 0 0;font-family:'Caveat',cursive;font-size:20px;color:#4782A8;">see you in September →</p>
          `),
        });
      } catch (emailErr) {
        console.error('subscribe confirmation email error:', emailErr);
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, message: 'Subscriber added' }),
      };
    } else {
      const result = await response.text();
      console.error('Customer.io error:', result);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Failed to add subscriber' }),
      };
    }
  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error, please try again' }),
    };
  }
};
