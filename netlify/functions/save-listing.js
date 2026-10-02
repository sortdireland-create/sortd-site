// netlify/functions/save-listing.js
// POST { listingId, action: 'save' | 'unsave' } — toggles one listing on
// the logged-in parent's shortlist.
//
// Only ever called while logged in (js/saved.js keeps an anonymous saver's
// shortlist entirely in localStorage and never hits this endpoint) — so a
// missing/invalid sortd_session cookie is a hard 401, not a soft fallback.
//
// Requires: AIRTABLE_API_KEY, PARENT_SESSION_SECRET (same session cookie
// verify-login.js sets — see lib/session.js)

const { getSessionFromEvent } = require('./lib/session');

const BASE_ID = 'appuyWkAmTRI4lN5r';
const USERS_TABLE_ID = 'tblTaHPPgDfxnkdEm'; // "Users" (parents)
const U = {
  EMAIL: 'Email',
  SAVED_LISTINGS: 'SavedListings',
};

function escapeFormulaValue(v) {
  return String(v).replace(/'/g, "\\'");
}

async function airtableRequest(tableId, pathAndQuery, options = {}) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  return fetch(`https://api.airtable.com/v0/${BASE_ID}/${tableId}${pathAndQuery}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

// SavedListings is stored as a JSON array string in a plain multilineText
// field (no relational "Saved Activities" table yet — this is the same
// flat-JSON-in-text pattern already used for Tags elsewhere in this base).
// Any unparseable/missing value is just treated as an empty shortlist
// rather than an error, same spirit as every other best-effort parse in
// this codebase (e.g. verify-login.js's NewsletterOptIn handling).
function parseSaved(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch (e) {
    return [];
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!process.env.AIRTABLE_API_KEY) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'server_error' }) };
  }

  const session = getSessionFromEvent(event);
  if (!session) {
    return { statusCode: 401, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'not_logged_in' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'invalid_body' }) };
  }

  const listingId = String(data.listingId || '').trim();
  const action = data.action === 'unsave' ? 'unsave' : 'save';
  if (!listingId) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'missing_listing_id' }) };
  }

  try {
    const findRes = await airtableRequest(
      USERS_TABLE_ID,
      `?filterByFormula=${encodeURIComponent(`LOWER({${U.EMAIL}}) = '${escapeFormulaValue(session.email.toLowerCase())}'`)}&maxRecords=1`
    );
    if (!findRes.ok) {
      console.error('save-listing: Users lookup failed:', await findRes.text());
      return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'server_error' }) };
    }
    const findData = await findRes.json();
    const existing = findData.records && findData.records[0];
    if (!existing) {
      // Session cookie is valid but there's no Users record (shouldn't
      // normally happen — verify-login.js always creates one on first
      // login) — nothing to save against.
      return { statusCode: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'no_account' }) };
    }

    const current = parseSaved(existing.fields[U.SAVED_LISTINGS]);
    const next = action === 'save'
      ? (current.includes(listingId) ? current : [...current, listingId])
      : current.filter((id) => id !== listingId);

    const updateRes = await airtableRequest(USERS_TABLE_ID, '', {
      method: 'PATCH',
      body: JSON.stringify({ records: [{ id: existing.id, fields: { [U.SAVED_LISTINGS]: JSON.stringify(next) } }] }),
    });
    if (!updateRes.ok) {
      console.error('save-listing: Users update failed:', await updateRes.text());
      return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'server_error' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, saved: next }),
    };
  } catch (err) {
    console.error('save-listing error:', err);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'server_error' }) };
  }
};
