// netlify/functions/lib/brevo-newsletter.js
// Shared Brevo helpers for the weekly "what's on near you" newsletter list.
// Used by subscribe.js (footer + About sign-up), verify-login.js (the opt-in
// tick on /login) and unsubscribe.js, so every sign-up route lands on the
// same Brevo list with the same consent record.
//
// Requires: BREVO_API_KEY (already set — the transactional emails use it).
// Optional: BREVO_NEWSLETTER_LIST_ID — which Brevo list to add people to.
// Defaults to list 2 ("Your first list"); rename it "Weekly newsletter" in
// Brevo, or create a new list and put its ID in this env var.
//
// Consent record: every contact gets OPT_IN = true plus these text
// attributes, created automatically in Brevo the first time they're needed:
//   SIGNUP_SOURCE  footer | about_page | parent_login
//   CONSENT_AT     ISO timestamp of the sign-up
//   CONSENT_TEXT   the exact wording of the tick box the person agreed to
//   SIGNUP_URL     the page they signed up on
//
// Known limit: if someone previously unsubscribed (Brevo blacklists them)
// and signs up again, Brevo keeps them blacklisted. Handle that by hand in
// Brevo (Contacts → the contact → remove from blocklist) if it ever comes up.

const API = 'https://api.brevo.com/v3';
const DEFAULT_LIST_ID = 2;

const CUSTOM_ATTRIBUTES = {
  SIGNUP_SOURCE: 'text',
  CONSENT_AT: 'text',
  CONSENT_TEXT: 'text',
  SIGNUP_URL: 'text',
  COUNTY: 'text',
};

function headers() {
  return {
    'api-key': process.env.BREVO_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

function listId() {
  const n = parseInt(process.env.BREVO_NEWSLETTER_LIST_ID || '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIST_ID;
}

let attributesChecked = false;

// Creates any missing custom attributes. Cached per warm function instance,
// so it costs one extra GET on a cold start and nothing after that.
async function ensureAttributes() {
  if (attributesChecked) return;
  const res = await fetch(`${API}/contacts/attributes`, { headers: headers() });
  if (!res.ok) throw new Error(`list attributes failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const have = new Set((body.attributes || []).map((a) => a.name));
  for (const [name, type] of Object.entries(CUSTOM_ATTRIBUTES)) {
    if (have.has(name)) continue;
    const create = await fetch(`${API}/contacts/attributes/normal/${name}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ type }),
    });
    // 400 "already exists" is fine (another instance got there first).
    if (!create.ok && create.status !== 400) {
      throw new Error(`create attribute ${name} failed: ${create.status} ${await create.text()}`);
    }
  }
  attributesChecked = true;
}

// Adds (or updates) a contact on the newsletter list with their consent
// record. Returns { ok, isNew }. Never throws: callers decide what to do.
async function addNewsletterContact({ email, firstName, county, source, consentText, pageUrl }) {
  if (!process.env.BREVO_API_KEY) {
    console.error('brevo-newsletter: BREVO_API_KEY not set');
    return { ok: false, isNew: false };
  }

  const attributes = { OPT_IN: true };
  if (firstName) attributes.FIRSTNAME = String(firstName).trim().slice(0, 100);

  const consent = {
    SIGNUP_SOURCE: String(source || 'unknown').slice(0, 50),
    CONSENT_AT: new Date().toISOString(),
    CONSENT_TEXT: String(consentText || '').slice(0, 500),
    SIGNUP_URL: String(pageUrl || '').slice(0, 300),
  };
  if (county) consent.COUNTY = String(county).trim().slice(0, 50);

  let haveCustom = true;
  try {
    await ensureAttributes();
  } catch (err) {
    haveCustom = false;
    console.error('brevo-newsletter: could not ensure custom attributes — saving the contact WITHOUT its consent record:', err);
  }

  const send = (attrs) => fetch(`${API}/contacts`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, attributes: attrs, listIds: [listId()], updateEnabled: true }),
  });

  try {
    let res = await send(haveCustom ? { ...attributes, ...consent } : attributes);
    if (res.status === 400 && haveCustom) {
      // Most likely an attribute Brevo doesn't know about yet. Don't lose the sign-up.
      console.error('brevo-newsletter: contact create rejected, retrying without consent attributes:', await res.text());
      res = await send(attributes);
    }
    if (res.status === 201) return { ok: true, isNew: true };
    if (res.status === 204) return { ok: true, isNew: false };
    console.error('brevo-newsletter: contact create failed:', res.status, await res.text());
    return { ok: false, isNew: false };
  } catch (err) {
    console.error('brevo-newsletter: contact create threw:', err);
    return { ok: false, isNew: false };
  }
}

// Unsubscribes a contact by putting them on Brevo's blocklist, which every
// campaign respects. A contact we've never heard of counts as success.
async function unsubscribeContact(email) {
  if (!process.env.BREVO_API_KEY) {
    console.error('brevo-newsletter: BREVO_API_KEY not set');
    return { ok: false };
  }
  try {
    const res = await fetch(`${API}/contacts/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ emailBlacklisted: true, attributes: { OPT_IN: false } }),
    });
    if (res.ok || res.status === 404) return { ok: true };
    console.error('brevo-newsletter: unsubscribe failed:', res.status, await res.text());
    return { ok: false };
  } catch (err) {
    console.error('brevo-newsletter: unsubscribe threw:', err);
    return { ok: false };
  }
}

module.exports = { addNewsletterContact, unsubscribeContact, CUSTOM_ATTRIBUTES };
