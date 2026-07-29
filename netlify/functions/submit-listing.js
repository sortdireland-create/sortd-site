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
      html: `
        <p>Hi,</p>
        <p>Thanks for submitting <strong>${data.name.trim()}</strong> to sortd! We'll review it and get it live within a few days.</p>
        <p>Once it's live, parents across ${data.county.trim()} searching for ${data.category.trim().toLowerCase()} camps will be able to find you.</p>
        <p>Questions in the meantime? Just reply to this email.</p>
        <p>— sortd</p>
      `,
    });

    // Notification to Rachel
    const notifyTo = process.env.RACHEL_NOTIFY_EMAIL;
    if (notifyTo) {
      await sendEmail({
        to: notifyTo,
        subject: `New listing to review: ${data.name.trim()}`,
        html: `
          <p>New self-submitted listing, pending review:</p>
          <ul>
            <li><strong>Name:</strong> ${data.name.trim()}</li>
            <li><strong>Provider:</strong> ${data.provider.trim()}</li>
            <li><strong>County/Area:</strong> ${data.county.trim()} / ${data.area.trim()}</li>
            <li><strong>Category:</strong> ${data.category.trim()}</li>
            <li><strong>Ages:</strong> ${data.ageMin}–${data.ageMax}</li>
            <li><strong>Cost:</strong> ${data.cost.trim()}</li>
            <li><strong>Contact:</strong> ${data.providerEmail.trim()}</li>
          </ul>
          <p>Airtable record: ${record.id}</p>
        `,
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
