// netlify/functions/santa-list.js — the Sortd Santa List (sortd-ireland.ie/christmas).
//
// Parents use their normal Sortd account (magic link, lib/session.js). Each
// family is one "Santa Families" row; each gift is one "Santa Gifts" row, so
// two parents editing at once never overwrite each other's gifts.
//
// GET                    → { loggedIn, email, family, gifts, pollToken }
// GET ?poll=<pollToken>  → { gifts } — cheap refresh for the open page: the
//                          signed pollToken proves membership, so this is
//                          ONE Airtable call (the gifts), not two.
// GET ?share=<token>     → read-only family-givers view: the family's name,
//                          children's first names and the FAMILY gifts only.
//                          Santa gifts are never returned on this path.
//
// POST (logged in, member of the family):
//   { action:'create', familyName, kids:[{name,emoji}] }
//   { action:'kids', kids }                    → rename/add/remove children
//   { action:'add', gift }                     → gift: {kid, from, name, price, url, who}
//   { action:'update', id, gift }              → any of the gift fields + status
//   { action:'delete', id }
//   { action:'join', code }                    → partner joins with the invite code
//   { action:'resetShare' }                    → new givers link (old one stops working)
// POST (no login, with the givers link):
//   { action:'claim', share, id, name }        → "I'll get this"
//
// Storage lives in the main Sortd base next to Users. Requires the env vars
// every parent function already uses: AIRTABLE_API_KEY, PARENT_SESSION_SECRET.

const crypto = require('crypto');
const { getSessionFromEvent } = require('./lib/session');
const { emailShell, emailButton, escapeHtml } = require('./lib/email-shell');

const BASE_ID = 'appuyWkAmTRI4lN5r';
const FAMILIES = 'tblQ18fmUMPGiT9HA'; // "Santa Families"
const GIFTS = 'tblWeCXptEF87FoaA';    // "Santa Gifts"

const FF = { NAME: 'FamilyName', ID: 'FamilyId', OWNER: 'OwnerEmail', MEMBERS: 'MemberEmails', KIDS: 'Kids', CODE: 'InviteCode', SHARE: 'ShareToken', CREATED: 'CreatedAt' };
const GF = { NAME: 'Gift', FAMILY: 'FamilyId', KID: 'KidId', FROM: 'From', PRICE: 'Price', URL: 'URL', WHO: 'ForWho', STATUS: 'Status', CLAIMED: 'ClaimedBy', ADDED_BY: 'AddedBy', CREATED: 'CreatedAt' };

const MAX_GIFTS = 300;
const MAX_KIDS = 8;
const MAX_MEMBERS = 4;
const POLL_TOKEN_TTL = 60 * 60 * 12; // 12 hours
const STATUSES = ['Idea', 'Bought', 'Wrapped'];
const EMOJIS = ['🦄', '🦖', '🧸', '🚀', '🐻', '🌟', '🐰', '⚽'];

// ── helpers ─────────────────────────────────────────────────────
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
function esc(v) { return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
function str(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function rid(n) { return crypto.randomBytes(n).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, n + 4); }
function token(len) { let t = ''; while (t.length < len) t += rid(24); return t.slice(0, len); }
function parseJSON(raw, fb) { try { return raw ? JSON.parse(raw) : fb; } catch (e) { return fb; } }
function safeUrl(u) {
  const s = str(u, 1000);
  if (!s) return '';
  try { const x = new URL(s); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.toString() : ''; } catch (e) { return ''; }
}
function price(v) { const n = parseFloat(v); return isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : 0; }

async function airtable(table, path, opts) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${table}${path || ''}`, Object.assign({}, opts, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
  }));
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Airtable ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
async function findOne(table, formula) {
  const d = await airtable(table, `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`);
  return (d.records && d.records[0]) || null;
}
async function listAll(table, formula) {
  let out = [], offset = '';
  for (let i = 0; i < 5; i++) {
    const d = await airtable(table, `?filterByFormula=${encodeURIComponent(formula)}&pageSize=100${offset ? '&offset=' + encodeURIComponent(offset) : ''}`);
    out = out.concat(d.records || []);
    if (!d.offset) break;
    offset = d.offset;
  }
  return out;
}

// Signed poll token: lets the open page refresh gifts with one Airtable call.
function hmac(s) { return crypto.createHmac('sha256', process.env.PARENT_SESSION_SECRET).update('santa:' + s).digest('base64url'); }
function makePollToken(email, familyId) {
  const payload = Buffer.from(JSON.stringify({ e: email, f: familyId, x: Math.floor(Date.now() / 1000) + POLL_TOKEN_TTL })).toString('base64url');
  return payload + '.' + hmac(payload);
}
function readPollToken(t, email) {
  const [payload, sig] = String(t || '').split('.');
  if (!payload || !sig) return null;
  const want = hmac(payload);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  const p = parseJSON(Buffer.from(payload, 'base64url').toString('utf8'), null);
  if (!p || p.e !== email || !p.f || p.x < Date.now() / 1000) return null;
  return p.f;
}

function membersOf(rec) {
  return String(rec.fields[FF.MEMBERS] || '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}
function kidsOf(rec) {
  const k = parseJSON(rec.fields[FF.KIDS], []);
  return Array.isArray(k) ? k : [];
}
function familyForEmail(email) {
  return findOne(FAMILIES, `FIND(',${esc(email)},', ',' & SUBSTITUTE(LOWER({${FF.MEMBERS}}), ' ', '') & ',')`);
}
// Everyone using the Santa List also gets the Sortd calendar: tick
// Users.PlannerAccess (see lib/planner.js) if it isn't already. Best-effort.
const USERS = 'tblTaHPPgDfxnkdEm';
async function ensurePlannerAccess(email) {
  try {
    const u = await findOne(USERS, `LOWER({Email}) = '${esc(email)}'`);
    if (u && !u.fields.PlannerAccess) {
      await airtable(USERS, '', { method: 'PATCH', body: JSON.stringify({ records: [{ id: u.id, fields: { PlannerAccess: true } }] }) });
    }
    return !!u;
  } catch (e) {
    console.error('santa-list: ensurePlannerAccess failed', e.message);
    return false;
  }
}

function familyView(rec, full) {
  const v = { id: rec.fields[FF.ID], name: rec.fields[FF.NAME] || 'Our family', kids: kidsOf(rec) };
  if (full) {
    v.inviteCode = rec.fields[FF.CODE] || '';
    v.shareToken = rec.fields[FF.SHARE] || '';
    v.members = membersOf(rec);
  }
  return v;
}
function giftView(rec, forGivers) {
  const f = rec.fields;
  const kids = String(f[GF.KID] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const g = {
    id: rec.id,
    kid: kids[0] || '',
    kids,
    name: f[GF.NAME] || '',
    price: typeof f[GF.PRICE] === 'number' ? f[GF.PRICE] : 0,
    url: f[GF.URL] || '',
    who: f[GF.WHO] || '',
    claimedBy: f[GF.CLAIMED] || '',
  };
  if (forGivers) {
    // Givers see whether it's taken, never the parents' bought/wrapped status.
    g.taken = !!g.claimedBy || (f[GF.STATUS] && f[GF.STATUS] !== 'Idea');
    return g;
  }
  g.from = f[GF.FROM] === 'Santa' ? 'santa' : 'family';
  g.status = STATUSES.indexOf(f[GF.STATUS]) !== -1 ? f[GF.STATUS].toLowerCase() : 'idea';
  g.addedBy = f[GF.ADDED_BY] || '';
  g.created = f[GF.CREATED] || '';
  return g;
}
async function giftsFor(familyId) {
  const recs = await listAll(GIFTS, `{${GF.FAMILY}} = '${esc(familyId)}'`);
  recs.sort((a, b) => String(a.fields[GF.CREATED] || a.createdTime).localeCompare(String(b.fields[GF.CREATED] || b.createdTime)));
  return recs;
}
function cleanKids(input, existing) {
  const list = Array.isArray(input) ? input.slice(0, MAX_KIDS) : [];
  const known = new Set((existing || []).map((k) => k.id));
  return list.map((k, i) => {
    const name = str(k && k.name, 30);
    if (!name) return null;
    const id = k && known.has(k.id) ? k.id : 'k' + rid(6);
    const emoji = EMOJIS.indexOf(k && k.emoji) !== -1 ? k.emoji : EMOJIS[i % EMOJIS.length];
    return { id, name, emoji };
  }).filter(Boolean);
}
function giftFields(g, kids, partial) {
  const out = {};
  if (!partial || g.name !== undefined) { const n = str(g.name, 150); if (!n) return { error: 'name_required' }; out[GF.NAME] = n; }
  if (!partial || g.kid !== undefined || g.kids !== undefined) {
    // One gift can be for several children (a joint Santa gift). Stored as
    // comma-separated kid ids in KidId.
    const want = Array.isArray(g.kids) ? g.kids : [g.kid];
    const ids = [];
    want.forEach((id) => { if (kids.some((k) => k.id === id) && ids.indexOf(id) === -1) ids.push(id); });
    if (!ids.length) return { error: 'bad_kid' };
    out[GF.KID] = ids.join(',');
  }
  if (!partial || g.from !== undefined) out[GF.FROM] = g.from === 'santa' ? 'Santa' : 'Family';
  if (!partial || g.price !== undefined) out[GF.PRICE] = price(g.price);
  if (!partial || g.url !== undefined) out[GF.URL] = safeUrl(g.url) || null;
  if (!partial || g.who !== undefined) out[GF.WHO] = str(g.who, 60);
  if (g.status !== undefined) {
    const s = String(g.status || '').toLowerCase();
    out[GF.STATUS] = s === 'bought' ? 'Bought' : s === 'wrapped' ? 'Wrapped' : 'Idea';
  }
  if (g.claimedBy !== undefined) out[GF.CLAIMED] = str(g.claimedBy, 40); // parents can clear a claim
  return { fields: out };
}
async function giftInFamily(id, familyId) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(String(id || ''))) return null;
  try {
    const rec = await airtable(GIFTS, '/' + id);
    return rec && rec.fields && rec.fields[GF.FAMILY] === familyId ? rec : null;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// ── GET ────────────────────────────────────────────────────────
async function handleGet(event) {
  const q = event.queryStringParameters || {};

  if (q.share) {
    if (!/^[A-Za-z0-9]{16,64}$/.test(q.share)) return json(404, { error: 'not_found' });
    const fam = await findOne(FAMILIES, `{${FF.SHARE}} = '${esc(q.share)}'`);
    if (!fam) return json(404, { error: 'not_found' });
    const gifts = (await giftsFor(fam.fields[FF.ID])).filter((r) => r.fields[GF.FROM] !== 'Santa');
    return json(200, { family: familyView(fam, false), gifts: gifts.map((r) => giftView(r, true)) });
  }

  const session = getSessionFromEvent(event);
  if (!session) return json(200, { loggedIn: false });
  const email = session.email.toLowerCase();

  if (q.poll) {
    const familyId = readPollToken(q.poll, email);
    if (!familyId) return json(401, { error: 'stale' }); // page falls back to a full GET
    const gifts = await giftsFor(familyId);
    return json(200, { gifts: gifts.map((r) => giftView(r, false)) });
  }

  const fam = await familyForEmail(email);
  // Only people who actually have a Santa List get the calendar from here.
  // (New Santa List logins get it in verify-login.js; /account also calls
  // this GET, so it must not grant access just for being logged in.)
  if (!fam) return json(200, { loggedIn: true, email, planner: false, family: null, gifts: [] });
  const familyId = fam.fields[FF.ID];
  const [gifts, planner] = await Promise.all([giftsFor(familyId), ensurePlannerAccess(email)]);
  return json(200, {
    loggedIn: true,
    email,
    planner,
    family: familyView(fam, true),
    gifts: gifts.map((r) => giftView(r, false)),
    pollToken: makePollToken(email, familyId),
  });
}

// ── POST ───────────────────────────────────────────────────────
async function handleClaim(body) {
  const share = String(body.share || '');
  if (!/^[A-Za-z0-9]{16,64}$/.test(share)) return json(404, { error: 'not_found' });
  const name = str(body.name, 40);
  if (!name) return json(400, { error: 'name_required' });
  const fam = await findOne(FAMILIES, `{${FF.SHARE}} = '${esc(share)}'`);
  if (!fam) return json(404, { error: 'not_found' });
  const rec = await giftInFamily(body.id, fam.fields[FF.ID]);
  if (!rec || rec.fields[GF.FROM] === 'Santa') return json(404, { error: 'not_found' });
  if (rec.fields[GF.CLAIMED] || (rec.fields[GF.STATUS] && rec.fields[GF.STATUS] !== 'Idea')) return json(409, { error: 'taken' });
  await airtable(GIFTS, '', { method: 'PATCH', body: JSON.stringify({ records: [{ id: rec.id, fields: { [GF.CLAIMED]: name } }] }) });
  try { await sendClaimEmail(fam, rec, name); } catch (e) { console.error('santa-list: claim email failed', e.message); }
  return json(200, { ok: true });
}

// Tell the parents when a family giver claims a gift on the family link.
async function sendClaimEmail(fam, rec, giver) {
  const apiKey = process.env.BREVO_API_KEY;
  const to = membersOf(fam);
  if (!apiKey || !to.length) return;
  const gift = str(rec.fields[GF.NAME], 150);
  const kidIds = String(rec.fields[GF.KID] || '').split(',');
  const names = kidsOf(fam).filter((k) => kidIds.indexOf(k.id) !== -1).map((k) => k.name);
  const forWho = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : (names[0] || 'the kids');
  const link = 'https://sortd-ireland.ie/christmas';
  const html = emailShell(`
    <p style="margin:0 0 6px;font-family:'Baloo 2','Trebuchet MS',Verdana,Arial,sans-serif;font-size:22px;font-weight:800;line-height:1.25;">${escapeHtml(giver)} is getting ${escapeHtml(gift)}</p>
    <p style="margin:0 0 4px;">${escapeHtml(giver)} tapped "I'll get this" on your family link, for ${escapeHtml(forWho)}. It's marked as claimed on your Santa List, so nobody else will buy it.</p>
    ${emailButton('Open my Santa List', link)}
    <p style="margin:0;">Rachel<br><span style="color:#5B6783;">sortd</span></p>
  `, null, { audience: 'parent', eyebrow: 'Santa List' });
  const text = `${giver} is getting ${gift} for ${forWho}.\n\nThey tapped "I'll get this" on your family link, so it's marked as claimed on your Santa List.\n\nOpen your list: ${link}\n\nRachel\nsortd`;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Rachel at Sortd', email: 'hello@sortd-ireland.ie' },
      to: to.map((email) => ({ email })),
      subject: `${giver} is getting ${gift}`.slice(0, 150),
      htmlContent: html,
      textContent: text,
      tags: ['santa-claim'],
    }),
  });
  if (!res.ok) console.error('santa-list: Brevo claim email failed:', await res.text());
}

async function handlePost(event) {
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad_request' }); }
  const action = String(body.action || '');

  if (action === 'claim') return handleClaim(body);

  const session = getSessionFromEvent(event);
  if (!session) return json(401, { error: 'not_logged_in' });
  const email = session.email.toLowerCase();
  const fam = await familyForEmail(email);

  if (action === 'create') {
    if (fam) return json(409, { error: 'already_in_family' });
    const kids = cleanKids(body.kids, []);
    if (!kids.length) return json(400, { error: 'kids_required' });
    const familyId = 'f' + rid(10);
    await airtable(FAMILIES, '', {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields: {
        [FF.NAME]: str(body.familyName, 60) || 'Our family',
        [FF.ID]: familyId,
        [FF.OWNER]: email,
        [FF.MEMBERS]: email,
        [FF.KIDS]: JSON.stringify(kids),
        [FF.CODE]: token(10),
        [FF.SHARE]: token(24),
        [FF.CREATED]: new Date().toISOString(),
      } }] }),
    });
    await ensurePlannerAccess(email);
    return json(200, { ok: true });
  }

  if (action === 'join') {
    const code = String(body.code || '');
    if (!/^[A-Za-z0-9]{6,32}$/.test(code)) return json(404, { error: 'bad_code' });
    const target = await findOne(FAMILIES, `{${FF.CODE}} = '${esc(code)}'`);
    if (!target) return json(404, { error: 'bad_code' });
    if (fam && fam.id === target.id) return json(200, { ok: true });
    if (fam) return json(409, { error: 'already_in_family' });
    const members = membersOf(target);
    if (members.length >= MAX_MEMBERS) return json(409, { error: 'family_full' });
    members.push(email);
    await airtable(FAMILIES, '', { method: 'PATCH', body: JSON.stringify({ records: [{ id: target.id, fields: { [FF.MEMBERS]: members.join(', ') } }] }) });
    await ensurePlannerAccess(email);
    return json(200, { ok: true });
  }

  if (!fam) return json(404, { error: 'no_family' });
  const familyId = fam.fields[FF.ID];
  const kids = kidsOf(fam);

  if (action === 'kids') {
    const next = cleanKids(body.kids, kids);
    if (!next.length) return json(400, { error: 'kids_required' });
    const fields = { [FF.KIDS]: JSON.stringify(next) };
    if (body.familyName !== undefined) fields[FF.NAME] = str(body.familyName, 60) || 'Our family';
    await airtable(FAMILIES, '', { method: 'PATCH', body: JSON.stringify({ records: [{ id: fam.id, fields }] }) });
    return json(200, { ok: true, kids: next });
  }

  if (action === 'resetShare') {
    const share = token(24);
    await airtable(FAMILIES, '', { method: 'PATCH', body: JSON.stringify({ records: [{ id: fam.id, fields: { [FF.SHARE]: share } }] }) });
    return json(200, { ok: true, shareToken: share });
  }

  if (action === 'add') {
    const r = giftFields(body.gift || {}, kids, false);
    if (r.error) return json(400, { error: r.error });
    const count = (await listAll(GIFTS, `{${GF.FAMILY}} = '${esc(familyId)}'`)).length;
    if (count >= MAX_GIFTS) return json(409, { error: 'too_many_gifts' });
    Object.assign(r.fields, { [GF.FAMILY]: familyId, [GF.STATUS]: 'Idea', [GF.ADDED_BY]: email, [GF.CREATED]: new Date().toISOString() });
    const d = await airtable(GIFTS, '', { method: 'POST', body: JSON.stringify({ records: [{ fields: r.fields }], typecast: true }) });
    return json(200, { ok: true, gift: giftView(d.records[0], false) });
  }

  if (action === 'update' || action === 'delete') {
    const rec = await giftInFamily(body.id, familyId);
    if (!rec) return json(404, { error: 'not_found' });
    if (action === 'delete') {
      await airtable(GIFTS, '/' + rec.id, { method: 'DELETE' });
      return json(200, { ok: true });
    }
    const r = giftFields(body.gift || {}, kids, true);
    if (r.error) return json(400, { error: r.error });
    const d = await airtable(GIFTS, '', { method: 'PATCH', body: JSON.stringify({ records: [{ id: rec.id, fields: r.fields }], typecast: true }) });
    return json(200, { ok: true, gift: giftView(d.records[0], false) });
  }

  return json(400, { error: 'unknown_action' });
}

exports.handler = async function (event) {
  if (!process.env.AIRTABLE_API_KEY || !process.env.PARENT_SESSION_SECRET) return json(500, { error: 'server_error' });
  try {
    if (event.httpMethod === 'GET') return await handleGet(event);
    if (event.httpMethod === 'POST') return await handlePost(event);
    return json(405, { error: 'method_not_allowed' });
  } catch (err) {
    console.error('santa-list error:', err);
    if (err.status === 429) return json(503, { error: 'busy' });
    return json(500, { error: 'server_error' });
  }
};

// Exported for tests only.
exports._internals = { cleanKids, giftFields, safeUrl, makePollToken, readPollToken, familyView, giftView };
