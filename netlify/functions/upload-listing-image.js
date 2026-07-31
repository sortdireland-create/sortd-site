// netlify/functions/upload-listing-image.js
// Handles Logo / Photos uploads from the public self-submit form at
// sortd-ireland.ie/list (see list.html + submit-listing.js).
//
// Flow: list.html first POSTs the text fields to submit-listing, which
// creates a draft record (Live = false) and returns its recordId. The
// browser then calls this endpoint once per image (base64-encoded),
// targeting that same recordId, so large image payloads never have to
// ride along with the initial text submission.
//
// SECURITY NOTE: this endpoint has no login/session (the public form is
// anonymous, same as submit-listing.js). To stop it being used to plant
// images on arbitrary/live listings, an upload is only accepted while the
// target record is STILL a fresh, unreviewed draft from this exact flow:
// Live must be false AND Notes must still read the pending-review marker
// submit-listing.js sets on creation. Once Rachel reviews a listing (which
// changes Notes and/or flips Live), this endpoint stops accepting uploads
// for that record.
//
// Requires the same AIRTABLE_API_KEY env var as submit-listing.js.

const BASE_ID = 'appuyWkAmTRI4lN5r';
const TABLE_ID = 'tblziKRbWXA1veyuz';

const F = {
  LIVE: 'fldBQ6YMcDuYPJkne',
  NOTES: 'fldf0DnzcUkCcg2gE',
  LOGO: 'fldb5C2nYjPGfahAX',
  PHOTOS: 'fldvEI4SDUDkIWTVG',
};

const ATTACHMENT_FIELDS = { Logo: F.LOGO, Photos: F.PHOTOS };

const PENDING_NOTES_MARKER = 'Submitted via self-submit form — pending review.';

const MAX_BYTES = 4.5 * 1024 * 1024; // 4.5MB raw file bytes — matches the provider portal's cap

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Raw byte size of a base64 string (no data: URI prefix expected).
function base64ByteSize(base64) {
  const len = base64.length;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (len * 3) / 4 - padding;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  const { recordId, field, filename, contentType, file } = data;

  if (!recordId || !field || !filename || !contentType || !file) {
    return json(400, { error: 'Missing required field(s): recordId, field, filename, contentType, file' });
  }

  const fieldId = ATTACHMENT_FIELDS[field];
  if (!fieldId) {
    return json(400, { error: 'Unknown field — must be "Logo" or "Photos"' });
  }

  if (!contentType.startsWith('image/')) {
    return json(400, { error: 'Please choose an image file.' });
  }

  if (base64ByteSize(file) > MAX_BYTES) {
    return json(400, { error: 'That image is too large — please use one under 4MB.' });
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  if (!apiKey) {
    return json(500, { error: 'AIRTABLE_API_KEY not set' });
  }

  try {
    // Ownership/eligibility check: only allow uploads onto a fresh, still-pending
    // draft created by this same self-submit flow — not any arbitrary/live record.
    const recRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}?returnFieldsByFieldId=true`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!recRes.ok) {
      return json(404, { error: 'Listing not found.' });
    }
    const record = await recRes.json();
    const isPendingDraft =
      record.fields[F.LIVE] !== true && record.fields[F.NOTES] === PENDING_NOTES_MARKER;
    if (!isPendingDraft) {
      return json(403, { error: 'This listing can no longer accept image uploads.' });
    }

    // NOTE: the uploadAttachment endpoint's URL does NOT include the table ID —
    // just baseId/recordId/fieldId (record IDs are unique across a whole base).
    // Including TABLE_ID here (as an earlier version of this file did) makes
    // Airtable return a 404 NOT_FOUND, since the URL doesn't match any route.
    const upRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${recordId}/${fieldId}/uploadAttachment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ contentType, file, filename }),
      }
    );

    if (!upRes.ok) {
      const errText = await upRes.text();
      console.error('Airtable uploadAttachment failed:', errText);
      return json(500, { error: 'Could not upload image, please try again.' });
    }

    return json(200, { message: 'Image uploaded.' });
  } catch (err) {
    console.error('upload-listing-image error:', err);
    return json(500, { error: 'Server error, please try again' });
  }
};
