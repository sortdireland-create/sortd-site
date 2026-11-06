// js/whats-on.js — the public What's on page (/whats-on).
//
// Loads every monthly guide listed in /data/guides-index.json, merges their
// days out (an event that runs across months appears once) and shows each
// until its last date. Filters: when (this weekend / next 7 days), area,
// age, free / rainy day / ND-friendly. URL params ?age=6-8&area=City&when=weekend.
//
// "Add to my Sortd calendar": logged out = greyed with a padlock, tapping
// asks for an email and sends the login link (then returns here with the
// sheet open); logged in = pick who's going, the day and time, saved via
// /.netlify/functions/planner action "addOuting".
(function () {
  'use strict';
  var SY = window.SortdSchoolYear;
  var API = '/.netlify/functions/planner';
  var TAGS = { free: 'Free', rainy: 'Rainy day', nd: 'ND-friendly', book: 'Book early', tbc: 'Details to confirm' };
  var AGE = { baby: [0, 3], little: [4, 7], big: [8, 12] };
  var KID_COLOURS = { '--gr': '#1D8A52', '--pk': '#D45F86', '--sk': '#3D77A3', '--pu': '#5B4FCA', '--ochre': '#A6812F', '--teal': '#2F8584' };
  var events = [], guides = [];
  var f = { when: 'any', area: 'all', age: '', tags: [] };
  var myKids = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { u = String(u || '').trim(); return /^https?:\/\//i.test(u) || /^\/[^/]/.test(u) ? u : ''; }
  function loggedIn() { return document.cookie.split('; ').some(function (c) { return c === 'sortd_logged_in=1'; }); }
  function track(name, extra) { try { if (window.gtag) window.gtag('event', name, extra || {}); } catch (_) {} }
  function hhmm(v) { if (typeof v === 'number') return v; var m = String(v || '').match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function today() { return SY.iso(SY.today()); }

  // Accept both the hand-built format and the monthly-guide skill's format.
  function norm(e, guide) {
    if (e.start == null && e.time !== undefined) e.start = hhmm(e.time);
    if (typeof e.end === 'string') e.end = hhmm(e.end);
    if (!e.region && e.area) e.region = e.area;
    if (!e.times && e.when) e.times = e.when;
    e.tags = (e.tags || []).map(function (t) { return t === 'rain' ? 'rainy' : t; });
    if (e.dates && e.dates.length) { e.from = e.from || e.dates[0]; e.to = e.to || e.dates[e.dates.length - 1]; }
    if (typeof e.age === 'string' && AGE[e.age]) { e.ageMin = AGE[e.age][0]; e.ageMax = AGE[e.age][1]; }
    if (!e.ages && e.age) e.ages = e.age === 'all' ? 'All ages' : e.age === 'baby' ? 'Babies & toddlers' : e.age === 'little' ? 'Ages 4 to 7' : e.age === 'big' ? 'Ages 8 to 12' : e.age;
    if (e.ageMin == null && e.ages) {
      var m = String(e.ages).match(/(\d+)\s*(?:to|–|-)\s*(\d+)/), p = String(e.ages).match(/(\d+)\s*\+/);
      if (m) { e.ageMin = +m[1]; e.ageMax = +m[2]; } else if (p) { e.ageMin = +p[1]; e.ageMax = 99; }
    }
    e._guide = guide;
    return e;
  }
  function allowedDates(e) {
    var out = [], t = today();
    if (e.dates && !e.days) out = e.dates.filter(function (d) { return d >= t; });
    else {
      var d = SY.parseISO(e.from > t ? e.from : t), to = SY.parseISO(e.to);
      for (; d <= to && out.length < 90; d = SY.addDays(d, 1)) if (!e.days || e.days.indexOf(d.getDay()) !== -1) out.push(SY.iso(d));
    }
    (e.extraDates || []).forEach(function (x) { if (x >= t && out.indexOf(x) === -1) out.push(x); });
    return out.sort();
  }
  function windowDates() {
    var t = SY.today();
    if (f.when === 'week') { var w = []; for (var i = 0; i < 7; i++) w.push(SY.iso(SY.addDays(t, i))); return w; }
    if (f.when === 'weekend') {
      var dow = t.getDay(), sat = SY.addDays(t, (6 - dow + 7) % 7), sun = SY.addDays(sat, 1);
      var list = [SY.iso(sat), SY.iso(sun)]; if (dow === 0) list = [SY.iso(t)]; // it's Sunday: just today
      return list;
    }
    return null;
  }
  function visible() {
    var win = windowDates(), ageR = f.age ? f.age.split('-').map(Number) : null;
    return events.filter(function (e) {
      var ds = allowedDates(e); if (!ds.length) return false;
      if (win && !ds.some(function (d) { return win.indexOf(d) !== -1; })) return false;
      if (f.area !== 'all' && e.region !== f.area) return false;
      if (ageR && e.ageMin != null && (e.ageMax < ageR[0] || e.ageMin > ageR[1])) return false;
      return f.tags.every(function (t) { return (e.tags || []).indexOf(t) !== -1; });
    }).sort(function (a, b) { var x = allowedDates(a)[0], y = allowedDates(b)[0]; return x < y ? -1 : x > y ? 1 : 0; });
  }
  function whenLabel(e) {
    var ds = allowedDates(e), t = today(), first = ds[0], last = e.to;
    if (ds.length === 1) return first === t ? 'Today' : SY.nice(SY.parseISO(first));
    if (e.from <= t) return 'On now · until ' + SY.nice(SY.parseISO(last));
    return 'From ' + SY.nice(SY.parseISO(first)) + ' · until ' + SY.nice(SY.parseISO(last));
  }
  function card(e) {
    var u = safeUrl(e.url), share = 'https://wa.me/?text=' + encodeURIComponent(e.title + ' (' + whenLabel(e) + '). Found on Sortd: https://sortd-ireland.ie/whats-on#' + e.id);
    return '<article class="wo-card" id="' + esc(e.id) + '">' +
      '<div class="wo-top"><span class="wo-when">' + esc(whenLabel(e)) + '</span>' + (e.region ? '<span class="wo-region">' + esc(e.region) + '</span>' : '') + '</div>' +
      '<h3>' + esc(e.title) + '</h3>' +
      (e.times ? '<div class="wo-meta"><i class="ti ti-clock"></i>' + esc(e.times) + '</div>' : '') +
      (e.venue ? '<div class="wo-meta"><i class="ti ti-map-pin"></i>' + esc(e.venue) + '</div>' : '') +
      '<div class="wo-meta"><i class="ti ti-users"></i>' + esc(e.ages || 'All ages') + (e.price ? ' · <b>' + esc(e.price) + '</b>' : '') + '</div>' +
      (e.desc ? '<p class="wo-desc">' + esc(e.desc) + '</p>' : '') +
      '<div class="wo-tags">' + (e.tags || []).map(function (t) { return TAGS[t] ? '<span class="wo-tag wo-tag--' + t + '">' + TAGS[t] + '</span>' : ''; }).join('') + '</div>' +
      '<div class="wo-acts"><button type="button" class="lp-btn lp-btn--cal wo-add' + (loggedIn() ? '' : ' is-locked') + '" data-id="' + esc(e.id) + '"><i class="ti ' + (loggedIn() ? 'ti-calendar-plus' : 'ti-lock') + '"></i> Add to my Sortd calendar</button>' +
      '<div class="wo-links">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Info <i class="ti ti-external-link"></i></a>' : '') +
      '<a href="' + esc(share) + '" target="_blank" rel="noopener noreferrer" aria-label="Send ' + esc(e.title) + ' on WhatsApp"><i class="ti ti-brand-whatsapp"></i> Send</a></div></div>' +
      '</article>';
  }
  function render() {
    var list = visible();
    document.getElementById('woCount').textContent = list.length ? list.length + ' thing' + (list.length === 1 ? '' : 's') + ' on' + (f.when === 'weekend' ? ' this weekend' : f.when === 'week' ? ' in the next 7 days' : '') : 'Nothing matches those filters. Try fewer.';
    document.getElementById('woGrid').innerHTML = list.map(card).join('');
    var p = new URLSearchParams();
    if (f.when !== 'any') p.set('when', f.when); if (f.area !== 'all') p.set('area', f.area); if (f.age) p.set('age', f.age); if (f.tags.length) p.set('tags', f.tags.join(','));
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : '') + location.hash);
  }
  function renderFilters() {
    var regions = []; events.forEach(function (e) { if (e.region && regions.indexOf(e.region) === -1 && allowedDates(e).length) regions.push(e.region); });
    var order = ['City', 'North', 'South', 'Fingal']; regions.sort(function (a, b) { return (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99); });
    document.getElementById('woAreas').innerHTML = '<button type="button" data-v="all"' + (f.area === 'all' ? ' class="on"' : '') + '>All of Dublin</button>' +
      regions.map(function (r) { return '<button type="button" data-v="' + esc(r) + '"' + (f.area === r ? ' class="on"' : '') + '>' + esc(r === 'City' ? 'City centre' : r === 'Fingal' ? 'Fingal' : r + ' Dublin') + '</button>'; }).join('');
    document.querySelectorAll('.wo-chips[data-group="when"] button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === f.when); });
    document.querySelectorAll('.wo-chips[data-group="tags"] button').forEach(function (b) { b.classList.toggle('on', f.tags.indexOf(b.dataset.v) !== -1); b.setAttribute('aria-pressed', String(f.tags.indexOf(b.dataset.v) !== -1)); });
    document.getElementById('woAge').value = f.age;
  }
  function renderGuides() {
    if (!guides.length) return;
    document.getElementById('woGuides').hidden = false;
    document.getElementById('woGuideList').innerHTML = guides.map(function (g) {
      return '<div class="wo-guide"><div><b>' + esc(g.label || g.month) + '</b><span>' + esc(g.title || '') + '</span></div><div class="wo-guide-acts">' +
        (g.guide ? '<a href="' + esc(g.guide) + '">Read online</a>' : '') + (g.pdf ? '<a class="wo-pdf" href="' + esc(g.pdf) + '" download><i class="ti ti-download"></i> PDF</a>' : '') + '</div></div>';
    }).join('');
  }

  // ---- Add to my Sortd calendar ----
  var layer = document.createElement('div'); document.body.appendChild(layer);
  var sel = null;
  function sheet(inner) { layer.innerHTML = '<div class="cp-scrim" data-cp="close"><div class="cp-sheet" role="dialog" aria-modal="true" aria-labelledby="cp-t">' + inner + '</div></div>'; document.body.style.overflow = 'hidden'; }
  function close() { layer.innerHTML = ''; document.body.style.overflow = ''; }
  function head(t, sub) { return '<div class="cp-head"><div><h2 id="cp-t">' + t + '</h2>' + (sub ? '<p>' + sub + '</p>' : '') + '</div><button class="cp-x" data-cp="close" aria-label="Close">✕</button></div>'; }
  function evById(id) { return events.find(function (e) { return e.id === id; }); }
  function t2i(m) { return m == null ? '' : SY.pad(Math.floor(m / 60)) + ':' + SY.pad(m % 60); }
  function i2t(v) { var p = String(v || '').split(':'); return p.length === 2 ? (+p[0]) * 60 + (+p[1]) : null; }
  function kidsHtml() {
    if (myKids === null) return '<p class="cp-hint">Loading your children…</p>';
    var chips = myKids.map(function (k) { var on = sel.kids.indexOf(k.id) !== -1; return '<button type="button" class="cp-kid' + (on ? ' on' : '') + '" data-kid="' + esc(k.id) + '" aria-pressed="' + on + '"><i style="background:' + (KID_COLOURS[k.col] || '#5B4FCA') + '"></i>' + esc(k.name) + '</button>'; }).join('');
    var news = sel.newKids.map(function (k, i) { return '<div class="cp-row cp-newkid"><label class="cp-f">Child\'s first name<input class="nk-name" data-i="' + i + '" value="' + esc(k.name) + '" maxlength="30"></label><label class="cp-f cp-f--age">Age<input class="nk-age" data-i="' + i + '" type="number" min="0" max="17" value="' + esc(k.age) + '"></label></div>'; }).join('');
    return (chips ? '<div class="cp-kids">' + chips + '</div>' : '') + news + '<button type="button" class="cp-link" data-cp="addkid">+ Add ' + (myKids.length || sel.newKids.length ? 'another' : 'a') + ' child</button>';
  }
  function openAdd(id) {
    var e = evById(id); if (!e) return;
    if (!loggedIn()) return signup(e);
    sel = { e: e, kids: [], newKids: [] };
    if (myKids && myKids.length) sel.kids = myKids.map(function (k) { return k.id; });
    var ds = allowedDates(e), win = windowDates(), pre = (win && ds.find(function (d) { return win.indexOf(d) !== -1; })) || ds[0];
    sheet(head('Add to my Sortd calendar', esc(e.title)) +
      '<div class="cp-f"><span>Who\'s going?</span><div id="wo-kids">' + kidsHtml() + '</div></div>' +
      '<label class="cp-f">Which day?<select id="wo-date">' + ds.map(function (d) { return '<option value="' + d + '"' + (d === pre ? ' selected' : '') + '>' + SY.nice(SY.parseISO(d)) + '</option>'; }).join('') + '</select></label>' +
      '<div class="cp-row"><label class="cp-f">Starts<input type="time" id="wo-start" value="' + t2i(e.start) + '"></label><label class="cp-f">Ends<input type="time" id="wo-end" value="' + t2i(e.start != null ? (e.end != null ? e.end : e.start + 60) : null) + '"></label></div>' +
      '<p class="cp-hint">' + (e.start == null ? 'Times vary. Add your ticket time, or leave it blank to add it as all day.' : 'Change the time if you\'ve booked a different slot.') + '</p>' +
      '<div class="cp-acts"><button class="cp-btn cp-btn--pri" type="button" id="wo-save">Add to my Sortd calendar</button></div>');
    track('whats_on_add_open', { event_id: e.id });
    if (myKids === null) fetch(API, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      myKids = (d.plan && Array.isArray(d.plan.kids)) ? d.plan.kids : [];
      if (sel) { sel.kids = myKids.map(function (k) { return k.id; }); if (!myKids.length && !sel.newKids.length) sel.newKids.push({ name: '', age: '' }); var b = document.getElementById('wo-kids'); if (b) b.innerHTML = kidsHtml(); }
    }).catch(function () { myKids = []; });
  }
  function save() {
    var e = sel.e, newKids = sel.newKids.filter(function (k) { return k.name.trim(); });
    if (!sel.kids.length && !newKids.length) { var h = document.getElementById('wo-kids'); if (h) h.insertAdjacentHTML('beforeend', '<p class="cp-hint cp-err">Choose who\'s going.</p>'); return; }
    var st = i2t(document.getElementById('wo-start').value), en = i2t(document.getElementById('wo-end').value), date = document.getElementById('wo-date').value;
    var btn = document.getElementById('wo-save'); btn.disabled = true; btn.textContent = 'Adding…';
    fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addOuting', kidIds: sel.kids, newKids: newKids,
      outing: { eventId: e.id, title: e.title, venue: e.venue || '', url: safeUrl(e.url), date: date, start: st, end: st != null ? (en != null && en > st ? en : st + 60) : null } }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'error'); return j; }); })
      .then(function (j) {
        myKids = j.kids || myKids; sel = null;
        sheet(head('Added to your Sortd calendar', '') + '<div class="cp-sum"><b>' + esc(e.title) + '</b><br>' + SY.nice(SY.parseISO(date)) + (st != null ? ', ' + SY.fmtTime(st) : ', all day') + '</div>' +
          '<div class="cp-acts"><a class="cp-btn cp-btn--pri" href="/planner#calendar">Open my Sortd calendar</a><button class="cp-btn" type="button" data-cp="close">Keep browsing</button></div>');
        track('whats_on_added', { event_id: e.id });
      })
      .catch(function () { btn.disabled = false; btn.textContent = 'Add to my Sortd calendar'; btn.insertAdjacentHTML('afterend', '<p class="cp-hint cp-err">Couldn\'t add it just now. Please try again.</p>'); });
  }
  function signup(e) {
    sheet(head('Add days out to your Sortd calendar', 'Free with a Sortd account. Pop in your email and we\'ll send you a link to log in. No password needed.') +
      '<form id="cp-signup" class="cp-acts" novalidate><label class="cp-f">Your email<input type="email" id="cp-email" autocomplete="email" required placeholder="you@example.ie"></label>' +
      '<button class="cp-btn cp-btn--pri" type="submit">Create my free account</button></form><p class="cp-hint" id="cp-msg" role="status" aria-live="polite">Already have an account? Same thing: enter your email and we\'ll send you a login link.</p>');
    layer.dataset.pending = e.id;
    var i = document.getElementById('cp-email'); if (i) i.focus();
    track('whats_on_locked_click', { event_id: e.id });
  }
  layer.addEventListener('submit', function (ev) {
    if (ev.target.id !== 'cp-signup') return; ev.preventDefault();
    var input = document.getElementById('cp-email'), msg = document.getElementById('cp-msg'), btn = ev.target.querySelector('button'), email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Please enter a valid email address.'; input.focus(); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    try { localStorage.setItem('sortd_return_to', '/whats-on#add-' + (layer.dataset.pending || '')); } catch (_) {}
    fetch('/.netlify/functions/request-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'error'); return j; }); })
      .then(function () { ev.target.outerHTML = '<div class="cp-sum"><b>Check your inbox</b><br><span>We\'ve sent a login link to ' + esc(email) + '. Open it on this phone or computer and you\'ll come straight back here.</span></div>'; msg.textContent = 'The link works once and expires after 30 minutes.'; })
      .catch(function (err) { btn.disabled = false; btn.textContent = 'Create my free account'; msg.textContent = (err && err.message && err.message !== 'error') ? err.message : 'Something went wrong. Please try again.'; });
  });
  layer.addEventListener('click', function (ev) {
    var c = ev.target.closest('[data-cp="close"]');
    if (c && (ev.target === c || c.classList.contains('cp-x') || c.tagName === 'BUTTON')) { close(); return; }
    var k = ev.target.closest('.cp-kid'); if (k && sel) { var id = k.dataset.kid, i = sel.kids.indexOf(id); if (i === -1) sel.kids.push(id); else sel.kids.splice(i, 1); document.getElementById('wo-kids').innerHTML = kidsHtml(); return; }
    if (ev.target.closest('[data-cp="addkid"]') && sel) { sel.newKids.push({ name: '', age: '' }); document.getElementById('wo-kids').innerHTML = kidsHtml(); var ns = layer.querySelectorAll('.nk-name'); if (ns.length) ns[ns.length - 1].focus(); return; }
    if (ev.target.id === 'wo-save') save();
  });
  layer.addEventListener('input', function (ev) { var t = ev.target, i = +t.getAttribute('data-i'); if (!sel) return; if (t.classList.contains('nk-name')) sel.newKids[i].name = t.value; if (t.classList.contains('nk-age')) sel.newKids[i].age = t.value; });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && layer.innerHTML) close(); });

  // ---- Filters ----
  document.getElementById('woFilters').addEventListener('click', function (ev) {
    var b = ev.target.closest('.wo-chips button'); if (!b) return;
    var g = b.parentNode.dataset.group, v = b.dataset.v;
    if (g === 'tags') { var i = f.tags.indexOf(v); if (i === -1) f.tags.push(v); else f.tags.splice(i, 1); } else f[g] = v;
    renderFilters(); render(); track('whats_on_filter', { group: g, value: v });
  });
  document.getElementById('woAge').addEventListener('change', function (ev) { f.age = ev.target.value; render(); });
  document.getElementById('woGrid').addEventListener('click', function (ev) { var b = ev.target.closest('.wo-add'); if (b) openAdd(b.dataset.id); });

  // ---- Load ----
  var q = new URLSearchParams(location.search);
  if (/^(weekend|week)$/.test(q.get('when') || '')) f.when = q.get('when');
  if (q.get('area')) f.area = q.get('area');
  if (/^\d+-\d+$/.test(q.get('age') || '')) f.age = q.get('age');
  if (q.get('tags')) f.tags = q.get('tags').split(',').filter(function (t) { return TAGS[t]; });

  fetch('/data/guides-index.json').then(function (r) { return r.json(); }).then(function (idx) {
    guides = idx.guides || [];
    return Promise.all(guides.map(function (g) { return fetch(g.data).then(function (r) { return r.ok ? r.json() : { events: [] }; }).catch(function () { return { events: [] }; }); }));
  }).then(function (files) {
    var seen = {};
    files.forEach(function (file, i) { (file.events || []).forEach(function (e) { if (seen[e.id]) return; seen[e.id] = 1; events.push(norm(e, guides[i])); }); });
    var regions = events.map(function (e) { return e.region; });
    if (f.area !== 'all' && regions.indexOf(f.area) === -1) f.area = 'all';
    renderFilters(); render(); renderGuides();
    var h = location.hash;
    if (/^#add-/.test(h)) { history.replaceState(null, '', location.pathname + location.search); if (loggedIn()) setTimeout(function () { openAdd(h.slice(5)); }, 300); }
    else if (h && document.getElementById(h.slice(1))) document.getElementById(h.slice(1)).scrollIntoView({ block: 'center' });
  }).catch(function () { document.getElementById('woCount').textContent = 'Couldn\'t load what\'s on. Please refresh the page.'; });
})();
