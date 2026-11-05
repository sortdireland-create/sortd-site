// netlify/functions/planner.js — the summer planner's one endpoint.
//
// GET  → { loggedIn, tester, plan, inviteCode, friends }
//        Not logged in / not a tester is not an error here: /account calls
//        this to decide whether to show the planner card or grey it out.
// POST { action: 'save', plan }        → saves the whole planner JSON
// POST { action: 'addClass', cls, kidIds, newKids } → adds a weekly class to the Sortd calendar
// POST { action: 'invite' }            → returns (creating if needed) the invite code
// POST { action: 'join', code }        → connects the caller with the code's owner
// POST { action: 'disconnect', id }    → removes a connection on both sides
//
// See lib/planner.js for storage and the tester gate.

const { getSessionFromEvent } = require('./lib/session');
const P = require('./lib/planner');

async function handleGet(event) {
  const session = getSessionFromEvent(event);
  if (!session) return P.json(200, { loggedIn: false, tester: false });
  const email = session.email.toLowerCase();
  if (!P.isTester(email)) return P.json(200, { loggedIn: true, tester: false });
  if (!process.env.AIRTABLE_API_KEY) return P.json(500, { error: 'server_error' });

  const me = await P.findUserByEmail(email);
  const plan = me ? P.parseJSON(me.fields[P.F.DATA], null) : null;
  const conns = me ? P.connectionsOf(me) : [];
  const friendRecords = await P.findUsersByEmails(conns);
  return P.json(200, {
    loggedIn: true,
    tester: true,
    email,
    plan,
    inviteCode: (me && me.fields[P.F.CODE]) || null,
    friends: friendRecords.map(P.friendView),
  });
}

async function getOrCreateMe(email) {
  return (await P.findUserByEmail(email)) || P.createUser(email, {});
}

async function handleSave(email, body) {
  const plan = body.plan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return P.json(400, { error: 'bad_plan' });
  const str = JSON.stringify(plan);
  if (str.length > P.MAX_DATA_CHARS) return P.json(413, { error: 'plan_too_big' });
  const me = await getOrCreateMe(email);
  await P.updateUser(me.id, { [P.F.DATA]: str });
  return P.json(200, { ok: true, savedAt: new Date().toISOString() });
}

// Class pages call this to put a weekly class straight into the parent's
// Sortd calendar (plan.classes). Creates the planner if they don't have one
// yet, and any new children typed in on the class page.
const KID_COLOURS = ['--gr', '--pk', '--sk', '--pu', '--ochre', '--teal'];
function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function isoOrNull(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null; }
function rid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
async function handleAddClass(email, body) {
  const c = body.cls || {};
  const day = Number(c.day), start = Number(c.start), end = Number(c.end);
  if (!(day >= 0 && day <= 6) || !(start >= 0 && end > start && end <= 24 * 60)) return P.json(400, { error: 'bad_class' });
  const listing = c.listing || {};
  const me = await getOrCreateMe(email);
  let plan = P.parseJSON(me.fields[P.F.DATA], null);
  if (!plan || typeof plan !== 'object') {
    plan = { v: 1, me: { name: '' }, partner: '', kids: [], carers: [{ id: 'you', name: 'You', col: '--sk' }], plans: [], days: {}, pendingBook: [], classes: [] };
  }
  ['kids', 'classes', 'plans', 'carers', 'pendingBook'].forEach(k => { if (!Array.isArray(plan[k])) plan[k] = []; });
  const kidIds = (Array.isArray(body.kidIds) ? body.kidIds : []).filter(id => plan.kids.some(k => k.id === id));
  (Array.isArray(body.newKids) ? body.newKids : []).slice(0, 6).forEach(nk => {
    const name = str(nk && nk.name, 30); if (!name) return;
    const age = nk.age === '' || nk.age == null ? '' : Math.max(0, Math.min(17, parseInt(nk.age, 10) || 0));
    const kid = { id: rid('k'), name, age, col: KID_COLOURS[plan.kids.length % KID_COLOURS.length] };
    plan.kids.push(kid); kidIds.push(kid.id);
  });
  if (!kidIds.length) return P.json(400, { error: 'no_child' });
  const entry = {
    id: rid('c'),
    kids: kidIds,
    listing: { id: str(listing.id, 30) || null, name: str(listing.name, 120), provider: str(listing.provider, 120), url: str(listing.url, 300), area: str(listing.area, 80), bookingUrl: str(listing.bookingUrl, 300) },
    label: str(c.label, 80), venue: str(c.venue, 120), day, start, end,
    from: isoOrNull(c.from), until: isoOrNull(c.until), addedAt: new Date().toISOString(),
  };
  if (!entry.listing.name) return P.json(400, { error: 'bad_class' });
  // Same class, same slot already there: just add the children to it.
  const same = plan.classes.find(x => x.listing && x.listing.id && x.listing.id === entry.listing.id && x.day === day && x.start === start);
  if (same) { kidIds.forEach(id => { if (same.kids.indexOf(id) === -1) same.kids.push(id); }); same.until = entry.until; same.from = same.from && entry.from && same.from < entry.from ? same.from : entry.from; }
  else plan.classes.push(entry);
  const out = JSON.stringify(plan);
  if (out.length > P.MAX_DATA_CHARS) return P.json(413, { error: 'plan_too_big' });
  await P.updateUser(me.id, { [P.F.DATA]: out });
  return P.json(200, { ok: true, classId: same ? same.id : entry.id, kids: plan.kids });
}

async function handleInvite(email) {
  const me = await getOrCreateMe(email);
  let code = me.fields[P.F.CODE];
  if (!code) {
    code = P.newCode();
    await P.updateUser(me.id, { [P.F.CODE]: code });
  }
  return P.json(200, { code });
}

async function handleJoin(email, body) {
  const owner = await P.findUserByCode(body.code);
  if (!owner) return P.json(404, { error: 'invalid_code' });
  const ownerEmail = String(owner.fields[P.F.EMAIL] || '').toLowerCase();
  if (ownerEmail === email) return P.json(400, { error: 'own_code' });
  if (!P.isTester(ownerEmail)) return P.json(404, { error: 'invalid_code' });

  const me = await getOrCreateMe(email);
  const mine = P.connectionsOf(me);
  const theirs = P.connectionsOf(owner);
  if (mine.indexOf(ownerEmail) === -1) mine.push(ownerEmail);
  if (theirs.indexOf(email) === -1) theirs.push(email);
  await P.updateUser(me.id, { [P.F.CONNECTIONS]: JSON.stringify(mine) });
  await P.updateUser(owner.id, { [P.F.CONNECTIONS]: JSON.stringify(theirs) });
  return P.json(200, { ok: true, friend: P.friendView(owner) });
}

async function handleDisconnect(email, body) {
  const me = await P.findUserByEmail(email);
  if (!me) return P.json(200, { ok: true });
  const mine = P.connectionsOf(me);
  const friends = await P.findUsersByEmails(mine);
  const friend = friends.find((r) => r.id === body.id);
  if (!friend) return P.json(200, { ok: true });
  const friendEmail = String(friend.fields[P.F.EMAIL] || '').toLowerCase();
  await P.updateUser(me.id, { [P.F.CONNECTIONS]: JSON.stringify(mine.filter((e) => e !== friendEmail)) });
  await P.updateUser(friend.id, { [P.F.CONNECTIONS]: JSON.stringify(P.connectionsOf(friend).filter((e) => e !== email)) });
  return P.json(200, { ok: true });
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod === 'GET') return await handleGet(event);
    if (event.httpMethod !== 'POST') return P.json(405, { error: 'method_not_allowed' });

    const g = P.gate(event);
    if (g.error) return g.error;
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (e) { return P.json(400, { error: 'bad_json' }); }

    switch (body.action) {
      case 'save': return await handleSave(g.email, body);
      case 'addClass': return await handleAddClass(g.email, body);
      case 'invite': return await handleInvite(g.email);
      case 'join': return await handleJoin(g.email, body);
      case 'disconnect': return await handleDisconnect(g.email, body);
      default: return P.json(400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error('planner error:', err);
    return P.json(500, { error: 'server_error' });
  }
};
