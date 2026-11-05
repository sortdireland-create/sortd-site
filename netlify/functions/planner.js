// netlify/functions/planner.js — the summer planner's one endpoint.
//
// GET  → { loggedIn, tester, plan, inviteCode, friends }
//        Not logged in / not a tester is not an error here: /account calls
//        this to decide whether to show the planner card or grey it out.
// POST { action: 'save', plan }        → saves the whole planner JSON
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
