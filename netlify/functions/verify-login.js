// netlify/functions/verify-login.js
// GET /.netlify/functions/verify-login?token=... — the link clicked from
// the login email sent by request-login.js.
//
// Validates the token against "Parent Login Tokens", marks it used
// (single-use), finds-or-creates a "Users" record for that email, sets
// the sortd_session cookie (see lib/session.js), and redirects into
// /account.
//
// Intentionally does NOT reuse the provider portal's verify-link.js or
// its "Login Tokens" table — this checks a completely separate table, so
// a provider's magic link could never log someone into a parent account
// or vice versa. It also has none of verify-link.js's "auto-claim my
// listings" side effect, which is provider-specific and has no parent
// equivalent.
//
// Requires: AIRTABLE_API_KEY, PARENT_SESSION_SECRET
// Optional (newsletter opt-in only — see addToNewsletter below; same vars
// subscribe.js already uses, so nothing new to set up if that's working):
//   CUSTOMERIO_SITE_ID, CUSTOMERIO_TRACK_API_KEY, CUSTOMERIO_REGION

const { createSessionCookies } = require('./lib/session');

const BASE_ID = 'appuyWkAmTRI4lN5r';

const LOGIN_TOKENS_TABLE_ID = 'tbliAI9vbuHyZdT9K'; // "Parent Login Tokens"
const LT = {
  EMAIL: 'Email',
  TOKEN: 'Token',
  CREATED_AT: 'CreatedAt',
  EXPIRES_AT: 'ExpiresAt',
  USED: 'Used',
  NEWSLETTER_OPT_IN: 'NewsletterOptIn',
};

const USERS_TABLE_ID = 'tblTaHPPgDfxnkdEm'; // "Users" (parents)
const U = {
  EMAIL: 'Email',
  NAME: 'Name',
  NEWSLETTER_OPT_IN: 'NewsletterOptIn',
  NEWSLETTER_OPT_IN_AT: 'NewsletterOptInAt',
  CREATED_AT: 'CreatedAt',
  LAST_LOGIN_AT: 'LastLoginAt',
};

const SITE_URL = 'https://sortd-ireland.ie';

function escapeFormulaValue(v) {
  return String(v).replace(/'/g, "\\'");
}

// Adds/updates this parent's profile in Customer.io — the same mailing
// list the footer newsletter signup (subscribe.js) writes to, so a parent
// who ticks the /login checkbox lands on the exact same list as anyone
// who signs up from the footer. Best-effort only: a failure here must
// never stop the login itself from completing, since the Airtable
// NewsletterOptIn/NewsletterOptInAt fields are the authoritative consent
// record regardless of whether this call succeeds.
async function addToNewsletter(email) {
  const siteId = process.env.CUSTOMERIO_SITE_ID;
  const apiKey = process.env.CUSTOMERIO_TRACK_API_KEY;
  if (!siteId || !apiKey) {
    console.warn('verify-login: Customer.io Track API credentials not set — skipping newsletter add for', email);
    return;
  }
  const region = (process.env.CUSTOMERIO_REGION || 'us').toLowerCase();
  const trackHost = region === 'eu' ? 'track-eu.customer.io' : 'track.customer.io';
  const auth = Buffer.from(`${siteId}:${apiKey}`).toString('base64');
  const res = await fetch(`https://${trackHost}/api/v1/customers/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
    body: JSON.stringify({ email, subscribed_at: Math.floor(Date.now() / 1000), source: 'parent_account_login' }),
  });
  if (!res.ok) console.error('verify-login: Customer.io newsletter add failed:', await res.text());
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

function redirect(location, cookies) {
  const resp = { statusCode: 302, headers: { Location: location }, body: '' };
  if (cookies && cookies.length) resp.multiValueHeaders = { 'Set-Cookie': cookies };
  return resp;
}

exports.handler = async function (event) {
  const token = event.queryStringParameters && event.queryStringParameters.token;
  if (!token) return redirect(`${SITE_URL}/login?error=invalid_link`);

  if (!process.env.AIRTABLE_API_KEY) return redirect(`${SITE_URL}/login?error=server_error`);

  try {
    const lookupRes = await airtableRequest(
      LOGIN_TOKENS_TABLE_ID,
      `?filterByFormula=${encodeURIComponent(`{${LT.TOKEN}} = '${escapeFormulaValue(token)}'`)}&maxRecords=1`
    );
    if (!lookupRes.ok) {
      console.error('verify-login: token lookup failed:', await lookupRes.text());
      return redirect(`${SITE_URL}/login?error=server_error`);
    }
    const lookupData = await lookupRes.json();
    const record = lookupData.records && lookupData.records[0];
    if (!record) return redirect(`${SITE_URL}/login?error=invalid_link`);

    const f = record.fields;
    const used = !!f[LT.USED];
    const expiresAt = f[LT.EXPIRES_AT] ? new Date(f[LT.EXPIRES_AT]) : null;
    const expired = !expiresAt || expiresAt.getTime() < Date.now();
    if (used || expired) return redirect(`${SITE_URL}/login?error=expired_link`);

    const email = String(f[LT.EMAIL] || '').trim().toLowerCase();
    if (!email) return redirect(`${SITE_URL}/login?error=invalid_link`);

    // Carried over from the checkbox on /login at request time (see
    // request-login.js). Only ever used to turn opt-in ON below — a
    // false here just means "nothing to add", never "remove consent".
    // Unsubscribing is handled separately, the normal way (the
    // Unsubscribe link in every marketing email), not by logging in
    // again with the box unticked.
    const newsletterOptIn = !!f[LT.NEWSLETTER_OPT_IN];

    // Mark the token used before doing anything else — if a request were
    // somehow replayed concurrently, we want the SECOND attempt to fail,
    // not succeed twice.
    const markUsedRes = await airtableRequest(LOGIN_TOKENS_TABLE_ID, '', {
      method: 'PATCH',
      body: JSON.stringify({ records: [{ id: record.id, fields: { [LT.USED]: true } }] }),
    });
    if (!markUsedRes.ok) {
      console.error('verify-login: failed to mark token used:', await markUsedRes.text());
    }

    const now = new Date().toISOString();

    // Find-or-create the Users record for this email.
    const findRes = await airtableRequest(
      USERS_TABLE_ID,
      `?filterByFormula=${encodeURIComponent(`LOWER({${U.EMAIL}}) = '${escapeFormulaValue(email)}'`)}&maxRecords=1`
    );
    const findData = findRes.ok ? await findRes.json() : { records: [] };
    const existing = findData.records && findData.records[0];

    if (existing) {
      const updateFields = { [U.LAST_LOGIN_AT]: now };
      // Only write the opt-in fields when newly opting in AND not already
      // opted in — never overwrite an existing NewsletterOptInAt, and
      // never write NewsletterOptIn: false (see note above).
      if (newsletterOptIn && !existing.fields[U.NEWSLETTER_OPT_IN]) {
        updateFields[U.NEWSLETTER_OPT_IN] = true;
        updateFields[U.NEWSLETTER_OPT_IN_AT] = now;
      }
      const updateRes = await airtableRequest(USERS_TABLE_ID, '', {
        method: 'PATCH',
        body: JSON.stringify({ records: [{ id: existing.id, fields: updateFields }] }),
      });
      if (!updateRes.ok) console.error('verify-login: failed to update Users record:', await updateRes.text());
    } else {
      const createFields = { [U.EMAIL]: email, [U.CREATED_AT]: now, [U.LAST_LOGIN_AT]: now };
      if (newsletterOptIn) {
        createFields[U.NEWSLETTER_OPT_IN] = true;
        createFields[U.NEWSLETTER_OPT_IN_AT] = now;
      }
      const createRes = await airtableRequest(USERS_TABLE_ID, '', {
        method: 'POST',
        body: JSON.stringify({ records: [{ fields: createFields }] }),
      });
      if (!createRes.ok) console.error('verify-login: failed to create Users record:', await createRes.text());
    }

    // Best-effort — never let a newsletter-platform hiccup break login.
    if (newsletterOptIn) {
      try {
        await addToNewsletter(email);
      } catch (newsletterErr) {
        console.error('verify-login: addToNewsletter error:', newsletterErr);
      }
    }

    const cookies = createSessionCookies(email);
    return redirect(`${SITE_URL}/account`, cookies);
  } catch (err) {
    console.error('verify-login error:', err);
    return redirect(`${SITE_URL}/login?error=server_error`);
  }
};
