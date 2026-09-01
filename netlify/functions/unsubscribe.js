// netlify/functions/unsubscribe.js
// Lets someone opt out of sortd's non-essential emails (the post-claim
// welcome email, the "listing is live" nudge, future participation/outreach
// campaigns) without opting out of purely transactional emails tied to
// their own listing or submission — those keep sending regardless of this
// flag, same as any receipt-style email would. The unsubscribe link itself
// now appears in every provider/parent-facing email footer (Sept 2026), not
// just the welcome email — but clicking it never stops a transactional send
// already in flight, it only affects what comes after.
//
// Two ways in, depending on which email the link came from:
//   /.netlify/functions/unsubscribe?id=<Airtable record id>
//     — claim-listing.js / submit-listing.js / notify-listing-live.js.
//       Flips MARKETING_OPT_OUT on that Airtable listing record.
//   /.netlify/functions/unsubscribe?email=<address>
//     — subscribe.js (newsletter signup), which has no Airtable listing
//       record behind it, just a Customer.io profile keyed by email.
//       Sets an `unsubscribed_at` attribute on that profile via the Track
//       API — Rachel should exclude profiles where this is set when
//       building a Customer.io Campaign/Broadcast segment, since this is a
//       plain attribute rather than Customer.io's own suppression list.
//
// Deliberately no token on either link — worst case someone else flips a
// stranger's opt-out flag, which just means that person gets fewer
// marketing emails from us. Not worth the extra friction of a signed link
// for a one-way, low-stakes preference.
//
// Requires: AIRTABLE_API_KEY (id path), CUSTOMERIO_SITE_ID +
// CUSTOMERIO_TRACK_API_KEY + CUSTOMERIO_REGION (email path — same as
// subscribe.js's Track API credentials).

const BASE_ID = 'appuyWkAmTRI4lN5r';
const TABLE_ID = 'tblziKRbWXA1veyuz';

const F = {
  MARKETING_OPT_OUT: 'fldCx8ppVT18rV7og',
};

const REGION = (process.env.CUSTOMERIO_REGION || 'us').toLowerCase();
const TRACK_HOST = REGION === 'eu' ? 'track-eu.customer.io' : 'track.customer.io';

function htmlPage(title, message, ok) {
  const accent = ok ? '#4A9B6C' : '#C66686';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@400;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Nunito',system-ui,sans-serif;background:#F7F7F7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;}
  .card{background:#fff;border-radius:18px;padding:40px;max-width:440px;text-align:center;box-shadow:0 10px 40px rgba(41,49,72,.10);}
  h1{font-family:'Baloo 2',sans-serif;font-weight:800;color:${accent};font-size:1.4rem;margin-bottom:12px;}
  p{color:#293148;font-weight:600;line-height:1.6;}
  a{color:#4782A8;font-weight:700;text-decoration:none;}</style></head>
  <body><div class="card"><h1>${ok ? '✓' : '✕'} ${title}</h1><p>${message}</p><p style="margin-top:20px"><a href="https://sortd-ireland.ie">← Back to sortd</a></p></div></body></html>`;
}

const GENERIC_ERROR = htmlPage('Something went wrong', "We couldn't process that just now — please email hello@sortd-ireland.ie and we'll take care of it.", false);
const SUCCESS = htmlPage(
  "You're unsubscribed",
  "You won't get participation emails like this from us again. Essential emails — like claim confirmations, submission receipts, or your listing going live — aren't affected.",
  true
);

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const { id, email } = params;

  if (!id && !email) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: htmlPage('Missing link info', "This unsubscribe link looks incomplete — please email hello@sortd-ireland.ie and we'll take care of it by hand.", false) };
  }

  // ── Listing-record path (claim-listing.js / submit-listing.js / notify-listing-live.js) ──
  if (id) {
    const apiKey = process.env.AIRTABLE_API_KEY;
    if (!apiKey) {
      console.error('unsubscribe: AIRTABLE_API_KEY not set');
      return { statusCode: 500, body: 'Server error' };
    }

    try {
      const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          records: [{ id, fields: { [F.MARKETING_OPT_OUT]: true } }],
        }),
      });

      if (!res.ok) {
        console.error('unsubscribe: Airtable update failed:', await res.text());
        return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: GENERIC_ERROR };
      }
    } catch (err) {
      console.error('unsubscribe (id) error:', err);
      return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: GENERIC_ERROR };
    }

    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: SUCCESS };
  }

  // ── Newsletter path (subscribe.js) — no Airtable record, just a Customer.io profile ──
  const siteId = process.env.CUSTOMERIO_SITE_ID;
  const trackApiKey = process.env.CUSTOMERIO_TRACK_API_KEY;
  if (!siteId || !trackApiKey) {
    console.error('unsubscribe: Customer.io Track API credentials not set');
    return { statusCode: 500, body: 'Server error' };
  }

  try {
    const cleanEmail = email.trim().toLowerCase();
    const auth = Buffer.from(`${siteId}:${trackApiKey}`).toString('base64');
    // Track API's customer PUT merges attributes rather than replacing the
    // profile, so this can't clobber subscribed_at / first_name / etc.
    const res = await fetch(`https://${TRACK_HOST}/api/v1/customers/${encodeURIComponent(cleanEmail)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({ unsubscribed_at: Math.floor(Date.now() / 1000) }),
    });

    if (!res.ok) {
      console.error('unsubscribe: Customer.io update failed:', await res.text());
      return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: GENERIC_ERROR };
    }
  } catch (err) {
    console.error('unsubscribe (email) error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: GENERIC_ERROR };
  }

  return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: SUCCESS };
};
