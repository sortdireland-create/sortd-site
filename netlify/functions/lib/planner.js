// netlify/functions/lib/planner.js
//
// Shared helpers for the summer planner functions (planner-*.js).
//
// Storage: everything a parent puts in the planner lives as one JSON blob
// in Users.PlannerData (children, weeks, carers, leave). Friend links live
// in Users.PlannerConnections (JSON array of lower-case emails, kept in
// sync on both sides) and each parent's invite code in
// Users.PlannerInviteCode. Keeping it on the Users row means deleting a
// parent's account deletes their planner and children's details with it.
//
// Access during testing: only emails listed in the PLANNER_TESTERS env var
// (comma or newline separated) can use the planner. Everyone else sees it
// greyed out on /account. Set PLANNER_OPEN_TO_ALL=true to open it to every
// logged-in parent later without a code change.
//
// Requires: AIRTABLE_API_KEY, PARENT_SESSION_SECRET, PLANNER_TESTERS

const crypto = require('crypto');
const { getSessionFromEvent } = require('./session');

const BASE_ID = 'appuyWkAmTRI4lN5r';
const USERS_TABLE_ID = 'tblTaHPPgDfxnkdEm';
const F = {
  EMAIL: 'Email',
  DATA: 'PlannerData',
  CODE: 'PlannerInviteCode',
  CONNECTIONS: 'PlannerConnections',
};
const MAX_DATA_CHARS = 90000; // Airtable long text caps at 100k

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extraHeaders || {}),
    body: JSON.stringify(body),
  };
}

function testerList() {
  return String(process.env.PLANNER_TESTERS || '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isTester(email) {
  if (String(process.env.PLANNER_OPEN_TO_ALL || '').toLowerCase() === 'true') return true;
  return testerList().indexOf(String(email || '').toLowerCase()) !== -1;
}

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function airtable(path, opts) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}${path || ''}`, Object.assign({}, opts, {
    headers: Object.assign({ Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' }, (opts && opts.headers) || {}),
  }));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable ${res.status}: ${text}`);
  }
  return res.json();
}

async function findOne(formula) {
  const data = await airtable(`?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`);
  return (data.records && data.records[0]) || null;
}

function findUserByEmail(email) {
  return findOne(`LOWER({${F.EMAIL}}) = '${esc(String(email).toLowerCase())}'`);
}

function findUserByCode(code) {
  if (!/^[A-Za-z0-9]{6,32}$/.test(String(code || ''))) return Promise.resolve(null);
  return findOne(`{${F.CODE}} = '${esc(code)}'`);
}

async function findUsersByEmails(emails) {
  const list = (emails || []).filter(Boolean).slice(0, 50);
  if (!list.length) return [];
  const formula = `OR(${list.map((e) => `LOWER({${F.EMAIL}}) = '${esc(e.toLowerCase())}'`).join(',')})`;
  const data = await airtable(`?filterByFormula=${encodeURIComponent(formula)}&pageSize=50`);
  return data.records || [];
}

function updateUser(id, fields) {
  return airtable('', { method: 'PATCH', body: JSON.stringify({ records: [{ id, fields }], typecast: true }) });
}

function createUser(email, fields) {
  return airtable('', {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: Object.assign({ [F.EMAIL]: email }, fields) }], typecast: true }),
  }).then((d) => d.records[0]);
}

function parseJSON(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

function connectionsOf(record) {
  const arr = parseJSON(record && record.fields[F.CONNECTIONS], []);
  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').map((x) => x.toLowerCase()) : [];
}

function newCode() {
  return crypto.randomBytes(9).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 10).padEnd(10, 'x');
}

// Common gate for every planner function: logged in + on the tester list.
// Returns { email } or a ready-made error response in { error }.
function gate(event) {
  if (!process.env.AIRTABLE_API_KEY) return { error: json(500, { error: 'server_error' }) };
  const session = getSessionFromEvent(event);
  if (!session) return { error: json(401, { error: 'not_logged_in' }) };
  const email = session.email.toLowerCase();
  if (!isTester(email)) return { error: json(403, { error: 'not_a_tester' }) };
  return { email };
}

// What a connected parent is allowed to see: their first name, children's
// first names and ages, and camps/weeks with Planned/Booked status. Costs,
// carers, pick-ups, leave and own-plan blocks stay private.
function friendView(record) {
  const plan = parseJSON(record.fields[F.DATA], {}) || {};
  const kids = Array.isArray(plan.kids) ? plan.kids : [];
  const plans = Array.isArray(plan.plans) ? plan.plans : [];
  return {
    id: record.id,
    name: (plan.me && plan.me.name) || 'A Sortd parent',
    kids: kids.map((k) => ({ id: k.id, name: k.name, age: k.age })),
    plans: plans
      .filter((p) => p && p.kind === 'camp' && p.camp)
      .map((p) => ({
        kid: p.kid,
        week: p.week,
        status: p.status === 'booked' ? 'booked' : 'planned',
        camp: {
          id: p.camp.id || null,
          name: p.camp.name || '',
          prov: p.camp.prov || '',
          area: p.camp.area || '',
          time: p.camp.time || '',
          price: typeof p.camp.price === 'number' ? p.camp.price : 0,
          url: p.camp.url || '',
          listingUrl: p.camp.listingUrl || '',
          ageMin: p.camp.ageMin || null,
          ageMax: p.camp.ageMax || null,
        },
      })),
  };
}

module.exports = {
  F,
  MAX_DATA_CHARS,
  json,
  isTester,
  gate,
  findUserByEmail,
  findUserByCode,
  findUsersByEmails,
  updateUser,
  createUser,
  parseJSON,
  connectionsOf,
  newCode,
  friendView,
};
