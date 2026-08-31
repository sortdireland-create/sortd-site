// netlify/functions/claim-listing.js
// Handles the lightweight "claim your listing" flow at sortd-ireland.ie/claim
//
// Two actions, both hit this same function:
//   ?action=request  (POST from the claim.html form)
//     — searches Airtable for a live record matching the name AND whose
//       ProviderEmail matches the submitted email, generates a one-time
//       token, stores it on the record, and emails a confirm link.
//       Always returns the same generic success response regardless of
//       whether a match was found, so this can't be used to fish for
//       which businesses/emails exist in the system.
//
//   ?action=confirm  (GET, the link clicked from that email)
//     — validates the token against the record, and if it matches, sets
//       Claimed = true and clears the token. Returns a plain HTML page
//       (this is a link clicked in a browser, not an API call).
//
// MVP scope: this does NOT give providers an edit dashboard yet. Once
// claimed, they're marked as verified and can email in changes — a full
// self-serve edit flow is a later build once this proves people want it.
//
// Requires: AIRTABLE_API_KEY, CUSTOMERIO_APP_API_KEY (same as submit-listing.js)
//
// ── Same one-time Airtable setup as submit-listing.js — see that file's
// header comment for the 3 fields to add, then fill in the real field
// IDs below. ─────────────────────────────────────────────────────────

const crypto = require('crypto');

const BASE_ID  = 'appuyWkAmTRI4lN5r';
const TABLE_ID = 'tblziKRbWXA1veyuz';

const F = {
  NAME:           'fldTrzk8wQ8sefLvj',
  PROVIDER:       'fldTeVX37izewUhIA',
  LIVE:           'fldBQ6YMcDuYPJkne',
  // Field IDs added to Airtable — kept in sync with submit-listing.js
  PROVIDER_EMAIL: 'fldaApVUFBE4DPy3S', // Provider Email
  CLAIMED:        'fldp4ynCy4tXcncUi', // Claimed
  CLAIM_TOKEN:    'fldPCNXqEJOX7n1Cw', // ClaimToken
};

const SITE_URL = 'https://sortd-ireland.ie';

// Customer.io's transactional Send API is region-locked — an EU-region
// workspace's App API key is rejected (401) by the default api.customer.io
// (US) host. Must match CUSTOMERIO_REGION, same as subscribe.js's Track API
// host logic. Getting this wrong means every send silently fails (caught
// below and only console.error'd — nothing surfaces to the caller).
const CIO_REGION = (process.env.CUSTOMERIO_REGION || 'us').toLowerCase();
const CIO_SEND_HOST = CIO_REGION === 'eu' ? 'api-eu.customer.io' : 'api.customer.io';

// Login Tokens table — shared with submit-listing.js and sortd-provider-portal's
// request-link.js. Generating a token here means the "listing claimed!" page
// can offer a real one-click "log into my portal" button instead of just
// pointing at the portal's login screen and making them type their email again.
const LOGIN_TOKENS_TABLE_ID = 'tblR2PKvtvhV016jN';
const LT = {
  EMAIL: 'flddFt9rZLBmVFlas',
  TOKEN: 'fld7WgLX9A4nj59dM',
  CREATED_AT: 'fldkEPACSX1KpitP1',
  EXPIRES_AT: 'fldNL6jggJIdA6B99',
  USED: 'fldHbAyLOCuChZ2xa',
};
const TOKEN_TTL_MINUTES = 30; // matches request-link.js / submit-listing.js
const PORTAL_URL = 'https://portal.sortd-ireland.ie';

// Creates a one-time login token for this provider's email, exactly like
// submit-listing.js's createMagicLink does, and returns the ready-to-click
// portal magic link. Returns null on any failure — callers should fall back
// to the plain portal URL rather than let this break the claim confirmation.
async function createMagicLink(email, apiKey) {
  if (!email) return null;
  try {
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const now = new Date();
    const expires = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60 * 1000);

    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${LOGIN_TOKENS_TABLE_ID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
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

    if (!res.ok) {
      console.error('createMagicLink: Login Tokens write failed:', await res.text());
      return null;
    }

    return `${PORTAL_URL}/.netlify/functions/verify-link?token=${token}`;
  } catch (err) {
    console.error('createMagicLink error:', err);
    return null;
  }
}

async function airtableRequest(path, options = {}) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) { console.warn('BREVO_API_KEY not set — skipping email to', to); return; }
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
  if (!res.ok) console.error('Brevo email failed:', await res.text());
}

// Kept for fallback — not called. Switched to Brevo (Sept 2026) after
// Customer.io's trial lapsed; see the region-host fix above this function
// for context on the send call this replaced.
async function sendEmailViaCustomerIo({ to, subject, html }) {
  const apiKey = process.env.CUSTOMERIO_APP_API_KEY;
  if (!apiKey) { console.warn('CUSTOMERIO_APP_API_KEY not set — skipping email to', to); return; }
  const res = await fetch(`https://${CIO_SEND_HOST}/v1/send/email`, {
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
  if (!res.ok) console.error('Customer.io email failed:', await res.text());
}

// ── Branded email shell — matches sortd-brand-foundations exactly:
// muted/dusty palette (navy #293148, blue #4782A8 accent, NEVER red),
// Baloo 2 for headings/logo/buttons, Nunito for body, ~18px card radius,
// ~12px button radius, rounded corners only (never circles). ──
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

// Primary CTA — blue stadium pill, matching the real site's "Get the
// newsletter" / "List an activity" primary buttons. No colour param:
// red/bright colours are off-brand.
function emailButton(text, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:999px;background:#4782A8;">
<a href="${url}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-family:'Baloo 2',Verdana,sans-serif;font-weight:700;text-decoration:none;font-size:15px;border-radius:999px;">${text}</a>
</td></tr></table>`;
}

// Landing page shown when the confirm link is clicked — same brand system,
// no red: success uses brand green, error/expired uses brand pink (both muted).
function htmlPage(title, message, ok) {
  const accent = ok ? '#4A9B6C' : '#C66686';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Nunito',system-ui,sans-serif;background:#F7F7F7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
  .card{background:#fff;border-radius:18px;padding:40px;max-width:440px;text-align:center;box-shadow:0 10px 40px rgba(41,49,72,.10);}
  h1{font-family:'Baloo 2',sans-serif;font-weight:800;color:${accent};font-size:1.4rem;margin-bottom:12px;}
  p{color:#293148;font-weight:600;line-height:1.6;}
  a{color:#4782A8;font-weight:700;text-decoration:none;}
  .btn{display:inline-block;margin-top:6px;padding:14px 30px;background:#4782A8;color:#fff !important;font-family:'Baloo 2',sans-serif;font-weight:700;font-size:15px;border-radius:999px;text-decoration:none;}
  .fine{font-size:13px;color:#888;font-weight:600;display:block;margin-top:16px;}</style></head>
  <body><div class="card"><h1>${ok ? '✓' : '✕'} ${title}</h1><p>${message}</p><p style="margin-top:20px"><a href="https://sortd-ireland.ie">← Back to sortd</a></p></div></body></html>`;
}

exports.handler = async function (event) {
  const action = event.queryStringParameters && event.queryStringParameters.action;

  // ── CONFIRM: clicked from the email link ──────────────────────────
  if (action === 'confirm' && event.httpMethod === 'GET') {
    const { id, token } = event.queryStringParameters;
    if (!id || !token) {
      return { statusCode: 400, headers: {'Content-Type':'text/html'}, body: htmlPage('Invalid link', 'This confirmation link looks incomplete. Please request a new one.', false) };
    }

    const getRes = await airtableRequest(`/${id}?returnFieldsByFieldId=true`);
    if (!getRes.ok) {
      return { statusCode: 404, headers: {'Content-Type':'text/html'}, body: htmlPage('Listing not found', "We couldn't find that listing. It may have been removed.", false) };
    }
    const record = await getRes.json();
    const storedToken = record.fields[F.CLAIM_TOKEN];

    if (!storedToken || storedToken !== token) {
      return { statusCode: 403, headers: {'Content-Type':'text/html'}, body: htmlPage('Link expired', 'This confirmation link is invalid or has already been used. Request a new one from the claim page.', false) };
    }

    await airtableRequest('', {
      method: 'PATCH',
      body: JSON.stringify({ records: [{ id, fields: { [F.CLAIMED]: true, [F.CLAIM_TOKEN]: '' } }] }),
    });

    const name = record.fields[F.NAME] || 'your listing';

    // Straight to a one-click portal login from here — this is the moment
    // they're most engaged, so don't make them go dig up a second link.
    // Falls back to the plain portal URL (still requires them to enter
    // their email again) if token creation fails for any reason.
    const magicLink = await createMagicLink(record.fields[F.PROVIDER_EMAIL], process.env.AIRTABLE_API_KEY);
    const portalCtaUrl = magicLink || PORTAL_URL;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage(
        'Listing claimed!',
        `<strong>${name}</strong> is now confirmed as yours.<br><br>Got a camp or a new term class to add? Log into your portal below — no password needed:<br><a class="btn" href="${portalCtaUrl}">Log into my portal →</a><span class="fine">Need to update existing details instead? Just reply to any email from us, or contact hello@sortd-ireland.ie.</span>`,
        true
      ),
    };
  }

  // ── REQUEST: form submission asking to claim a listing ─────────────
  if (action === 'request' && event.httpMethod === 'POST') {
    let data;
    try { data = JSON.parse(event.body); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }; }

    const { query, email } = data;
    const genericResponse = { statusCode: 200, headers: {'Access-Control-Allow-Origin':'*'}, body: JSON.stringify({ success: true }) };

    if (!query || !email) return genericResponse; // don't leak validation details either

    try {
      const searchRes = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?returnFieldsByFieldId=true&filterByFormula=` +
        encodeURIComponent(`AND(OR(SEARCH(LOWER("${query.replace(/"/g,'')}"), LOWER({${F.NAME}})), SEARCH(LOWER("${query.replace(/"/g,'')}"), LOWER({${F.PROVIDER}}))), LOWER({${F.PROVIDER_EMAIL}}) = LOWER("${email.replace(/"/g,'')}"))`),
        { headers: { 'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}` } }
      );

      if (!searchRes.ok) { console.error('Airtable search failed:', await searchRes.text()); return genericResponse; }
      const { records } = await searchRes.json();

      // Email a confirm link for every matching record (usually just one)
      for (const record of records || []) {
        const token = crypto.randomBytes(24).toString('hex');
        await airtableRequest('', {
          method: 'PATCH',
          body: JSON.stringify({ records: [{ id: record.id, fields: { [F.CLAIM_TOKEN]: token } }] }),
        });

        const confirmUrl = `${SITE_URL}/.netlify/functions/claim-listing?action=confirm&id=${record.id}&token=${token}`;
        const name = record.fields[F.NAME] || 'your listing';
        await sendEmail({
          to: email,
          subject: `Confirm you're the owner of ${name}`,
          html: emailShell(`
            <p style="margin:0 0 16px;">Hi,</p>
            <p style="margin:0 0 4px;">Click below to confirm you're the owner of <strong>${name}</strong> on sortd:</p>
            ${emailButton("Confirm it's mine →", confirmUrl)}
            <p style="margin:4px 0 0;font-size:13px;color:#666;">If you didn't request this, you can safely ignore this email.</p>
            <p style="margin:16px 0 0;font-family:'Caveat',cursive;font-size:20px;color:#4782A8;">you're nearly there →</p>
          `),
        });
      }

      return genericResponse;
    } catch (err) {
      console.error('claim-listing request error:', err);
      return genericResponse; // still generic — don't expose internals
    }
  }

  return { statusCode: 400, headers: {'Content-Type':'text/html'}, body: htmlPage('Invalid request', 'This link or request looks malformed.', false) };
};
