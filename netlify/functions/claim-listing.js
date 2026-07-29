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
  const apiKey = process.env.CUSTOMERIO_APP_API_KEY;
  if (!apiKey) { console.warn('CUSTOMERIO_APP_API_KEY not set — skipping email to', to); return; }
  const res = await fetch('https://api.customer.io/v1/send/email', {
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

function htmlPage(title, message, ok) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;background:#F5F0E8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
  .card{background:#fff;border-radius:20px;padding:40px;max-width:440px;text-align:center;box-shadow:0 10px 40px rgba(39,49,74,.12);}
  h1{color:${ok ? '#1A7A50' : '#DC2626'};font-size:1.4rem;margin-bottom:12px;}
  p{color:#444;line-height:1.6;}
  a{color:#29ABE2;font-weight:700;text-decoration:none;}</style></head>
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

    const getRes = await airtableRequest(`/${id}`);
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
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: htmlPage('Listing claimed!', `<strong>${name}</strong> is now confirmed as yours. Need to update any details? Just reply to any email from us, or contact hello@sortd-ireland.ie directly for now.`, true),
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
        `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=` +
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
          html: `<p>Hi,</p><p>Click below to confirm you're the owner of <strong>${name}</strong> on sortd:</p>
                 <p><a href="${confirmUrl}" style="background:#EF3D2F;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Confirm it's mine →</a></p>
                 <p>If you didn't request this, you can ignore this email.</p><p>— sortd</p>`,
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
