// netlify/functions/submit-listing.js
// Handles the provider self-submit form at sortd-ireland.ie/list
//
// On submit:
//   1. Validates required fields
//   2. Creates a DRAFT record in Airtable (Live = false) — Rachel reviews before it goes public
//   3. Emails the provider a confirmation
//   4. Emails Rachel a "new listing to review" notification
//
// Requires these Netlify env vars (same pattern as generate-listings.js / subscribe.js):
//   AIRTABLE_API_KEY    — already in use elsewhere
//   CUSTOMERIO_APP_API_KEY — Customer.io → Settings → API Credentials → App API Keys
//                            (different key from the Track API key used in subscribe.js)
//   RACHEL_NOTIFY_EMAIL — the inbox that should get "new listing" notifications
//
// ── ONE-TIME SETUP NEEDED IN AIRTABLE before this works ─────────────
// Add these 3 fields to the "Imported table" (base appuyWkAmTRI4lN5r), then
// paste their field IDs into F.PROVIDER_EMAIL / F.CLAIMED / F.CLAIM_TOKEN below:
//   ProviderEmail  (type: Email)
//   Claimed        (type: Checkbox)
//   ClaimToken     (type: Single line text)
// ─────────────────────────────────────────────────────────────────────

const BASE_ID  = 'appuyWkAmTRI4lN5r';
const TABLE_ID = 'tblziKRbWXA1veyuz';

const F = {
  NAME:          'fldTrzk8wQ8sefLvj',
  PROVIDER:      'fldTeVX37izewUhIA',
  AGE_MIN:       'fldlFGnJMY1xYt56Y',
  AGE_MAX:       'fld8InKRs58HRZgVX',
  CATEGORY:      'fldkrBMNkG1HKhLqv',
  COST:          'fldCBKMjvwvcYHUip',
  AREA:          'fldUeF6R78CuZF39k',
  COUNTY:        'fldNPedJO4jIgRa0j',
  BOOKING_URL:   'fldEhcai8rQQuUWtY',
  BOOKING:       'fldNP69Qh7Hw3YZx2',
  ACTIVITIES:    'fldELpg99Iz6mNrIB',
  NOTES:         'fldf0DnzcUkCcg2gE',
  LIVE:          'fldBQ6YMcDuYPJkne',
  PROVIDER_EMAIL: 'fldaApVUFBE4DPy3S', // Provider Email
  CLAIMED:        'fldp4ynCy4tXcncUi', // Claimed
  CLAIM_TOKEN:    'fldPCNXqEJOX7n1Cw', // ClaimToken
};

const REQUIRED = ['name','provider','county','area','category','ageMin','ageMax','cost','bookingUrl','providerEmail'];

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
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Primary CTA — always the dark navy button pattern from the real site's
// "Find out more" buttons. No colour param: red/bright colours are off-brand.
function emailButton(text, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:12px;background:#293148;">
<a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-family:'Baloo 2',Verdana,sans-serif;font-weight:700;text-decoration:none;font-size:15px;border-radius:12px;">${text}</a>
</td></tr></table>`;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.CUSTOMERIO_APP_API_KEY;
  if (!apiKey) {
    console.warn('CUSTOMERIO_APP_API_KEY not set — skipping email send to', to);
    return;
  }
  // Ad-hoc send (no pre-built Customer.io template needed) — identifiers.email
  // links this send to a customer profile, creating one if it doesn't exist yet.
  const res = await fetch('https://api.customer.io/v1/send/email', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to,
      from: 'sortd <hello@sortd-ireland.ie>',
      subject,
      body: html,
      identifiers: { email: to },
    }),
  });
  if (!res.ok) {
    console.error('Customer.io email failed:', await res.text());
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const missing = REQUIRED.filter(k => !data[k] || !String(data[k]).trim());
  if (missing.length) {
    return { statusCode: 400, body: JSON.stringify({ error: `Missing required field(s): ${missing.join(', ')}` }) };
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'AIRTABLE_API_KEY not set' }) };
  }

  const fields = {
    [F.NAME]:           data.name.trim(),
    [F.PROVIDER]:       data.provider.trim(),
    [F.COUNTY]:         data.county.trim(),
    [F.AREA]:           data.area.trim(),
    [F.CATEGORY]:       data.category.trim(),
    [F.AGE_MIN]:        Number(data.ageMin),
    [F.AGE_MAX]:        Number(data.ageMax),
    [F.COST]:           data.cost.trim(),
    [F.ACTIVITIES]:     (data.activities || '').trim(),
    [F.PROVIDER_EMAIL]: data.providerEmail.trim(),
    [F.LIVE]:           false, // always a draft — Rachel reviews before publishing
    [F.NOTES]:          'Submitted via self-submit form — pending review.',
  };

  // BookingUrl field expects a URL; if they typed a phone/email instead, store it
  // in Booking (free text) rather than forcing an invalid URL value.
  const looksLikeUrl = /^https?:\/\//i.test(data.bookingUrl.trim());
  if (looksLikeUrl) {
    fields[F.BOOKING_URL] = data.bookingUrl.trim();
  } else {
    fields[F.BOOKING] = data.bookingUrl.trim();
  }

  try {
    const airtableRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });

    if (!airtableRes.ok) {
      const errText = await airtableRes.text();
      console.error('Airtable create failed:', errText);
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not save listing, please try again' }) };
    }

    const result = await airtableRes.json();
    const record = result.records[0];

    // Confirmation email to the provider
    await sendEmail({
      to: data.providerEmail.trim(),
      subject: `We've got your listing for ${data.name.trim()}`,
      html: emailShell(`
        <p style="margin:0 0 16px;">Hi,</p>
        <p style="margin:0 0 16px;">Thanks for submitting <strong>${data.name.trim()}</strong> to sortd! We'll review it and get it live within a few days.</p>
        <table role="presentation" width="100%" style="background:#D1E9F5;border-radius:12px;margin:0 0 20px;"><tr><td style="padding:16px 20px;font-size:14px;color:#293148;line-height:1.8;font-weight:600;">
          <strong>${data.name.trim()}</strong><br>
          ${data.category.trim()} · ${data.county.trim()}, ${data.area.trim()}<br>
          Ages ${data.ageMin}–${data.ageMax} · ${data.cost.trim()}
        </td></tr></table>
        <p style="margin:0 0 16px;">Once it's live, parents across ${data.county.trim()} searching for ${data.category.trim().toLowerCase()} camps will be able to find you.</p>
        <p style="margin:0;">Questions in the meantime? Just reply to this email.</p>
        <p style="margin:16px 0 0;font-family:'Caveat',cursive;font-size:20px;color:#4782A8;">— sortd</p>
      `),
    });

    // Notification to Rachel
    const notifyTo = process.env.RACHEL_NOTIFY_EMAIL;
    if (notifyTo) {
      const airtableUrl = `https://airtable.com/${BASE_ID}/${TABLE_ID}/${record.id}`;
      await sendEmail({
        to: notifyTo,
        subject: `New listing to review: ${data.name.trim()}`,
        html: emailShell(`
          <p style="margin:0 0 16px;">New self-submitted listing, pending review:</p>
          <table role="presentation" width="100%" style="background:#D1E9F5;border-radius:12px;margin:0 0 4px;"><tr><td style="padding:16px 20px;font-size:14px;color:#293148;line-height:1.8;font-weight:600;">
            <strong>Name:</strong> ${data.name.trim()}<br>
            <strong>Provider:</strong> ${data.provider.trim()}<br>
            <strong>County/Area:</strong> ${data.county.trim()} / ${data.area.trim()}<br>
            <strong>Category:</strong> ${data.category.trim()}<br>
            <strong>Ages:</strong> ${data.ageMin}–${data.ageMax}<br>
            <strong>Cost:</strong> ${data.cost.trim()}<br>
            <strong>Contact:</strong> ${data.providerEmail.trim()}
          </td></tr></table>
          ${emailButton('Review in Airtable →', airtableUrl)}
        `),
      });
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, recordId: record.id }),
    };
  } catch (err) {
    console.error('submit-listing error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error, please try again' }) };
  }
};
