// netlify/functions/get-saved.js
// GET — returns the logged-in parent's saved-listing IDs as JSON.
//
// Used two ways: js/saved.js calls this on page load so a logged-in
// parent's heart state is correct everywhere (not just the browser that
// made the save), and account.html calls it to render the full "Saved"
// section.
//
// Not logged in isn't an error here (unlike save-listing.js) — a page can
// load this opportunistically without knowing in advance whether anyone's
// logged in, and js/saved.js already has an anonymous/localStorage path
// for that case. Returns an empty list rather than 401 so callers don't
// need two code paths just to find out.
//
// Requires: AIRTABLE_API_KEY, PARENT_SESSION_SECRET

const { getSessionFromEvent } = require('./lib/session');

const BASE_ID = 'appuyWkAmTRI4lN5r';
const USERS_TABLE_ID = 'tblTaHPPgDfxnkdEm';
const U = {
  EMAIL: 'Email',
  SAVED_LISTINGS: 'SavedListings',
};

function escapeFormulaValue(v) {
  return String(v).replace(/'/g, "\\'");
}

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
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const session = getSessionFromEvent(event);
  if (!session) {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ loggedIn: false, saved: [] }) };
  }

  if (!process.env.AIRTABLE_API_KEY) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'server_error' }) };
  }

  try {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const findRes = await fetch(
      `https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}?filterByFormula=${encodeURIComponent(`LOWER({${U.EMAIL}}) = '${escapeFormulaValue(session.email.toLowerCase())}'`)}&maxRecords=1`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    if (!findRes.ok) {
      console.error('get-saved: Users lookup failed:', await findRes.text());
      return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'server_error' }) };
    }
    const findData = await findRes.json();
    const existing = findData.records && findData.records[0];
    const saved = existing ? parseSaved(existing.fields[U.SAVED_LISTINGS]) : [];

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ loggedIn: true, saved }),
    };
  } catch (err) {
    console.error('get-saved error:', err);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'server_error' }) };
  }
};
