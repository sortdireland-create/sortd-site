// js/planner.js — the live summer planner at /planner.
//
// Loads the parent's planner from /.netlify/functions/planner, renders it,
// and autosaves the whole planner JSON a moment after every change. Access
// is limited to testers server-side (PLANNER_TESTERS); this page just shows
// a friendly message to anyone else.
//
// Camps come from the same LISTINGS dataset as the rest of the site
// (js/camps-data.js). A camp added to a plan is stored as a snapshot (name,
// provider, price, links) so it still shows if the listing later expires.
(function () {
  'use strict';
  var API = '/.netlify/functions/planner';
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var DAYS = ['Mon','Tue','Wed','Thu','Fri'];
  var YEAR = 2027;
  // Irish primary schools: summer runs roughly late June to end of August.
  // 9 weeks from Mon 28 June 2027; Mon 2 August 2027 is the bank holiday.
  var WEEKS = Array.from({ length: 9 }, function (_, i) {
    var s = new Date(YEAR, 5, 28 + 7 * i), e = new Date(YEAR, 5, 32 + 7 * i);
    return { i: i, start: s, label: s.getDate() + ' ' + MONTHS[s.getMonth()] + ' – ' + e.getDate() + ' ' + MONTHS[e.getMonth()],
      bank: (s.getMonth() === 7 && s.getDate() <= 7) ? 0 : null };
  });
  var COLOURS = ['--sk','--pu','--pk','--gr','--teal','--plum','--ochre','--warn','--slate','--nv'];
  var KID_COLOURS = ['--gr','--pk','--sk','--pu','--ochre','--teal'];
  var DAYS_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var ROWS = [['drop','Drop off'],['pick','Pick up'],['aft','Afternoon care'],['leaveYou','Your leave'],['leavePartner','partner']];

  var SY = window.SortdSchoolYear;
  var state = { view: 'calendar', plan: null, friends: [], inviteCode: null, savedIds: [], weekStart: null };
  var uidN = 0;
  function uid(p) { return (p || 'x') + Date.now().toString(36) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 5); }

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { u = String(u || '').trim(); if (/^https?:\/\//i.test(u)) return u; if (/^\/[^/]/.test(u)) return u; return ''; }
  function euro(n) { return '€' + Math.round(n || 0).toLocaleString('en-IE'); }
  function short(n) { var w = String(n || '?').trim().split(/\s+/)[0]; return w.length > 7 ? w.slice(0, 6) + '…' : w; }
  function P() { return state.plan; }
  function kids() { return P().kids; }
  function kidById(id) { return kids().find(function (k) { return k.id === id; }); }
  function carer(id) { return P().carers.find(function (c) { return c.id === id; }); }
  function partnerName() { return (P().partner || '').trim(); }
  function planFor(kid, w) { return P().plans.find(function (p) { return p.kid === kid && p.week === w; }); }
  function planById(id) { return P().plans.find(function (p) { return p.id === id; }); }
  function planCost(p) {
    if (p.kind === 'camp') return (typeof p.cost === 'number') ? p.cost : ((p.camp && p.camp.price) || 0);
    return p.cost || 0;
  }
  function campKey(c) { return c ? (c.id || String(c.name || '').toLowerCase().trim()) : ''; }
  function day(w, d) {
    var k = w + '-' + d;
    return P().days[k] || (P().days[k] = { drop: null, pick: null, aft: null, leaveYou: 0, leavePartner: 0 });
  }
  function fitsAge(c, age) {
    if (!c || age == null || age === '') return true;
    var lo = c.ageMin, hi = c.ageMax;
    return (lo == null || age >= lo) && (hi == null || age <= hi);
  }
  function friendKidName(f, kidId) { var k = (f.kids || []).find(function (x) { return x.id === kidId; }); return k ? k.name : f.name; }
  function friendsAt(c, w) {
    var key = campKey(c), out = [];
    state.friends.forEach(function (f) {
      (f.plans || []).forEach(function (p) {
        if (p.week === w && campKey(p.camp) === key) out.push({ f: f, kidName: friendKidName(f, p.kid), status: p.status });
      });
    });
    return out;
  }
  function sortdCamps() {
    if (typeof LISTINGS === 'undefined') return [];
    return LISTINGS.filter(function (l) { return l.type !== 'weekly'; }).map(function (l) {
      return { id: l.id, name: l.name, prov: l.provider, area: l.area, time: l.times, price: l.costValue || 0, costText: l.cost,
        url: l.bookingUrl, listingUrl: l.listingUrl, ageMin: l.ageMin, ageMax: l.ageMax, weeks: (l.weeks || []).join(', '), category: l.category };
    });
  }
  function totals() {
    var cost = 0, booked = 0, planned = 0, gaps = 0, you = 0, partner = 0;
    P().plans.forEach(function (p) { cost += planCost(p); if (p.kind === 'camp') { if (p.status === 'booked') booked++; else planned++; } });
    kids().forEach(function (k) { WEEKS.forEach(function (w) { if (!planFor(k.id, w.i)) gaps++; }); });
    Object.keys(P().days).forEach(function (k) { var d = P().days[k]; you += d.leaveYou || 0; partner += d.leavePartner || 0; });
    return { cost: cost, booked: booked, planned: planned, gaps: gaps, you: you, partner: partner };
  }
  var toastT;
  function toast(msg) {
    var l = document.getElementById('layer'); var old = l.querySelector('.toast'); if (old) old.remove();
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; l.appendChild(t);
    clearTimeout(toastT); toastT = setTimeout(function () { t.remove(); }, 2800);
  }

  // ---------- saving ----------
  var saveT = null, saving = false, dirty = false;
  function setSaveState(txt, err) { var el = document.getElementById('savestate'); el.textContent = txt; el.className = 'savestate' + (err ? ' err' : ''); }
  function changed() { dirty = true; setSaveState('Saving…'); clearTimeout(saveT); saveT = setTimeout(save, 700); }
  function save() {
    if (saving) { saveT = setTimeout(save, 400); return; }
    saving = true; dirty = false;
    fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', plan: P() }) })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function () { saving = false; if (!dirty) setSaveState('Saved'); })
      .catch(function () { saving = false; dirty = true; setSaveState('Not saved, retrying…', true); saveT = setTimeout(save, 5000); });
  }
  window.addEventListener('beforeunload', function (e) {
    if (dirty && P()) {
      try { fetch(API, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', plan: P() }) }); } catch (_) {}
    }
  });
  function post(body) {
    return fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.error || r.status); e.code = j.error; throw e; } return j; }); });
  }

  // ---------- views ----------
  function render() {
    document.getElementById('tabs').hidden = false;
    document.querySelectorAll('.tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.dataset.view === state.view)); });
    var app = document.getElementById('app');
    var v = state.view;
    app.innerHTML = v === 'calendar' ? viewCalendar() : v === 'how' ? viewHow() : v === 'cal' ? viewCal() : v === 'friends' ? viewFriends() : v === 'costs' ? viewCosts() : viewPlan();
  }
  function rerenderKeepOpen() {
    var open = Array.prototype.map.call(document.querySelectorAll('details.days'), function (d) { return d.open; });
    render();
    document.querySelectorAll('details.days').forEach(function (d, i) { if (open[i] != null) d.open = open[i]; });
  }
  function summaryTiles() {
    var t = totals(), pn = partnerName();
    return '<div class="summary">' +
      '<div class="tile"><span class="k">Summer total</span><span class="v">' + euro(t.cost) + '</span><span class="s">' + kids().length + ' ' + (kids().length === 1 ? 'child' : 'kids') + ' · 9 weeks</span></div>' +
      '<div class="tile"><span class="k">Booked</span><span class="v">' + t.booked + '</span><span class="s">' + t.planned + ' still planned</span></div>' +
      '<div class="tile ' + (t.gaps ? 'alert' : '') + '"><span class="k">Gaps</span><span class="v">' + t.gaps + '</span><span class="s">child-weeks with nothing on</span></div>' +
      '<div class="tile"><span class="k">Annual leave</span><span class="v">' + (t.you + t.partner) + '</span><span class="s">You ' + t.you + (pn ? ' · ' + esc(pn) + ' ' + t.partner : '') + ' days</span></div>' +
      '</div>';
  }
  function bookPrompt() {
    var pend = (P().pendingBook || []).map(planById).filter(function (p) { return p && p.kind === 'camp' && p.status !== 'booked'; });
    if (!pend.length) return '';
    var p = pend[0], k = kidById(p.kid);
    return '<div class="banner" role="region" aria-label="Booking check"><b>Did you book ' + esc(p.camp.name) + ' for ' + esc(k ? k.name : 'your child') + '?</b>' +
      '<span class="cmeta">Week ' + (p.week + 1) + ' · ' + WEEKS[p.week].label + '</span>' +
      '<div class="actions"><button class="btn green" data-act="markbooked" data-id="' + esc(p.id) + '">Yes, I booked it</button>' +
      '<button class="btn light" data-act="notyet" data-id="' + esc(p.id) + '">Not yet</button></div></div>';
  }
  function viewPlan() {
    return '<section class="intro"><span class="eyebrow">Summer ' + YEAR + '</span>' +
      '<h1>Your summer, <em>sorted.</em></h1>' +
      '<p class="muted">Plot each week, see where your friends\' kids are going, and sort out who\'s doing pick-up.</p>' +
      '</section>' +
      bookPrompt() + summaryTiles() +
      '<div class="kidsbar">' + kids().map(function (k) { return '<button class="kid" data-act="setup" aria-label="Edit ' + esc(k.name) + '"><span class="swatch" style="background:var(' + k.col + ')"></span>' + esc(k.name) + (k.age !== '' && k.age != null ? ', ' + esc(k.age) : '') + '</button>'; }).join('') +
      '<button class="ghost" data-act="setup">+ Add or edit children</button></div>' +
      (kids().length ? '<div class="weeks">' + WEEKS.map(weekCard).join('') + '</div>' : '<div class="empty" style="margin:14px 0 40px">Add a child to start planning.</div>');
  }
  function weekCard(w) {
    var cost = kids().reduce(function (a, k) { var p = planFor(k.id, w.i); return a + (p ? planCost(p) : 0); }, 0);
    return '<article class="week" id="week-' + w.i + '">' +
      '<div class="weekhead"><div><h2>Week ' + (w.i + 1) + '</h2><span class="dates">' + w.label + '</span>' + (w.bank === 0 ? '<span class="bh">Bank holiday Mon</span>' : '') + '</div>' +
      '<span class="wcost">' + (cost ? euro(cost) : '—') + '</span></div>' +
      '<div class="rows">' + kids().map(function (k) { return '<div class="row"><div class="who"><span class="swatch" style="background:var(' + k.col + ')"></span>' + esc(k.name) + '</div>' + slotCard(k, w) + '</div>'; }).join('') + '</div>' +
      dayGrid(w) + '</article>';
  }
  function friendsGoingThisWeek(k, w) {
    var names = {};
    state.friends.forEach(function (f) { (f.plans || []).forEach(function (p) { if (p.week === w && fitsAge(p.camp, k.age)) names[friendKidName(f, p.kid)] = 1; }); });
    return Object.keys(names);
  }
  function slotCard(k, w) {
    var p = planFor(k.id, w.i);
    if (!p) {
      var fits = sortdCamps().filter(function (c) { return fitsAge(c, k.age); }).length;
      var fr = friendsGoingThisWeek(k, w.i);
      return '<div class="card gap"><span class="gaptext">Nothing planned for ' + esc(k.name) + ' yet</span>' +
        '<span class="cmeta">' + (fits ? fits + ' camp' + (fits === 1 ? '' : 's') + ' on Sortd fit age ' + esc(k.age) : 'Summer ' + YEAR + ' camps are being added to Sortd') +
        (fr.length ? ' · ' + fr.length + ' friend' + (fr.length > 1 ? 's' : '') + ' at camp this week' : '') + '</span>' +
        '<div class="actions"><button class="btn" data-act="find" data-kid="' + esc(k.id) + '" data-week="' + w.i + '">Find a camp</button>' +
        '<button class="btn light" data-act="custom" data-kid="' + esc(k.id) + '" data-week="' + w.i + '">Add your own</button></div></div>';
    }
    if (p.kind === 'custom') {
      var cu = safeUrl(p.url);
      return '<div class="card custom"><div class="ctop"><div style="min-width:0"><div class="ctitle">' + esc(p.title) + '</div>' +
        '<div class="cmeta">Your own plan' + (p.cost ? ' · ' + euro(p.cost) : '') + '</div></div><span class="status custom">Own plan</span></div>' +
        '<div class="actions">' + (cu ? '<a class="btn light" href="' + esc(cu) + '" target="_blank" rel="noopener noreferrer">Open link ↗</a>' : '') +
        '<button class="btn link" data-act="editcustom" data-id="' + esc(p.id) + '">Edit</button>' +
        '<button class="btn danger" data-act="remove" data-id="' + esc(p.id) + '">Remove</button></div></div>';
    }
    var c = p.camp || {}, fr2 = friendsAt(c, w.i), lu = safeUrl(c.listingUrl);
    var meta = [c.prov, c.area, c.time, planCost(p) ? euro(planCost(p)) : 'Cost not set'].filter(Boolean).map(esc).join(' · ');
    return '<div class="card ' + (p.status === 'booked' ? 'booked' : 'planned') + '"><div class="ctop"><div style="min-width:0">' +
      '<div class="ctitle">' + (lu ? '<a href="' + esc(lu) + '" target="_blank" rel="noopener">' + esc(c.name) + '</a>' : esc(c.name)) + '</div>' +
      '<div class="cmeta">' + meta + '</div></div>' +
      '<span class="status ' + (p.status === 'booked' ? 'booked' : 'planned') + '">' + (p.status === 'booked' ? '✓ Booked' : 'Planned') + '</span></div>' +
      (fr2.length ? '<div class="friends">Friends going: ' + fr2.map(function (x) { return '<span class="fchip">' + esc(x.kidName) + (x.status === 'booked' ? ' ✓' : '') + '</span>'; }).join('') + '</div>' : '') +
      '<div class="actions">' + (p.status !== 'booked'
        ? ((safeUrl(c.url) || lu) ? '<button class="btn" data-act="book" data-id="' + esc(p.id) + '">Book with provider ↗</button>' : '') + '<button class="btn green" data-act="markbooked" data-id="' + esc(p.id) + '">I\'ve booked it</button>'
        : '<button class="btn light" data-act="unbook" data-id="' + esc(p.id) + '">Not booked after all</button>') +
      '<button class="btn link" data-act="editcost" data-id="' + esc(p.id) + '">Cost</button>' +
      '<button class="btn danger" data-act="remove" data-id="' + esc(p.id) + '">Remove</button></div></div>';
  }
  function rowLabel(key) { if (key === 'leavePartner') return (partnerName() || 'Partner') + "'s leave"; return ROWS.find(function (r) { return r[0] === key; })[1]; }
  function activeRows() { return ROWS.filter(function (r) { return r[0] !== 'leavePartner' || partnerName(); }); }
  function dayGrid(w) {
    var filled = 0; for (var d = 0; d < 5; d++) { var x = P().days[w.i + '-' + d]; if ((x && x.drop && x.pick) || w.bank === d) filled++; }
    return '<details class="days"><summary>Drop-offs, pick-ups &amp; leave <span class="hint">' + filled + '/5 days covered ▾</span></summary>' +
      '<div class="gridwrap"><table class="dg"><thead><tr><th class="rl"></th>' + DAYS.map(function (dn, i) { return '<th>' + dn + ' ' + new Date(w.start.getTime() + i * 864e5).getDate() + '</th>'; }).join('') + '</tr></thead><tbody>' +
      activeRows().map(function (r) { return '<tr><th class="rl">' + esc(rowLabel(r[0])) + '</th>' + DAYS.map(function (_, d) { return cell(w, d, r[0]); }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="legend">' + P().carers.map(function (c) { return '<span class="pchip"><span class="swatch" style="background:var(' + c.col + ');width:14px;height:14px;border-radius:4px"></span>' + esc(c.name) + '</span>'; }).join('') +
      '<button class="ghost" data-act="people">+ Add or edit people</button><span>Tap a box to choose who</span></div></details>';
  }
  function cell(w, d, key) {
    if (w.bank === d) return '<td><button class="slot off" disabled>' + (key === 'drop' ? 'Bank hol' : '') + '</button></td>';
    var x = day(w.i, d), v = x[key];
    if (key.indexOf('leave') === 0) return '<td><button class="slot leave ' + (v ? 'set' : '') + '" data-act="cycle" data-week="' + w.i + '" data-day="' + d + '" data-key="' + key + '" aria-label="' + esc(rowLabel(key)) + ' ' + DAYS[d] + '">' + (v === 1 ? 'Full day' : v === 0.5 ? '½ day' : '+') + '</button></td>';
    var c = v && carer(v);
    return '<td><button class="slot ' + (c ? 'set' : '') + '" style="' + (c ? 'background:var(' + c.col + ');border-color:var(' + c.col + ')' : '') + '" data-act="cycle" data-week="' + w.i + '" data-day="' + d + '" data-key="' + key + '" aria-label="' + esc(rowLabel(key)) + ' ' + DAYS[d] + (c ? ': ' + esc(c.name) : '') + '">' + (c ? esc(short(c.name)) : '+') + '</button></td>';
  }
  function inviteLink() { return state.inviteCode ? location.origin + '/planner?join=' + state.inviteCode : ''; }
  function viewFriends() {
    var mine = {}; P().plans.forEach(function (p) { if (p.kind === 'camp') mine[campKey(p.camp) + '-' + p.week] = 1; });
    var overlaps = 0; state.friends.forEach(function (f) { (f.plans || []).forEach(function (p) { if (mine[campKey(p.camp) + '-' + p.week]) overlaps++; }); });
    return '<section class="intro"><span class="eyebrow">Connected parents</span><h1>Who\'s going <em>where.</em></h1>' +
      '<p class="muted">Connected parents see your first name, your children\'s first names and ages, and which camp each child is at and whether it\'s booked. Costs, carers, pick-ups, leave and your own plans stay private.</p></section>' +
      '<div class="stack"><div class="panel"><h2>Invite a parent</h2>' +
      '<p class="muted">Send this link on WhatsApp to one parent or a group. You\'re connected once they open it and log in. Either of you can disconnect any time.</p>' +
      (state.inviteCode
        ? '<div class="invite"><code id="invitelink">' + esc(inviteLink()) + '</code><button class="btn" data-act="copy">Copy link</button>' +
          '<a class="btn green" href="https://wa.me/?text=' + encodeURIComponent('I\'m planning the kids\' summer on Sortd. Connect with me so we can see which camps our kids are going to: ' + inviteLink()) + '" target="_blank" rel="noopener noreferrer">Share on WhatsApp</a></div>'
        : '<div class="actions"><button class="btn" data-act="makeinvite">Get my invite link</button></div>') +
      '</div>' +
      (state.friends.length ? '<div class="overlap">You overlap with friends on ' + overlaps + ' camp-week' + (overlaps === 1 ? '' : 's') + ' so far.</div>' +
        '<div class="panel">' + state.friends.map(friendBlock).join('') + '</div>'
        : '<div class="panel"><p class="muted">No connected parents yet. Once someone joins with your link, their camps show up here.</p></div>') +
      '</div>';
  }
  function friendBlock(f) {
    var ps = (f.plans || []).slice().sort(function (a, b) { return a.week - b.week; });
    return '<div class="parent"><div class="phead"><div><div class="pname">' + esc(f.name) + '</div>' +
      '<div class="cmeta">' + (f.kids || []).map(function (k) { return esc(k.name) + (k.age !== '' && k.age != null ? ', ' + esc(k.age) : ''); }).join(' · ') + '</div></div>' +
      '<button class="btn danger" data-act="disconnect" data-id="' + esc(f.id) + '">Disconnect</button></div>' +
      (ps.length ? '<div class="plist">' + ps.map(function (p, idx) {
        var btns = kids().filter(function (k) { return fitsAge(p.camp, k.age); }).map(function (k) {
          var m = planFor(k.id, p.week);
          if (m && m.kind === 'camp' && campKey(m.camp) === campKey(p.camp)) return '<span class="status booked" style="background:var(--grl);color:var(--gr)">' + esc(k.name) + ' too</span>';
          if (m) return '';
          return '<button class="btn light" data-act="join" data-fid="' + esc(f.id) + '" data-idx="' + idx + '" data-kid="' + esc(k.id) + '">Add for ' + esc(k.name) + '</button>';
        }).join('');
        return '<div class="pitem"><span class="wk">Wk ' + (p.week + 1) + ' · ' + WEEKS[p.week].label.split(' – ')[0] + '</span>' +
          '<span><b>' + esc(p.camp.name) + '</b> <span class="cmeta">' + esc(friendKidName(f, p.kid)) + '</span> <span class="status ' + p.status + '" style="margin-left:4px">' + (p.status === 'booked' ? 'Booked' : 'Planned') + '</span></span>' +
          '<span class="actions">' + btns + '</span></div>';
      }).join('') + '</div>' : '<p class="cmeta">No camps planned yet.</p>') + '</div>';
  }
  function viewCosts() {
    var t = totals(), pn = partnerName();
    var rows = P().plans.slice().sort(function (a, b) { return a.week - b.week || String(a.kid).localeCompare(String(b.kid)); });
    var byKid = kids().map(function (k) { return { k: k, sum: P().plans.filter(function (p) { return p.kid === k.id; }).reduce(function (a, p) { return a + planCost(p); }, 0) }; });
    var max = Math.max.apply(null, [1].concat(byKid.map(function (x) { return x.sum; })));
    var load = P().carers.map(function (c) { return { c: c, n: Object.keys(P().days).reduce(function (a, k) { var d = P().days[k]; return a + ['drop','pick','aft'].filter(function (s) { return d[s] === c.id; }).length; }, 0) }; });
    var lmax = Math.max.apply(null, [1].concat(load.map(function (x) { return x.n; })));
    return '<section class="intro"><span class="eyebrow">The numbers</span><h1>What summer <em>costs.</em></h1></section>' + summaryTiles() +
      '<div class="stack"><div class="panel"><h2>By child</h2><div class="bars">' + byKid.map(function (x) { return '<div class="bar"><span>' + esc(x.k.name) + '</span><span class="track"><span class="fill" style="width:' + (x.sum / max * 100) + '%;background:var(' + x.k.col + ')"></span></span><span style="text-align:right;font-variant-numeric:tabular-nums">' + euro(x.sum) + '</span></div>'; }).join('') + '</div></div>' +
      '<div class="panel"><h2>Every week</h2>' + (rows.length ? '<div class="tablewrap"><table class="costs"><thead><tr><th>Week</th><th>Child</th><th>What</th><th>Status</th><th class="n">Cost</th></tr></thead><tbody>' +
      rows.map(function (p) { var k = kidById(p.kid); return '<tr><td>' + (p.week + 1) + '</td><td>' + esc(k ? k.name : '') + '</td><td>' + esc(p.kind === 'camp' ? p.camp.name : p.title) + '</td><td>' + (p.kind === 'camp' ? (p.status === 'booked' ? 'Booked' : 'Planned') : 'Own plan') + '</td><td class="n">' + euro(planCost(p)) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td colspan="4">Total</td><td class="n">' + euro(t.cost) + '</td></tr></tfoot></table></div>' : '<p class="muted">Nothing planned yet.</p>') + '</div>' +
      '<div class="panel"><h2>Who\'s covering</h2><p class="muted">Drop-offs, pick-ups and afternoons assigned so far.</p>' +
      '<div class="bars">' + load.map(function (x) { return '<div class="bar"><span>' + esc(short(x.c.name)) + '</span><span class="track"><span class="fill" style="width:' + (x.n / lmax * 100) + '%;background:var(' + x.c.col + ')"></span></span><span style="text-align:right;font-variant-numeric:tabular-nums">' + x.n + '</span></div>'; }).join('') + '</div>' +
      '<p><b>Annual leave:</b> You ' + t.you + ' days' + (pn ? ' · ' + esc(pn) + ' ' + t.partner + ' days' : '') + '</p></div></div>';
  }
  function kidLabel(p) {
    if (!p) return { cls: 'gap', txt: 'Nothing on' };
    if (p.kind === 'custom') return { cls: 'custom', txt: p.title };
    return { cls: p.status === 'booked' ? 'booked' : 'planned', txt: p.camp.name };
  }
  function viewHow() {
    var S = [
      ['--gr', 'Add your kids', 'Put in each child\'s first name and age. Age means you only see camps that suit them.', 'plan', 'Go to My summer'],
      ['--pu', 'Fill in each week', 'Tap an empty week to find a camp that fits, or add your own plan, like a holiday or Granny\'s week.', 'plan', 'Start planning'],
      ['--pk', 'Invite your friends', 'Send your invite link on WhatsApp. You\'ll see where their kids are going and can add the same camp in 1 tap.', 'friends', 'Invite a parent'],
      ['--sk', 'Sort out the days', 'Add the people who help, then tap any day to pick who\'s doing drop-off, pick-up and afternoons.', 'cal', 'Open the calendar'],
      ['--warn', 'Book it and tick it', 'Book with the provider, then tap "I\'ve booked it". Your total cost and leave days add up as you go.', 'costs', 'See costs & leave']
    ];
    return '<section class="intro"><span class="eyebrow">How to use the planner</span><h1>Your summer in <em>5 steps.</em></h1>' +
      '<p class="muted">Do them in any order. Everything saves as you go.</p></section>' +
      '<ol class="steps">' + S.map(function (x, i) { return '<li class="step"><span class="n" style="background:var(' + x[0] + ')" aria-hidden="true">' + (i + 1) + '</span><div><h2>' + x[1] + '</h2><p>' + x[2] + '</p><button class="btn" data-act="goto" data-view="' + x[3] + '">' + x[4] + ' →</button></div></li>'; }).join('') + '</ol>';
  }
  function viewCal() {
    var cells = '', lastMonth = -1;
    WEEKS.forEach(function (w) {
      var m = w.start.getMonth() === 5 ? 6 : w.start.getMonth();
      if (m !== lastMonth) { cells += '<div class="month">' + (m === 6 ? 'July' : m === 7 ? 'August' : MONTHS[m]) + ' ' + YEAR + '</div>'; lastMonth = m; }
      for (var d = 0; d < 5; d++) {
        var dt = new Date(w.start.getTime() + d * 864e5); var num = dt.getDate() === 1 ? '1 ' + MONTHS[dt.getMonth()] : dt.getDate();
        if (w.bank === d) { cells += '<div class="daycell off"><div class="dnum">' + num + '</div><div class="pu">Bank holiday</div></div>'; continue; }
        var x = P().days[w.i + '-' + d] || {}; var lv = (x.leaveYou || 0) + (x.leavePartner || 0); var pick = x.pick && carer(x.pick);
        cells += '<button class="daycell" data-act="dayopen" data-week="' + w.i + '" data-day="' + d + '" aria-label="' + DAYS[d] + ' ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()] + '">' +
          '<div class="dnum">' + num + (lv ? '<span class="lv">' + (lv === 0.5 ? '½' : lv) + ' AL</span>' : '') + '</div>' +
          kids().map(function (k) { var l = kidLabel(planFor(k.id, w.i)); return '<div class="kbar ' + l.cls + '" style="--kc:var(' + k.col + ')" title="' + esc(k.name) + ': ' + esc(l.txt) + '"><b style="background:var(' + k.col + ')"></b><span>' + esc(l.txt) + '</span></div>'; }).join('') +
          (pick ? '<div class="pu"><i style="background:var(' + pick.col + ')"></i><span><span class="lbl">Pick-up </span>' + esc(short(pick.name)) + '</span></div>' : '<div class="pu"><span>No pick-up yet</span></div>') + '</button>';
      }
    });
    return '<section class="intro"><span class="eyebrow">Summer ' + YEAR + '</span><h1>The whole summer, <em>at a glance.</em></h1>' +
      '<p class="muted">Each day shows what every child is doing and who\'s picking up. Tap a day to change it.</p></section>' +
      '<div class="calwrap"><div class="calkey">' + kids().map(function (k) { return '<span><i style="background:var(' + k.col + ')"></i>' + esc(k.name) + '</span>'; }).join('') +
      '<span><i style="background:var(--grl)"></i>Booked</span><span><i style="background:var(--pul)"></i>Planned</span><span><i style="background:var(--skl)"></i>Own plan</span><span><i style="border:1px dashed var(--warn)"></i>Gap</span><span><i style="background:var(--warnl)"></i>AL = leave</span></div>' +
      '<div class="cal"><div class="calgrid">' + DAYS.map(function (d) { return '<div class="dow">' + d + '</div>'; }).join('') + cells + '</div></div></div>';
  }

  // ---------- Sortd calendar (term-time classes + summer plans) ----------
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var k = (x.getDay() + 6) % 7; return SY.addDays(x, -k); }
  function classes() { return P().classes || []; }
  function classById(id) { return classes().find(function (c) { return c.id === id; }); }
  function classTitle(c) { return (c.listing && c.listing.name) || 'Class'; }
  function classFrom(c) { return c.from ? SY.parseISO(c.from) : null; }
  function classUntil(c) { return c.until ? SY.parseISO(c.until) : SY.lastTermDay(); }
  function kidChips(ids) {
    return (ids || []).map(kidById).filter(Boolean).map(function (k) { return '<span class="kchip"><span class="swatch" style="background:var(' + k.col + ')"></span>' + esc(k.name) + '</span>'; }).join('');
  }
  function classEv(c) {
    var l = c.listing || {};
    return { uid: (l.id || c.id) + '-' + c.day + '-' + c.start, title: classTitle(c) + (c.label ? ' (' + c.label + ')' : ''), day: c.day, start: c.start, end: c.end, url: l.url || '',
      location: c.venue ? c.venue + (l.area ? ', ' + l.area : '') : (l.area || ''),
      details: [l.provider, c.venue ? 'Venue: ' + c.venue : '', 'For: ' + (c.kids || []).map(kidById).filter(Boolean).map(function (k) { return k.name; }).join(', '),
        l.bookingUrl ? 'Book or check dates: ' + l.bookingUrl : '', l.url ? 'On Sortd: ' + l.url : '', 'Weekly in term time. Skips midterm and bank holidays.'].filter(Boolean).join('\n') };
  }
  function classRuns(c) { var f = classFrom(c) || SY.today(); return SY.runs(c.day, f, classUntil(c)); }
  function summerWeekOf(d) { for (var i = 0; i < WEEKS.length; i++) { var s = WEEKS[i].start; if (d >= s && d < SY.addDays(s, 7)) return WEEKS[i]; } return null; }
  function dayItems(d) {
    var items = [];
    classes().forEach(function (c) {
      if (SY.runsOn(d, c.day, classFrom(c), classUntil(c))) items.push({ t: c.start, html: '<div class="cevt cevt--class"><b>' + SY.fmtTime(c.start) + '–' + SY.fmtTime(c.end) + '</b> <span class="cevt-n">' + esc(classTitle(c)) + (c.label ? ' · ' + esc(c.label) : '') + '</span>' + kidChips(c.kids) + (c.venue ? '<span class="cevt-v">' + esc(c.venue) + '</span>' : '') + '</div>' });
    });
    var wk = summerWeekOf(d), dow = (d.getDay() + 6) % 7;
    if (wk && dow < 5 && wk.bank !== dow) {
      kids().forEach(function (k) {
        var p = planFor(k.id, wk.i); if (!p) return;
        var l = kidLabel(p);
        items.push({ t: 1, html: '<div class="cevt cevt--' + l.cls + '"><span class="cevt-n">' + esc(l.txt) + '</span>' + kidChips([k.id]) + (p.kind === 'camp' && p.camp.time ? '<span class="cevt-v">' + esc(p.camp.time) + '</span>' : '') + '</div>' });
      });
    }
    return items.sort(function (a, b) { return a.t - b.t; }).map(function (x) { return x.html; }).join('');
  }
  function viewCalendar() {
    if (!state.weekStart) state.weekStart = mondayOf(SY.today());
    var ws = state.weekStart, we = SY.addDays(ws, 6), t = SY.iso(SY.today());
    var days = '';
    for (var i = 0; i < 7; i++) {
      var d = SY.addDays(ws, i), off = SY.whyOff(d), items = dayItems(d), isToday = SY.iso(d) === t;
      days += '<div class="cday' + (isToday ? ' is-today' : '') + (i >= 5 ? ' is-wkend' : '') + '"><div class="cday-h"><b>' + DAYS_LONG[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + '</b>' +
        (off && i < 5 ? '<span class="coff">' + esc(off) + '</span>' : '') + (isToday ? '<span class="ctoday">Today</span>' : '') + '</div>' +
        (items || '<div class="cnone">' + (i < 5 && !off ? 'Nothing on' : '') + '</div>') + '</div>';
    }
    var list = classes().slice().sort(function (a, b) { return a.day - b.day || a.start - b.start; });
    return '<section class="intro"><span class="eyebrow">Your Sortd calendar</span><h1>The week, <em>sorted.</em></h1>' +
      '<p class="muted">Every class for every child, with midterm, holidays and bank holidays already taken out. Add classes from any class page on Sortd.</p></section>' +
      '<div class="calnav"><button class="btn light" data-act="wk" data-dir="-1" aria-label="Previous week">←</button>' +
      '<b>' + ws.getDate() + ' ' + MONTHS[ws.getMonth()] + ' – ' + we.getDate() + ' ' + MONTHS[we.getMonth()] + ' ' + we.getFullYear() + '</b>' +
      '<button class="btn light" data-act="wk" data-dir="1" aria-label="Next week">→</button>' +
      (SY.iso(ws) !== SY.iso(mondayOf(SY.today())) ? '<button class="btn link" data-act="wk" data-dir="0">This week</button>' : '') + '</div>' +
      '<div class="cweek">' + days + '</div>' +
      '<div class="stack"><div class="panel"><div class="phead"><h2>Your classes</h2>' +
      (list.length ? '<button class="btn light" data-act="exportall">Add all to my phone\'s calendar</button>' : '') + '</div>' +
      (list.length ? list.map(classCard).join('') : '<p class="muted">No classes yet. Find one on Sortd and tap "Add to my Sortd calendar", or add your own.</p>') +
      '<div class="actions"><a class="btn" href="/weekly-classes">Find a class on Sortd</a></div></div>' +
      ownClassPanel() + '</div>';
  }
  // "Add your own class": its own module under Your classes, with the form
  // inline (swimming, GAA, Irish dancing... anything not on Sortd).
  function ownClassPanel() {
    var head = '<div class="ownhead"><span class="ownico" aria-hidden="true">+</span><div><h2>Add your own class</h2>' +
      '<p class="muted">Swimming, GAA, Irish dancing, grinds: anything that isn\'t on Sortd. It shows every week in term time, with school breaks taken out, just like the rest.</p></div></div>';
    if (!kids().length) return '<div class="panel ownpanel">' + head + '<div class="actions"><button class="btn" data-act="setup">Add your children first</button></div></div>';
    var t = SY.iso(SY.today());
    return '<div class="panel ownpanel">' + head +
      '<div class="ownform">' +
      '<label class="field ownwide" for="oc-name">Class<input id="oc-name" maxlength="80" placeholder="e.g. Swimming at Portmarnock Sports Centre"></label>' +
      '<div class="field ownwide"><span>Who\'s going?</span><div class="kidsbar">' + kids().map(function (k, i) { return '<label class="kid"><input type="checkbox" class="oc-kid" value="' + esc(k.id) + '"' + (i === 0 ? ' checked' : '') + '> <span class="swatch" style="background:var(' + k.col + ')"></span>' + esc(k.name) + '</label>'; }).join('') + '</div></div>' +
      '<label class="field" for="oc-day">Day<select id="oc-day">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<option value="' + d + '">' + DAYS_LONG[d] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field" for="oc-start">Starts<input id="oc-start" type="time" value="16:00"></label>' +
      '<label class="field" for="oc-end">Ends<input id="oc-end" type="time" value="17:00"></label>' +
      '<label class="field" for="oc-from">First class<input id="oc-from" type="date" value="' + t + '"></label>' +
      '<label class="field ownwide" for="oc-venue">Where (optional)<input id="oc-venue" maxlength="120" placeholder="e.g. Malahide Community School"></label>' +
      '<label class="field ownwide"><span><input id="oc-year" type="checkbox"> Carry on after this term (to ' + SY.nice(SY.lastTermDay()) + ')</span></label>' +
      '</div><div class="actions"><button class="btn green" data-act="saveown">Add to my calendar</button></div></div>';
  }
  function classCard(c) {
    var rs = classRuns(c), n = rs.reduce(function (a, r) { return a + SY.count(r); }, 0), l = c.listing || {};
    var allYear = SY.iso(classUntil(c)) >= SY.iso(SY.addDays(SY.lastTermDay(), -6));
    var lu = safeUrl(l.url), bu = safeUrl(l.bookingUrl);
    return '<div class="ccard"><div class="ctop"><div style="min-width:0"><div class="ctitle">' + (lu ? '<a href="' + esc(lu) + '">' + esc(classTitle(c)) + '</a>' : esc(classTitle(c))) + '</div>' +
      '<div class="cmeta">' + [DAYS_LONG[c.day] + 's ' + SY.fmtTime(c.start) + '–' + SY.fmtTime(c.end), c.label, c.venue, l.provider].filter(Boolean).map(esc).join(' · ') + '</div>' +
      '<div class="cmeta">' + (rs.length ? n + ' class' + (n === 1 ? '' : 'es') + ' left, until ' + SY.nice(rs[rs.length - 1].last) : 'Finished for this school year') + '</div></div>' +
      '<div class="friends">' + kidChips(c.kids) + '</div></div>' +
      '<div class="actions">' +
      '<button class="btn light" data-act="cyear" data-id="' + esc(c.id) + '">' + (allYear ? 'Stop at end of this term' : 'Carry on all year') + '</button>' +
      (rs.length ? '<a class="btn link" href="' + esc(SY.googleLink(classEv(c), rs[0])) + '" target="_blank" rel="noopener noreferrer">Google Calendar</a><button class="btn link" data-act="cics" data-id="' + esc(c.id) + '">Apple / Outlook</button>' : '') +
      (bu ? '<a class="btn link" href="' + esc(bu) + '" target="_blank" rel="noopener">Book ↗</a>' : '') +
      '<button class="btn danger" data-act="cremove" data-id="' + esc(c.id) + '">Remove</button></div></div>';
  }
  function ownClassSheet() {
    if (!kids().length) { toast('Add a child first'); setupKids = null; setupDraft = null; setupSheet(false); return; }
    var t = SY.iso(SY.today());
    openSheet(head('Add your own class', 'A class that isn\'t on Sortd yet. It shows on your calendar every week in term time.') +
      '<label class="field" for="oc-name">Class<input id="oc-name" maxlength="80" placeholder="e.g. Swimming at Portmarnock"></label>' +
      '<div class="field"><span>Who\'s going?</span><div class="kidsbar">' + kids().map(function (k, i) { return '<label class="kid"><input type="checkbox" class="oc-kid" value="' + esc(k.id) + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(k.name) + '</label>'; }).join('') + '</div></div>' +
      '<div class="ocrow"><label class="field" for="oc-day">Day<select id="oc-day">' + [1, 2, 3, 4, 5, 6, 0].map(function (d) { return '<option value="' + d + '">' + DAYS_LONG[d] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field" for="oc-start">Starts<input id="oc-start" type="time" value="16:00"></label><label class="field" for="oc-end">Ends<input id="oc-end" type="time" value="17:00"></label></div>' +
      '<label class="field" for="oc-venue">Where (optional)<input id="oc-venue" maxlength="120"></label>' +
      '<label class="field" for="oc-from">First class on or after<input id="oc-from" type="date" value="' + t + '"></label>' +
      '<label class="field"><span><input id="oc-year" type="checkbox"> Carry on after this term</span></label>' +
      '<div class="actions"><button class="btn green" data-act="saveown">Add to my calendar</button></div>', '#oc-name');
  }
  function tmins(v) { var p = String(v || '').split(':'); return p.length === 2 ? (+p[0]) * 60 + (+p[1]) : null; }

  // ---------- sheets ----------
  var returnToDay = null, pickCtx = null, findCtx = null;
  function openSheet(html, focusSel) {
    document.getElementById('layer').innerHTML = '<div class="scrim" data-act="closesheet"><div class="sheet" role="dialog" aria-modal="true">' + html + '</div></div>';
    var f = document.querySelector(focusSel || '.sheet input, .sheet button'); if (f) f.focus();
  }
  function closeSheet() {
    if (document.getElementById('plist')) { savePeopleNames(); P().carers = P().carers.filter(function (c) { return c.name.trim(); }); changed(); rerenderKeepOpen(); }
    var s = document.querySelector('.scrim'); if (s) s.remove(); findCtx = null;
  }
  function head(title, sub) { return '<div class="sheethead"><div><h3>' + title + '</h3>' + (sub ? '<div class="cmeta">' + sub + '</div>' : '') + '</div><button class="close" data-act="closesheet" aria-label="Close">✕</button></div>'; }

  // First-time setup and editing children/details.
  var setupKids = null, setupDraft = null;
  function setupSheet(first) {
    if (!setupKids) setupKids = (P() ? kids() : []).map(function (k) { return { id: k.id, name: k.name, age: k.age, col: k.col }; });
    if (!setupKids.length) setupKids.push({ id: uid('k'), name: '', age: '', col: KID_COLOURS[0] });
    var me = setupDraft ? setupDraft.me : (P() ? P().me.name : ''), partner = setupDraft ? setupDraft.partner : (P() ? P().partner : '');
    var html = (first ? '<div class="sheethead"><div><h3>Let\'s set up your summer</h3><div class="cmeta">Takes a minute. You can change all of this later.</div></div></div>'
      : head('Your details and children')) +
      '<label class="field" for="s-me">Your first name<input id="s-me" value="' + esc(me) + '" autocomplete="given-name" maxlength="40"><small>Connected friends see this name.</small></label>' +
      '<label class="field" for="s-partner">Other parent or partner (optional)<input id="s-partner" value="' + esc(partner || '') + '" maxlength="40" placeholder="e.g. Dave"><small>Private to you. Adds a leave row for them.</small></label>' +
      '<div class="field"><span>Children</span><small>First name and age only. Age is used to match camps.</small></div>' +
      '<div class="pick" id="kidlist">' + setupKids.map(function (k) {
        return '<div class="prow kidrow" data-kid="' + esc(k.id) + '"><input class="k-name" value="' + esc(k.name) + '" placeholder="First name" aria-label="Child\'s first name" maxlength="30">' +
          '<input class="k-age" value="' + esc(k.age) + '" type="number" min="0" max="17" inputmode="numeric" placeholder="Age" aria-label="Age">' +
          '<button class="btn danger" data-act="s-delkid" data-kid="' + esc(k.id) + '">Remove</button></div>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="btn light" data-act="s-addkid">+ Add a child</button><button class="btn green" data-act="s-save" data-first="' + (first ? 1 : 0) + '">' + (first ? 'Start planning' : 'Save') + '</button></div>';
    openSheet(html, '#s-me');
    if (first) { var s = document.querySelector('.scrim'); if (s) s.removeAttribute('data-act'); }
  }
  function readSetupKids() {
    var mi = document.getElementById('s-me'), pi = document.getElementById('s-partner');
    if (mi && pi) setupDraft = { me: mi.value, partner: pi.value };
    document.querySelectorAll('#kidlist .prow').forEach(function (row) {
      var k = setupKids.find(function (x) { return x.id === row.dataset.kid; }); if (!k) return;
      k.name = row.querySelector('.k-name').value.trim();
      var a = row.querySelector('.k-age').value; k.age = a === '' ? '' : Math.max(0, Math.min(17, parseInt(a, 10) || 0));
    });
  }
  function saveSetup(first) {
    readSetupKids();
    var me = document.getElementById('s-me').value.trim(), partner = document.getElementById('s-partner').value.trim();
    var ks = setupKids.filter(function (k) { return k.name; });
    if (!me) { toast('Add your first name'); document.getElementById('s-me').focus(); return; }
    if (!ks.length) { toast('Add at least one child'); return; }
    if (first) {
      var carers = [{ id: 'you', name: me, col: '--sk' }];
      if (partner) carers.push({ id: 'partner', name: partner, col: '--pu' });
      state.plan = { v: 1, me: { name: me }, partner: partner, kids: [], carers: carers, plans: [], days: {}, pendingBook: [], classes: [] };
    } else {
      P().me.name = me; P().partner = partner;
      var you = carer('you'); if (you) you.name = me;
      var pc = carer('partner'); if (pc && partner) pc.name = partner; else if (!pc && partner) P().carers.push({ id: 'partner', name: partner, col: '--pu' });
      var keep = {}; ks.forEach(function (k) { keep[k.id] = 1; });
      P().plans = P().plans.filter(function (p) { return keep[p.kid]; });
      P().classes = P().classes.map(function (c) { c.kids = c.kids.filter(function (id) { return keep[id]; }); return c; }).filter(function (c) { return c.kids.length; });
    }
    ks.forEach(function (k, i) { if (!k.col) k.col = KID_COLOURS[i % KID_COLOURS.length]; });
    P().kids = ks;
    setupKids = null; setupDraft = null;
    var s = document.querySelector('.scrim'); if (s) s.remove();
    changed(); render(); toast(first ? 'All set' : 'Saved');
  }

  function campResult(c, k, w, fr) {
    var lu = safeUrl(c.listingUrl);
    var meta = [c.prov, c.area, c.time, (c.ageMin != null && c.ageMax != null) ? 'ages ' + c.ageMin + ' to ' + c.ageMax : '', c.price ? euro(c.price) : (c.costText || '')].filter(Boolean).map(esc).join(' · ');
    return '<div class="result">' + (c.category ? '<span class="cat">' + esc(c.category) + '</span>' : '') +
      '<div class="ctitle">' + esc(c.name) + '</div><div class="cmeta">' + meta + '</div>' +
      (c.weeks ? '<div class="cmeta">Dates: ' + esc(c.weeks) + '</div>' : '') +
      (fr && fr.length ? '<div class="friends">Friends going: ' + fr.map(function (x) { return '<span class="fchip" style="background:var(--grl)">' + esc(x.kidName) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="actions"><button class="btn green" data-act="addcamp" data-src="' + esc(c._src) + '" data-kid="' + esc(k.id) + '" data-week="' + w + '">Add as planned</button>' +
      (lu ? '<a class="btn link" href="' + esc(lu) + '" target="_blank" rel="noopener">See listing</a>' : '') + '</div></div>';
  }
  var campPool = {};
  function findSheet(kid, w) {
    var k = kidById(kid); findCtx = { kid: kid, w: w };
    openSheet(head('Camps for ' + esc(k.name) + ', week ' + (w + 1), WEEKS[w].label + (k.age !== '' ? ' · age ' + esc(k.age) : '') + ' · friends\' camps first') +
      '<label class="field" for="fq">Search Sortd camps<input id="fq" type="search" placeholder="Camp, provider or area" autocomplete="off"></label>' +
      '<div id="findresults" style="display:grid;gap:10px"></div>', '#fq');
    renderFindResults('');
  }
  function renderFindResults(q) {
    if (!findCtx) return; var k = kidById(findCtx.kid), w = findCtx.w; campPool = {};
    q = q.trim().toLowerCase();
    var seen = {}, friendCamps = [];
    state.friends.forEach(function (f) { (f.plans || []).forEach(function (p) {
      if (p.week !== w || !fitsAge(p.camp, k.age)) return; var key = campKey(p.camp); if (seen[key]) return; seen[key] = 1;
      var c = Object.assign({}, p.camp, { _src: 'f:' + key }); campPool[c._src] = c; friendCamps.push(c);
    }); });
    var saved = state.savedIds;
    var camps = sortdCamps().filter(function (c) { return fitsAge(c, k.age) && !seen[campKey(c)]; })
      .filter(function (c) { return !q || [c.name, c.prov, c.area, c.category].join(' ').toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return (saved.indexOf(b.id) !== -1) - (saved.indexOf(a.id) !== -1); });
    camps.forEach(function (c) { c._src = 's:' + c.id; campPool[c._src] = c; });
    var html = '';
    if (friendCamps.length && !q) html += '<b>Where friends are going this week</b>' + friendCamps.map(function (c) { return campResult(c, k, w, friendsAt(c, w)); }).join('');
    if (camps.length) html += (friendCamps.length && !q ? '<b>More camps on Sortd</b>' : '') + camps.slice(0, 40).map(function (c) { return campResult(c, k, w, friendsAt(c, w)); }).join('');
    if (!camps.length && !(friendCamps.length && !q)) {
      html += '<div class="empty"><b>' + (q ? 'No camps match that search.' : 'No summer ' + YEAR + ' camps on Sortd for this age yet.') + '</b>' +
        '<span class="muted">Providers add summer camps from early in the year. You can add a camp you\'ve found elsewhere as your own plan, with its booking link.</span>' +
        '<div class="actions"><button class="btn" data-act="custom" data-kid="' + esc(k.id) + '" data-week="' + w + '">Add your own</button>' +
        '<a class="btn light" href="/find-an-activity?type=camps" target="_blank" rel="noopener">Browse Sortd</a></div></div>';
    }
    document.getElementById('findresults').innerHTML = html;
  }
  function customSheet(kid, w, p) {
    var k = kidById(kid);
    openSheet(head(p ? 'Edit your plan' : 'Add your own plan', esc(k ? k.name : '') + ' · week ' + (w + 1) + ' · ' + WEEKS[w].label) +
      '<label class="field" for="ctitle">What\'s on<input id="ctitle" maxlength="80" value="' + esc(p ? p.title : '') + '" placeholder="e.g. Granny\'s week, holiday, a camp not on Sortd"></label>' +
      '<label class="field" for="ccost">Cost (optional)<input id="ccost" type="number" min="0" inputmode="numeric" placeholder="€" value="' + esc(p && p.cost ? p.cost : '') + '"></label>' +
      '<label class="field" for="curl">Booking or info link (optional)<input id="curl" type="url" maxlength="300" placeholder="https://" value="' + esc(p ? p.url || '' : '') + '"></label>' +
      (!p && kids().length > 1 ? '<label class="field" for="cboth"><span><input id="cboth" type="checkbox"> Add for all children this week</span></label>' : '') +
      '<div class="actions"><button class="btn green" data-act="savecustom" data-kid="' + esc(kid) + '" data-week="' + w + '"' + (p ? ' data-id="' + esc(p.id) + '"' : '') + '>' + (p ? 'Save' : 'Add to planner') + '</button></div>', '#ctitle');
  }
  function costSheet(p) {
    openSheet(head('Cost for ' + esc(p.camp.name), 'Week ' + (p.week + 1) + '. Change it if your price is different, e.g. a sibling discount.') +
      '<label class="field" for="pcost">Cost for this week<input id="pcost" type="number" min="0" inputmode="numeric" value="' + esc(planCost(p) || '') + '" placeholder="€"></label>' +
      '<div class="actions"><button class="btn green" data-act="savecost" data-id="' + esc(p.id) + '">Save</button></div>', '#pcost');
  }
  function peopleSheet() {
    openSheet(head('Who helps out', 'Add everyone who does drop-offs, pick-ups or afternoons. Only you see this list.') +
      '<div class="pick" id="plist">' + P().carers.map(function (c) {
        return '<div class="prow" data-pid="' + esc(c.id) + '"><input id="pname-' + esc(c.id) + '" value="' + esc(c.name) + '" aria-label="Name" maxlength="40">' +
          '<button class="btn danger" data-act="delperson" data-pid="' + esc(c.id) + '">Remove</button>' +
          '<div class="colours">' + COLOURS.map(function (k) { return '<button style="background:var(' + k + ')" aria-label="Colour" aria-pressed="' + (c.col === k) + '" data-act="colour" data-pid="' + esc(c.id) + '" data-col="' + k + '"></button>'; }).join('') + '</div></div>';
      }).join('') + '</div>' +
      '<div class="actions"><button class="btn light" data-act="addperson">+ Add a person</button><button class="btn green" data-act="savepeople">Done</button></div>');
  }
  function savePeopleNames() { P().carers.forEach(function (c) { var i = document.getElementById('pname-' + c.id); if (i) c.name = i.value.trim(); }); }
  function pickSheet(w, d, key) {
    pickCtx = { w: w, d: d, key: key }; var cur = day(w, d)[key]; var dt = new Date(WEEKS[w].start.getTime() + d * 864e5);
    openSheet(head(esc(rowLabel(key)), DAYS[d] + ' ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()]) +
      '<div class="pick">' + P().carers.map(function (c) { return '<button data-act="pickperson" data-pid="' + esc(c.id) + '" aria-pressed="' + (cur === c.id) + '"><span class="swatch" style="background:var(' + c.col + ')"></span>' + esc(c.name) + '</button>'; }).join('') +
      '<button data-act="pickperson" data-pid="" aria-pressed="' + (!cur) + '"><span class="swatch" style="border:1.5px dashed var(--bd)"></span>Nobody yet</button></div>' +
      '<div class="actions"><button class="btn light" data-act="people">+ Add or edit people</button></div>');
  }
  function daySheet(w, d) {
    var dt = new Date(WEEKS[w].start.getTime() + d * 864e5), x = day(w, d);
    openSheet(head(DAYS[d] + ' ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()], 'Week ' + (w + 1)) +
      kids().map(function (k) { var p = planFor(k.id, w), l = kidLabel(p);
        return '<div class="kbar ' + l.cls + '" style="font-size:14px;padding:8px 10px"><b style="background:var(' + k.col + ');width:10px;height:10px"></b><span><strong>' + esc(k.name) + ':</strong> ' + esc(l.txt) + (p && p.kind === 'camp' && p.camp.time ? ' · ' + esc(p.camp.time) : '') + '</span></div>' +
          (p ? '' : '<div class="actions"><button class="btn" data-act="find" data-kid="' + esc(k.id) + '" data-week="' + w + '">Find a camp for ' + esc(k.name) + '</button></div>');
      }).join('') +
      ['drop','pick','aft'].map(function (key) { var c = x[key] && carer(x[key]); return '<div class="dslot"><span class="cmeta">' + rowLabel(key) + '</span><button data-act="cycle" data-week="' + w + '" data-day="' + d + '" data-key="' + key + '"><span class="swatch" style="' + (c ? 'background:var(' + c.col + ')' : 'border:1.5px dashed var(--bd)') + '"></span>' + (c ? esc(c.name) : 'Choose who') + '</button></div>'; }).join('') +
      activeRows().filter(function (r) { return r[0].indexOf('leave') === 0; }).map(function (r) { var key = r[0]; return '<div class="dslot"><span class="cmeta">' + esc(rowLabel(key)) + '</span><button data-act="leaveday" data-week="' + w + '" data-day="' + d + '" data-key="' + key + '">' + (x[key] === 1 ? 'Full day' : x[key] === 0.5 ? '½ day' : 'None') + ' · tap to change</button></div>'; }).join(''));
  }

  // ---------- events ----------
  function addCampPlan(kid, w, c) {
    var snap = { id: c.id || null, name: c.name, prov: c.prov || '', area: c.area || '', time: c.time || '', price: c.price || 0,
      url: safeUrl(c.url), listingUrl: safeUrl(c.listingUrl), ageMin: c.ageMin == null ? null : c.ageMin, ageMax: c.ageMax == null ? null : c.ageMax };
    P().plans.push({ id: uid('p'), kid: kid, week: w, kind: 'camp', camp: snap, status: 'planned' });
  }
  document.addEventListener('input', function (e) { if (e.target.id === 'fq') renderFindResults(e.target.value); });
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab'); if (tab) { state.view = tab.dataset.view; render(); window.scrollTo(0, 0); return; }
    var el = e.target.closest('[data-act]'); if (!el) return;
    if (el.classList.contains('scrim') && e.target !== el) return;
    var a = el.dataset.act, id = el.dataset.id, w = +el.dataset.week, kid = el.dataset.kid, p = id ? planById(id) : null;
    switch (a) {
      case 'wk': { var dir = +el.dataset.dir; state.weekStart = dir === 0 ? mondayOf(SY.today()) : SY.addDays(state.weekStart || mondayOf(SY.today()), 7 * dir); render(); break; }
      case 'exportall': { var list = classes().map(function (c) { return [classEv(c), classRuns(c)]; }).filter(function (x) { return x[1].length; }); if (!list.length) { toast('No classes left this school year'); break; } SY.download('sortd-calendar.ics', SY.ics(list)); toast('Open the downloaded file to add everything'); break; }
      case 'cics': { var cc = classById(id); if (cc) SY.download('sortd-class.ics', SY.ics([[classEv(cc), classRuns(cc)]])); break; }
      case 'cyear': { var cy = classById(id); if (!cy) break; var ally = SY.iso(classUntil(cy)) >= SY.iso(SY.addDays(SY.lastTermDay(), -6));
        cy.until = SY.iso(ally ? SY.currentTermEnd(SY.today()) : SY.lastTermDay()); changed(); render(); toast(ally ? 'Stops at the end of this term' : 'Carries on until the end of the school year'); break; }
      case 'cremove': { var cr = classById(id); if (!cr || !window.confirm('Remove ' + classTitle(cr) + ' from your calendar?')) break; P().classes = classes().filter(function (x) { return x !== cr; }); changed(); render(); toast('Removed'); break; }
      case 'ownclass': ownClassSheet(); break;
      case 'saveown': {
        var nm = document.getElementById('oc-name').value.trim(); if (!nm) { toast('Add the class name'); document.getElementById('oc-name').focus(); break; }
        var kidsSel = Array.prototype.map.call(document.querySelectorAll('.oc-kid:checked'), function (x) { return x.value; }); if (!kidsSel.length) { toast('Choose who\'s going'); break; }
        var st = tmins(document.getElementById('oc-start').value), en = tmins(document.getElementById('oc-end').value); if (st == null || en == null || en <= st) { toast('Check the start and end times'); break; }
        var fr = document.getElementById('oc-from').value || SY.iso(SY.today()); var frd = SY.parseISO(fr);
        P().classes.push({ id: uid('c'), kids: kidsSel, listing: { id: null, name: nm, provider: '', url: '', area: '', bookingUrl: '' }, label: '', venue: document.getElementById('oc-venue').value.trim(),
          day: +document.getElementById('oc-day').value, start: st, end: en, from: fr, until: SY.iso(document.getElementById('oc-year').checked ? SY.lastTermDay() : SY.currentTermEnd(frd)), addedAt: new Date().toISOString() });
        closeSheet(); changed(); render(); toast('Added to your calendar'); break;
      }
      case 'setup': setupKids = null; setupDraft = null; setupSheet(false); break;
      case 's-addkid': readSetupKids(); setupKids.push({ id: uid('k'), name: '', age: '', col: KID_COLOURS[setupKids.length % KID_COLOURS.length] }); setupSheet(!P()); var ins = document.querySelectorAll('#kidlist .k-name'); ins[ins.length - 1].focus(); break;
      case 's-delkid': readSetupKids(); setupKids = setupKids.filter(function (k) { return k.id !== kid; }); setupSheet(!P()); break;
      case 's-save': saveSetup(el.dataset.first === '1'); break;
      case 'find': findSheet(kid, w); break;
      case 'custom': customSheet(kid, w); break;
      case 'editcustom': customSheet(p.kid, p.week, p); break;
      case 'closesheet': closeSheet(); break;
      case 'addcamp': { var c = campPool[el.dataset.src]; if (!c) break; addCampPlan(kid, w, c); closeSheet(); changed(); render(); toast('Added for ' + kidById(kid).name + ' as planned'); break; }
      case 'savecustom': {
        var t = document.getElementById('ctitle').value.trim(); if (!t) { document.getElementById('ctitle').focus(); toast('Add a short name for this plan'); break; }
        var cost = Math.max(0, +document.getElementById('ccost').value || 0), url = safeUrl(document.getElementById('curl').value);
        if (document.getElementById('curl').value.trim() && !url) { toast('Links need to start with https://'); document.getElementById('curl').focus(); break; }
        if (id) { var ep = planById(id); ep.title = t; ep.cost = cost; ep.url = url; }
        else { var all = document.getElementById('cboth') && document.getElementById('cboth').checked;
          (all ? kids().map(function (k) { return k.id; }) : [kid]).forEach(function (k) { if (!planFor(k, w)) P().plans.push({ id: uid('p'), kid: k, week: w, kind: 'custom', title: t, cost: cost, url: url }); }); }
        closeSheet(); changed(); render(); toast(id ? 'Saved' : 'Added to your planner'); break;
      }
      case 'editcost': costSheet(p); break;
      case 'savecost': { var v = document.getElementById('pcost').value; p.cost = v === '' ? null : Math.max(0, +v || 0); closeSheet(); changed(); render(); toast('Cost updated'); break; }
      case 'book': {
        var bu = safeUrl(p.camp.url) || safeUrl(p.camp.listingUrl); if (bu) window.open(bu, '_blank', 'noopener');
        P().pendingBook = (P().pendingBook || []).filter(function (x) { return x !== p.id; }).concat([p.id]);
        changed(); toast('Come back and tick "I\'ve booked it" once you\'ve booked'); break;
      }
      case 'markbooked': p.status = 'booked'; P().pendingBook = (P().pendingBook || []).filter(function (x) { return x !== p.id; }); changed(); render(); toast('Marked as booked'); break;
      case 'notyet': P().pendingBook = (P().pendingBook || []).filter(function (x) { return x !== p.id; }); changed(); render(); break;
      case 'unbook': p.status = 'planned'; changed(); render(); toast('Back to planned'); break;
      case 'remove': P().plans = P().plans.filter(function (x) { return x !== p; }); changed(); render(); toast('Removed'); break;
      case 'cycle': {
        var x = day(w, +el.dataset.day), k = el.dataset.key;
        if (k.indexOf('leave') !== 0) { returnToDay = document.querySelector('.sheet .dslot') ? [w, +el.dataset.day] : null; pickSheet(w, +el.dataset.day, k); break; }
        x[k] = x[k] === 0 || !x[k] ? 0.5 : x[k] === 0.5 ? 1 : 0; changed(); rerenderKeepOpen();
        var b = document.querySelector('[data-act="cycle"][data-week="' + w + '"][data-day="' + el.dataset.day + '"][data-key="' + k + '"]'); if (b) b.focus(); break;
      }
      case 'pickperson': {
        day(pickCtx.w, pickCtx.d)[pickCtx.key] = el.dataset.pid || null; var pc = pickCtx; closeSheet(); changed(); rerenderKeepOpen();
        if (returnToDay) { var rd = returnToDay; returnToDay = null; daySheet(rd[0], rd[1]); break; }
        var b2 = document.querySelector('[data-act="cycle"][data-week="' + pc.w + '"][data-day="' + pc.d + '"][data-key="' + pc.key + '"]'); if (b2) b2.focus(); break;
      }
      case 'people': returnToDay = null; peopleSheet(); break;
      case 'goto': state.view = el.dataset.view; render(); window.scrollTo(0, 0); break;
      case 'dayopen': daySheet(w, +el.dataset.day); break;
      case 'leaveday': { var y = day(w, +el.dataset.day), lk = el.dataset.key; y[lk] = !y[lk] ? 0.5 : y[lk] === 0.5 ? 1 : 0; changed(); rerenderKeepOpen(); daySheet(w, +el.dataset.day); break; }
      case 'colour': savePeopleNames(); P().carers.find(function (c) { return c.id === el.dataset.pid; }).col = el.dataset.col; peopleSheet(); break;
      case 'addperson': {
        savePeopleNames(); var used = P().carers.map(function (c) { return c.col; });
        var col = COLOURS.find(function (k) { return used.indexOf(k) === -1; }) || COLOURS[P().carers.length % COLOURS.length];
        var pid = uid('c'); P().carers.push({ id: pid, name: '', col: col }); peopleSheet();
        var i = document.getElementById('pname-' + pid); i.placeholder = 'Name, e.g. Auntie Sinéad'; i.focus(); break;
      }
      case 'delperson': {
        savePeopleNames(); var did = el.dataset.pid; var nm = (carer(did) || {}).name || 'Person';
        P().carers = P().carers.filter(function (c) { return c.id !== did; });
        Object.keys(P().days).forEach(function (key) { var dd = P().days[key]; ['drop','pick','aft'].forEach(function (s) { if (dd[s] === did) dd[s] = null; }); });
        peopleSheet(); toast(nm + ' removed and their days cleared'); break;
      }
      case 'savepeople': closeSheet(); toast('People updated'); break;
      case 'join': {
        var f = state.friends.find(function (x) { return x.id === el.dataset.fid; }); if (!f) break;
        var fp = (f.plans || []).slice().sort(function (a2, b3) { return a2.week - b3.week; })[+el.dataset.idx]; if (!fp) break;
        addCampPlan(kid, fp.week, fp.camp); changed(); render(); toast('Added ' + fp.camp.name + ' for ' + kidById(kid).name + ', week ' + (fp.week + 1));
        var bu2 = safeUrl(fp.camp.url) || safeUrl(fp.camp.listingUrl);
        if (bu2) { var np = P().plans[P().plans.length - 1]; P().pendingBook = (P().pendingBook || []).concat([np.id]); window.open(bu2, '_blank', 'noopener'); }
        break;
      }
      case 'makeinvite': post({ action: 'invite' }).then(function (j) { state.inviteCode = j.code; render(); }).catch(function () { toast('Couldn\'t make a link. Try again.'); }); break;
      case 'disconnect': {
        var fr = state.friends.find(function (x) { return x.id === id; });
        if (!window.confirm('Disconnect from ' + (fr ? fr.name : 'this parent') + '? You\'ll both stop seeing each other\'s camps.')) break;
        post({ action: 'disconnect', id: id }).then(function () { state.friends = state.friends.filter(function (x) { return x.id !== id; }); render(); toast('Disconnected'); })
          .catch(function () { toast('Couldn\'t disconnect. Try again.'); }); break;
      }
      case 'copy': {
        var txt = inviteLink();
        var done = function () { toast('Link copied'); };
        var fail = function () { var r = document.createRange(); r.selectNodeContents(document.getElementById('invitelink')); var s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Link selected, copy it from here'); };
        try { navigator.clipboard.writeText(txt).then(done, fail); } catch (_) { fail(); } break;
      }
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && P()) closeSheet(); });

  // ---------- start ----------
  function gatePage(title, body, cta) {
    document.getElementById('app').innerHTML = '<div class="gate"><h1>' + title + '</h1><p class="muted">' + body + '</p>' + (cta || '') + '</div>';
  }
  function handleJoin(code) {
    history.replaceState(null, '', '/planner');
    try { localStorage.removeItem('sortd_pending_join'); } catch (_) {}
    return post({ action: 'join', code: code }).then(function (j) {
      if (j.friend && !state.friends.some(function (f) { return f.id === j.friend.id; })) state.friends.push(j.friend);
      toast('You\'re connected with ' + (j.friend ? j.friend.name : 'a friend'));
    }).catch(function (err) {
      toast(err.code === 'own_code' ? 'That\'s your own invite link' : 'That invite link didn\'t work. Ask your friend to send it again.');
    });
  }
  function start() {
    var params = new URLSearchParams(location.search), join = params.get('join');
    fetch(API, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data.loggedIn) {
        if (join) { try { localStorage.setItem('sortd_pending_join', join); } catch (_) {} }
        gatePage('Log in to plan your summer', join ? 'A friend invited you to connect on the Sortd summer planner. Log in or create your free account to see where their kids are going.' : 'The summer planner lives in your Sortd account.',
          '<a class="btn" href="/login">Log in with your email</a>');
        return;
      }
      if (!data.tester) {
        try { localStorage.removeItem('sortd_pending_join'); } catch (_) {}
        gatePage('The summer planner is coming soon', 'We\'re testing it with a small group of parents first. You\'ll be the first to know when it opens.', '<a class="btn" href="/account">Back to my account</a>');
        return;
      }
      state.friends = data.friends || []; state.inviteCode = data.inviteCode || null; state.plan = data.plan || null;
      if (state.plan) {
        ['kids','carers','plans','pendingBook','classes'].forEach(function (k) { if (!Array.isArray(state.plan[k])) state.plan[k] = []; });
        if (!state.plan.days || typeof state.plan.days !== 'object') state.plan.days = {};
        if (!state.plan.me) state.plan.me = { name: '' };
      }
      fetch('/.netlify/functions/get-saved', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (s) { state.savedIds = s.saved || []; }).catch(function () {});
      var pending = join; if (!pending) { try { pending = localStorage.getItem('sortd_pending_join'); } catch (_) {} }
      var after = pending ? handleJoin(pending) : Promise.resolve();
      after.then(function () {
        if (!state.plan) { document.getElementById('app').innerHTML = '<p class="loading">Welcome to your summer planner.</p>'; setupSheet(true); return; }
        if (pending && state.friends.length) state.view = 'friends';
        else if (/^#(calendar|summer|friends|costs)$/.test(location.hash)) state.view = { '#summer': 'plan', '#calendar': 'calendar', '#friends': 'friends', '#costs': 'costs' }[location.hash];
        render(); setSaveState('Saved');
        if (!state.plan.me.name || !state.plan.kids.length) { setupKids = null; setupDraft = null; setupSheet(false); }
      });
    }).catch(function () {
      gatePage('Something went wrong', 'We couldn\'t load your planner. Check your connection and refresh the page.');
    });
  }
  start();
})();
