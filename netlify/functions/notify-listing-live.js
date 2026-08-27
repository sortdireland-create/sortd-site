// netlify/functions/notify-listing-live.js
// Scheduled function (see netlify.toml — runs every 10 minutes) that emails
// a provider once their self-submitted listing goes live.
//
// Why polling instead of an instant trigger: Rachel approves listings by
// flipping "Live" to checked directly in Airtable. Airtable's automations
// don't support an outbound webhook we can configure via the API (only a
// manually-authored "Run a script" step could do that, which needs to be
// set up by hand in Airtable's UI) — so instead this function runs on a
// short interval, finds any listing that's newly live and hasn't been
// emailed yet, sends the email, then marks it sent so it's never repeated.
//
// Requires the same AIRTABLE_API_KEY / CUSTOMERIO_APP_API_KEY env vars as
// submit-listing.js.

const BASE_ID = 'appuyWkAmTRI4lN5r';
const TABLE_ID = 'tblziKRbWXA1veyuz';

const F = {
  NAME: 'fldTrzk8wQ8sefLvj',
  PROVIDER_EMAIL: 'fldaApVUFBE4DPy3S',
  LIVE_EMAIL_SENT: 'fldwRZoQ35bVMmu8J',
};

// Customer.io's transactional Send API is region-locked — an EU-region
// workspace's App API key is rejected (401) by the default api.customer.io
// (US) host. Kept in sync with the same fix in claim-listing.js /
// submit-listing.js / subscribe.js.
const CIO_REGION = (process.env.CUSTOMERIO_REGION || 'us').toLowerCase();
const CIO_SEND_HOST = CIO_REGION === 'eu' ? 'api-eu.customer.io' : 'api.customer.io';

// ── Branded email shell — kept in sync manually with the equivalent shell
// in submit-listing.js / claim-listing.js / subscribe.js. ──
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

function emailButton(text, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:999px;background:#4782A8;">
<a href="${url}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-family:'Baloo 2',Verdana,sans-serif;font-weight:700;text-decoration:none;font-size:15px;border-radius:999px;">${text}</a>
</td></tr></table>`;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.CUSTOMERIO_APP_API_KEY;
  if (!apiKey) {
    console.warn('CUSTOMERIO_APP_API_KEY not set — skipping email send to', to);
    return false;
  }
  let res;
  try {
    res = await fetch(`https://${CIO_SEND_HOST}/v1/send/email`, {
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
  } catch (fetchErr) {
    // Network/DNS-level failure — keep this from throwing out of sendEmail
    // so one bad send can't blow up the whole run.
    console.error(`Customer.io fetch threw for ${to}:`, fetchErr && fetchErr.stack || fetchErr);
    return false;
  }
  if (!res.ok) {
    console.error('Customer.io email failed:', await res.text());
    return false;
  }
  return true;
}

exports.handler = async function () {
  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    console.error('notify-listing-live: AIRTABLE_API_KEY not set');
    return { statusCode: 500, body: 'AIRTABLE_API_KEY not set' };
  }

  try {
    const params = new URLSearchParams({
      filterByFormula: 'AND({Live} = 1, {Live Email Sent} != 1)',
      returnFieldsByFieldId: 'true',
    });
    const listRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!listRes.ok) {
      console.error('notify-listing-live: Airtable list failed:', await listRes.text());
      return { statusCode: 500, body: 'Airtable list failed' };
    }
    const { records } = await listRes.json();

    if (!records || records.length === 0) {
      return { statusCode: 200, body: 'No newly-live listings to notify.' };
    }

    const sentRecordIds = [];

    for (const record of records) {
      const name = record.fields[F.NAME];
      const providerEmail = record.fields[F.PROVIDER_EMAIL];
      if (!providerEmail) {
        console.warn(`notify-listing-live: record ${record.id} has no Provider Email — skipping, marking sent anyway.`);
        sentRecordIds.push(record.id);
        continue;
      }

      const sent = await sendEmail({
        to: providerEmail,
        subject: `Your listing is live on sortd! 🎉`,
        html: emailShell(`
          <p style="margin:0 0 16px;">Hi,</p>
          <p style="margin:0 0 16px;">Good news — <strong>${name || 'your listing'}</strong> is now live on sortd! Parents searching for activities near you can find and book it right now.</p>
          <p style="margin:0 0 16px;">Want to add another activity, update this one, or see how it's doing? Head to your provider dashboard — log in any time with just your email, no password needed.</p>
          ${emailButton('Open my provider dashboard →', 'https://portal.sortd-ireland.ie')}
          <p style="margin:0;">Thanks for being part of sortd!</p>
          <p style="margin:16px 0 0;font-family:'Caveat',cursive;font-size:20px;color:#4782A8;">go get discovered →</p>
        `),
      });

      // Mark as sent even if the send itself failed silently (e.g. no API key
      // configured) — matches submit-listing.js's existing "best effort,
      // don't block on email" pattern, so a misconfigured key can't cause
      // this to retry the same record forever every 10 minutes.
      sentRecordIds.push(record.id);
      if (!sent) {
        console.warn(`notify-listing-live: email not sent for record ${record.id}, marking Live Email Sent anyway.`);
      }
    }

    // Batch-update in chunks of 10 (Airtable's per-request record limit).
    for (let i = 0; i < sentRecordIds.length; i += 10) {
      const chunk = sentRecordIds.slice(i, i + 10);
      const updateRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          records: chunk.map((id) => ({ id, fields: { [F.LIVE_EMAIL_SENT]: true } })),
        }),
      });
      if (!updateRes.ok) {
        console.error('notify-listing-live: Airtable update failed:', await updateRes.text());
      }
    }

    return { statusCode: 200, body: `Notified ${sentRecordIds.length} listing(s).` };
  } catch (err) {
    console.error('notify-listing-live error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
