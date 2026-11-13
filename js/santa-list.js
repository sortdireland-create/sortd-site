// js/santa-list.js — the Sortd Santa List page (/christmas).
// Talks to netlify/functions/santa-list.js. Views: login, setup, list (parents)
// and givers (?share=… family link, no login, family ideas only).
(function () {
  'use strict';
  var API = '/.netlify/functions/santa-list';
  var POLL_MS = 25000;
  var EMOJIS = ['🦄', '🦖', '🧸', '🚀', '🐻', '🌟', '🐰', '⚽'];
  var STATUS_NEXT = { idea: 'bought', bought: 'wrapped', wrapped: 'idea' };
  var STATUS_LABEL = { idea: '💡 Idea', bought: '✅ Bought', wrapped: '🎀 Wrapped' };

  var $ = function (s) { return document.querySelector(s); };
  var q = new URLSearchParams(location.search);
  var shareParam = q.get('share');
  var joinParam = q.get('join');

  var state = { email: '', family: null, gifts: [], pollToken: '', kid: null, eyes: false };
  var pollTimer = null, polling = false, editing = null, draft = {}, claiming = null, giversShare = null, giversGifts = [];

  try { state.eyes = localStorage.getItem('sl_eyes') === '1'; } catch (e) {}

  // ── utils ───────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // Whole euros as €30; anything with cents always shows 2 places (€12.50, not €12.5).
  function eur(n) { var v = Math.round((Number(n) || 0) * 100) / 100; return '€' + v.toLocaleString('en-IE', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'link'; } }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function track(name, params) { try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) {} }
  function show(id) {
    ['v-loading', 'v-login', 'v-setup', 'v-list', 'v-givers', 'v-error'].forEach(function (v) { $('#' + v).hidden = v !== id; });
  }
  var toastT;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600); }
  function status(el, kind, msg) { el.className = 'sl-status' + (kind ? ' ' + kind : ''); el.textContent = msg || ''; }
  function errorText(code) {
    return ({
      busy: 'Santa\'s elves are busy. Please try again in a moment.',
      not_logged_in: 'You\'ve been logged out. Refresh the page to log in again.',
      bad_code: 'That invite link doesn\'t work any more. Ask for a new one.',
      already_in_family: 'You\'re already on a family list.',
      family_full: 'That family list already has the maximum number of parents.',
      kids_required: 'Add at least one child\'s name.',
      name_required: 'Give the gift a name.',
      taken: 'Someone has just claimed this one.',
      too_many_gifts: 'That\'s a lot of gifts! Remove a few old ones first.',
      not_found: 'That gift isn\'t on the list any more.'
    })[code] || 'Something went wrong. Please try again.';
  }
  function api(method, body, query) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return fetch(API + (query || ''), opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || 'server_error'); e.code = data.error || 'server_error'; e.status = res.status; throw e; }
        return data;
      });
    });
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }
  function kidNames(kids) {
    var n = kids.map(function (k) { return k.name; });
    return n.length > 1 ? n.slice(0, -1).join(', ') + ' & ' + n[n.length - 1] : (n[0] || '');
  }
  function openModal(id) { $('#' + id).hidden = false; }
  function closeModal(id) { $('#' + id).hidden = true; }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') ['gift-scrim', 'share-scrim', 'kids-scrim', 'claim-scrim', 'shop-scrim'].forEach(closeModal);
  });
  ['gift-scrim', 'share-scrim', 'kids-scrim', 'claim-scrim', 'shop-scrim'].forEach(function (id) {
    $('#' + id).addEventListener('click', function (e) { if (e.target.id === id) closeModal(id); });
  });

  // countdown
  (function () {
    var now = new Date(), x = new Date(now.getFullYear(), 11, 25);
    if (now > x && now.getDate() !== 25) x.setFullYear(x.getFullYear() + 1);
    var d = Math.ceil((x - now) / 864e5);
    $('#sl-count').textContent = d <= 0 ? '🎄 It\'s Christmas!' : '🎅 ' + d + (d === 1 ? ' sleep' : ' sleeps') + ' till Christmas';
  })();

  // ── LOGIN ──────────────────────────────────────────────────
  var lastEmail = '', resendTimer = null;
  function sendLink(isResend) {
    var btn = $('#login-btn'), st = $('#login-status');
    var email = isResend ? lastEmail : $('#login-email').value.trim();
    var next = '/christmas' + (joinParam && /^[A-Za-z0-9]{6,32}$/.test(joinParam) ? '?join=' + joinParam : '');
    btn.disabled = true; btn.textContent = 'Sending…'; status(st);
    return fetch('/.netlify/functions/request-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, newsletterOptIn: $('#newsletter-optin').checked, next: next })
    }).then(function (res) {
      return res.json().then(function (d) { if (!res.ok) throw new Error(d.error || 'Something went wrong'); return d; });
    }).then(function () {
      lastEmail = email;
      showSent(email, isResend);
      track(isResend ? 'santa_login_resent' : 'santa_login_requested', { newsletter: $('#newsletter-optin').checked, domain: email.split('@')[1] || '' });
    }).catch(function (err) {
      status(st, 'err', err.message || 'Something went wrong. Please try again.');
      btn.disabled = false; btn.textContent = 'Email me my link';
    });
  }
  function showSent(email, isResend) {
    var st = $('#login-status'), btn = $('#login-btn');
    var ms = /@(hotmail|outlook|live|msn)\./i.test(email);
    st.className = 'sl-status ok';
    st.innerHTML =
      '<b>' + (isResend ? 'Sent again' : 'Check your inbox') + '.</b> We\'ve emailed a login link to ' + esc(email) + '. It\'s from hello@sortd-ireland.ie.' +
      '<br><br>' + (ms ? '<b>Using Hotmail or Outlook?</b> Look in Junk and "Other" too. It can take a few minutes to arrive.'
                       : 'Not there? Look in Spam or Promotions. It can take a few minutes to arrive.') +
      '<div class="sl-resend"><button type="button" class="sl-btn sl-btn-ghost sl-btn-sm" id="login-resend" disabled>Send it again</button>' +
      '<button type="button" class="sl-linkbtn" id="login-other">Use a different email</button></div>' +
      '<p class="sl-resend-note">Still nothing after 10 minutes? Try a different email address, like a Gmail one.</p>';
    btn.textContent = 'Sent ✓';
    var rb = $('#login-resend'), wait = 30;
    clearInterval(resendTimer);
    rb.textContent = 'Send it again (' + wait + 's)';
    resendTimer = setInterval(function () {
      wait--;
      if (wait <= 0) { clearInterval(resendTimer); rb.disabled = false; rb.textContent = 'Send it again'; }
      else rb.textContent = 'Send it again (' + wait + 's)';
    }, 1000);
    rb.onclick = function () { rb.disabled = true; sendLink(true); };
    $('#login-other').onclick = function () {
      clearInterval(resendTimer);
      status(st); btn.disabled = false; btn.textContent = 'Email me my link';
      var inp = $('#login-email'); inp.value = ''; inp.focus();
    };
  }
  $('#login-form').addEventListener('submit', function (e) { e.preventDefault(); sendLink(false); });

  // ── SETUP ──────────────────────────────────────────────────
  function kidRow(container, kid, i) {
    var row = document.createElement('div');
    row.className = 'sl-kidrow';
    row.dataset.id = kid && kid.id || '';
    var sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Emoji');
    EMOJIS.forEach(function (em) { var o = document.createElement('option'); o.textContent = em; o.value = em; sel.appendChild(o); });
    sel.value = (kid && kid.emoji) || EMOJIS[i % EMOJIS.length];
    var inp = document.createElement('input');
    inp.className = 'sl-in'; inp.maxLength = 30; inp.placeholder = 'First name'; inp.value = (kid && kid.name) || '';
    inp.setAttribute('aria-label', 'Child\'s first name');
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'sl-x'; x.setAttribute('aria-label', 'Remove'); x.textContent = '✕';
    x.onclick = function () { if (container.children.length > 1) row.remove(); else inp.value = ''; };
    row.appendChild(sel); row.appendChild(inp); row.appendChild(x);
    container.appendChild(row);
    return inp;
  }
  function readKidRows(container) {
    return Array.prototype.map.call(container.querySelectorAll('.sl-kidrow'), function (r) {
      return { id: r.dataset.id || undefined, emoji: r.querySelector('select').value, name: r.querySelector('input').value.trim() };
    }).filter(function (k) { return k.name; });
  }
  function showSetup() {
    show('v-setup');
    var c = $('#setup-kids'); c.innerHTML = '';
    kidRow(c, null, 0); kidRow(c, null, 1);
    $('#setup-join').hidden = !joinParam;
  }
  $('#setup-addkid').onclick = function () { var c = $('#setup-kids'); if (c.children.length < 8) kidRow(c, null, c.children.length).focus(); };
  $('#setup-go').onclick = function () {
    var kids = readKidRows($('#setup-kids')), st = $('#setup-status'), btn = $('#setup-go');
    if (!kids.length) { status(st, 'err', errorText('kids_required')); return; }
    btn.disabled = true; status(st);
    api('POST', { action: 'create', familyName: $('#setup-family').value, kids: kids }).then(function () {
      track('santa_family_created', { kids: kids.length });
      return load();
    }).catch(function (e) { status(st, 'err', errorText(e.code)); btn.disabled = false; });
  };
  $('#join-btn').onclick = function () {
    var st = $('#join-status'), btn = $('#join-btn');
    btn.disabled = true; status(st);
    api('POST', { action: 'join', code: joinParam }).then(function () {
      track('santa_partner_joined');
      clearJoinParam();
      return load();
    }).catch(function (e) { status(st, 'err', errorText(e.code)); btn.disabled = false; });
  };
  function clearJoinParam() {
    joinParam = null;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  }

  // ── LIST ───────────────────────────────────────────────────
  var ALL = '__all';
  function kidsOfGift(g) { return (g.kids && g.kids.length) ? g.kids : [g.kid]; }
  function visible(g) { return !state.eyes || g.from !== 'santa'; }
  function giftsFor(kidId, from) {
    return state.gifts.filter(function (g) { return g.from === from && (kidId === ALL || kidsOfGift(g).indexOf(kidId) !== -1); });
  }
  function kidName(id) { var k = state.family.kids.filter(function (x) { return x.id === id; })[0]; return k ? k.name : ''; }
  function joinNames(names) { return names.length > 1 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : (names[0] || ''); }
  function sum(list) { return list.reduce(function (a, g) { return a + (Number(g.price) || 0); }, 0); }
  function renderTabs() {
    var tabs = $('#kid-tabs'); tabs.innerHTML = '';
    var list = state.family.kids.slice();
    if (list.length > 1) list.unshift({ id: ALL, name: 'Everyone', emoji: '👨‍👩‍👧‍👦' });
    list.forEach(function (k) {
      var b = document.createElement('button');
      b.className = 'sl-kid' + (k.id === ALL ? ' sl-kid-all' : ''); b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(k.id === state.kid));
      var count = state.gifts.filter(function (g) { return visible(g) && (k.id === ALL || kidsOfGift(g).indexOf(k.id) !== -1); }).length;
      b.innerHTML = esc(k.emoji) + ' ' + esc(k.name) + ' <span class="n">' + count + '</span>';
      b.onclick = function () { state.kid = k.id; render(); };
      tabs.appendChild(b);
    });
  }
  // Whole-list totals, always across every child. Joint gifts count once.
  function renderSummary() {
    var all = state.gifts.filter(visible);
    var santa = all.filter(function (g) { return g.from === 'santa'; });
    var fam = all.filter(function (g) { return g.from === 'family'; });
    var bought = all.filter(function (g) { return g.status !== 'idea'; });
    var claimed = fam.filter(function (g) { return g.claimedBy; });
    var html = '<div class="sl-sum-main"><span class="sl-sum-label">Whole list</span><b>' + eur(sum(all)) + '</b>' +
      '<span>' + all.length + (all.length === 1 ? ' gift' : ' gifts') + '</span></div>' +
      '<div class="sl-sum-parts">' +
      (state.eyes ? '' : '<span class="sl-sum-chip santa">Santa ' + eur(sum(santa)) + '</span>') +
      '<span class="sl-sum-chip fam">Family ideas ' + eur(sum(fam)) + '</span>' +
      '<span class="sl-sum-chip bought">Bought ' + eur(sum(bought)) + ' of ' + eur(sum(all)) + '</span>' +
      (fam.length ? '<span class="sl-sum-chip claimed">' + claimed.length + ' of ' + fam.length + ' family ideas claimed</span>' : '') +
      '</div>';
    if (state.kid === ALL) {
      var rows = state.family.kids.map(function (k) {
        var own = all.filter(function (g) { var ks = kidsOfGift(g); return ks.length === 1 && ks[0] === k.id; });
        return '<span>' + esc(k.emoji) + ' ' + esc(k.name) + ' <b>' + eur(sum(own)) + '</b></span>';
      });
      var shared = all.filter(function (g) { return kidsOfGift(g).length > 1; });
      if (shared.length) rows.push('<span>🤝 Shared <b>' + eur(sum(shared)) + '</b></span>');
      html += '<div class="sl-sum-kids">' + rows.join('') + '</div>';
    }
    $('#sl-summary').innerHTML = html;
  }
  function giftHtml(g) {
    var url = safeUrl(g.url), st = STATUS_LABEL[g.status] ? g.status : 'idea';
    var tags = '';
    var ks = kidsOfGift(g);
    if (state.kid === ALL) tags += '<span class="sl-tag kid">For ' + esc(joinNames(ks.map(kidName))) + '</span>';
    else if (ks.length > 1) tags += '<span class="sl-tag kid">Shared with ' + esc(joinNames(ks.filter(function (id) { return id !== state.kid; }).map(kidName))) + '</span>';
    if (g.from === 'family') tags += '<span class="sl-tag who">' + (g.who ? 'For ' + esc(g.who) + ' to buy' : 'Anyone can take this') + '</span>';
    if (g.claimedBy) tags += '<span class="sl-tag claimed">🙋 ' + esc(g.claimedBy) + ' is getting this</span>';
    if (url) tags += '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer nofollow">🔗 ' + esc(host(url)) + '</a>';
    return '<div class="sl-gift' + (st !== 'idea' ? ' done' : '') + '">' +
      '<div><button class="sl-gname" data-edit="' + esc(g.id) + '" title="Edit">' + esc(g.name) + '</button>' +
      '<div class="sl-meta">' + tags + '</div></div>' +
      '<div class="sl-right"><div class="sl-price">' + eur(g.price) + '</div>' +
      '<button class="sl-status-btn ' + st + '" data-status="' + esc(g.id) + '">' + STATUS_LABEL[st] + '</button>' +
      '<button class="sl-del" data-del="' + esc(g.id) + '">remove</button></div></div>';
  }
  function render() {
    if (!state.family) return;
    var kids = state.family.kids;
    if (!(state.kid === ALL && kids.length > 1) && !kids.some(function (k) { return k.id === state.kid; })) state.kid = kids[0] && kids[0].id;
    renderTabs();
    renderSummary();
    var kid = state.kid === ALL ? { name: 'the kids' } : (kids.filter(function (k) { return k.id === state.kid; })[0] || { name: '' });
    ['santa', 'family'].forEach(function (src) {
      var items = giftsFor(state.kid, src);
      var total = items.reduce(function (a, g) { return a + (Number(g.price) || 0); }, 0);
      $('#t-' + src).textContent = eur(total) + ' · ' + items.length + (items.length === 1 ? ' gift' : ' gifts');
      $('#l-' + src).innerHTML = items.length ? items.map(giftHtml).join('') :
        '<div class="sl-empty">Nothing here yet ❄️<br>Add the first ' + (src === 'santa' ? 'Santa gift' : 'idea') + ' for ' + esc(kid.name) + '.</div>';
    });
    $('#board-santa').hidden = state.eyes;
    $('.sl-boards').classList.toggle('one', state.eyes);
    $('#eyes-note').hidden = !state.eyes;
    $('#eyes-btn').setAttribute('aria-pressed', String(state.eyes));
  }
  function setSync(kind, text) { var s = $('#sync'); s.className = 'sl-sync ' + (kind || ''); $('#sync-txt').textContent = text; }

  document.addEventListener('click', function (e) {
    var t;
    if ((t = e.target.closest('[data-status]'))) {
      var g = findGift(t.dataset.status); if (!g) return;
      var prev = g.status, next = STATUS_NEXT[g.status] || 'bought';
      g.status = next; render();
      api('POST', { action: 'update', id: g.id, gift: { status: next } }).then(function () {
        toast(STATUS_LABEL[next] + ' · ' + g.name);
      }).catch(function (err) { g.status = prev; render(); toast(errorText(err.code)); });
    } else if ((t = e.target.closest('[data-del]'))) {
      var gd = findGift(t.dataset.del); if (!gd) return;
      if (t.dataset.sure !== '1') { t.dataset.sure = '1'; t.textContent = 'sure?'; setTimeout(function () { t.dataset.sure = ''; t.textContent = 'remove'; }, 2500); return; }
      state.gifts = state.gifts.filter(function (x) { return x !== gd; }); render();
      api('POST', { action: 'delete', id: gd.id }).then(function () { toast('Removed'); })
        .catch(function (err) { state.gifts.push(gd); render(); toast(errorText(err.code)); });
    } else if ((t = e.target.closest('[data-edit]'))) {
      var ge = findGift(t.dataset.edit); if (ge) openGift(ge.from, ge);
    } else if ((t = e.target.closest('[data-add]'))) {
      openGift(t.dataset.add, null);
    } else if ((t = e.target.closest('[data-copy]'))) {
      var inp = $('#' + t.dataset.copy);
      copyText(inp.value).then(function () { toast('Link copied'); track('santa_link_copied', { which: t.dataset.copy }); })
        .catch(function () { inp.select(); toast('Press and hold to copy'); });
    } else if ((t = e.target.closest('[data-claim]'))) {
      openClaim(t.dataset.claim);
    }
  });
  function findGift(id) { return state.gifts.filter(function (g) { return g.id === id; })[0]; }

  $('#eyes-btn').onclick = function () {
    state.eyes = !state.eyes;
    try { localStorage.setItem('sl_eyes', state.eyes ? '1' : '0'); } catch (e) {}
    render();
  };

  // gift modal
  function seg(id, val) { Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' button'), function (b) { b.classList.toggle('on', b.dataset.v === val); }); }
  function openGift(from, g) {
    if (state.eyes && from === 'santa') return;
    editing = g;
    draft = { kids: g ? kidsOfGift(g).slice() : [state.kid === ALL ? state.family.kids[0].id : state.kid], from: g ? g.from : from };
    resetFinder();
    $('#gift-form').reset();
    var kidSeg = $('#g-kid'); kidSeg.innerHTML = '';
    state.family.kids.forEach(function (k) {
      var b = document.createElement('button'); b.type = 'button'; b.dataset.v = k.id; b.textContent = k.emoji + ' ' + k.name; kidSeg.appendChild(b);
    });
    if (g) { $('#g-name').value = g.name; $('#g-price').value = g.price || ''; $('#g-url').value = g.url || ''; $('#g-who').value = g.who || ''; }
    $('#gift-title').textContent = g ? 'Edit gift' : 'New gift';
    $('#g-save').textContent = g ? 'Save changes ✨' : 'Add to list ✨';
    var claimed = $('#g-claimed');
    if (g && g.claimedBy) {
      claimed.hidden = false;
      claimed.innerHTML = '🙋 ' + esc(g.claimedBy) + ' said they\'ll get this. <button type="button" class="sl-linkbtn" id="g-unclaim" style="display:inline">Clear</button>';
      $('#g-unclaim').onclick = function () { draft.unclaim = true; claimed.textContent = 'Claim will be cleared when you save.'; };
    } else claimed.hidden = true;
    segMulti('g-kid', draft.kids); seg('g-from', draft.from);
    $('#g-who-wrap').hidden = draft.from !== 'family';
    // Santa can't be chosen while little eyes is on.
    $('#g-from button[data-v=santa]').disabled = state.eyes;
    openModal('gift-scrim');
    setTimeout(function () { var ae = document.activeElement; if (!ae || !/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) $('#g-name').focus(); }, 50);
  }
  function segMulti(id, vals) { Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' button'), function (b) { b.classList.toggle('on', vals.indexOf(b.dataset.v) !== -1); }); }
  // Tap a child to add or remove them: tick 2 or more for a joint gift.
  $('#g-kid').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var i = draft.kids.indexOf(b.dataset.v);
    if (i === -1) draft.kids.push(b.dataset.v);
    else if (draft.kids.length > 1) draft.kids.splice(i, 1);
    segMulti('g-kid', draft.kids);
  };
  $('#g-from').onclick = function (e) { var b = e.target.closest('button'); if (b && !b.disabled) { draft.from = b.dataset.v; seg('g-from', draft.from); $('#g-who-wrap').hidden = draft.from !== 'family'; } };
  $('#g-cancel').onclick = function () { closeModal('gift-scrim'); };
  $('#gift-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var gift = { kids: draft.kids.slice(), from: draft.from, name: $('#g-name').value.trim(), price: $('#g-price').value, url: $('#g-url').value.trim(), who: draft.from === 'family' ? $('#g-who').value.trim() : '' };
    if (!gift.name) return;
    if (draft.unclaim) gift.claimedBy = '';
    var btn = $('#g-save'); btn.disabled = true;
    var req = editing ? api('POST', { action: 'update', id: editing.id, gift: gift }) : api('POST', { action: 'add', gift: gift });
    var wasEdit = !!editing;
    req.then(function (d) {
      if (wasEdit) state.gifts = state.gifts.map(function (x) { return x.id === d.gift.id ? d.gift : x; });
      else { state.gifts.push(d.gift); track('santa_gift_added', { from: gift.from }); }
      if (state.kid !== ALL && gift.kids.indexOf(state.kid) === -1) state.kid = gift.kids[0];
      closeModal('gift-scrim'); render();
      toast(wasEdit ? 'Saved ✨' : 'Added ✨');
    }).catch(function (err) { toast(errorText(err.code)); })
      .then(function () { btn.disabled = false; });
  });

  // "Find a camp or class": search Sortd's own listings (js/camps-data.js,
  // the same file the camps pages use), loaded only when first needed.
  var LIST = null, listLoading = null;
  function loadListings() {
    if (LIST) return Promise.resolve(LIST);
    if (listLoading) return listLoading;
    listLoading = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = '/js/camps-data.js';
      sc.onload = function () {
        try { LIST = new Function('return typeof LISTINGS !== "undefined" ? LISTINGS : []')() || []; } catch (e) { LIST = []; }
        resolve(LIST);
      };
      sc.onerror = function () { listLoading = null; reject(new Error('load')); };
      document.head.appendChild(sc);
    });
    return listLoading;
  }
  function resetFinder() { $('#g-find').hidden = true; $('#g-find-q').value = ''; $('#g-find-res').innerHTML = ''; $('#g-find-btn').hidden = false; }
  $('#g-find-btn').onclick = function () {
    $('#g-find-btn').hidden = true; $('#g-find').hidden = false; $('#g-find-q').focus();
    $('#g-find-res').innerHTML = '<div class="sl-find-empty">Loading camps and classes…</div>';
    loadListings().then(function () { runFind(); }).catch(function () { $('#g-find-res').innerHTML = '<div class="sl-find-empty">Couldn\'t load camps and classes. Please try again.</div>'; });
  };
  var findT;
  $('#g-find-q').addEventListener('input', function () { clearTimeout(findT); findT = setTimeout(runFind, 150); });
  $('#g-find-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
  function runFind() {
    if (!LIST) return;
    var words = $('#g-find-q').value.toLowerCase().split(/\s+/).filter(Boolean);
    var res = $('#g-find-res');
    if (!words.length) { res.innerHTML = '<div class="sl-find-empty">Type a camp, class, activity or area, like "drama", "Christmas" or "Malahide".</div>'; return; }
    var hits = LIST.filter(function (l) {
      var hay = [l.name, l.provider, l.category, l.area, l.county, l.type === 'weekly' ? 'class weekly' : 'camp'].join(' ').toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    }).slice(0, 8);
    res.innerHTML = hits.length ? hits.map(function (l) {
      return '<button type="button" class="sl-find-hit" data-pick="' + esc(l.id) + '"><b>' + esc(l.name) + '</b><span>' +
        esc([l.provider, l.area, l.costValue ? eur(l.costValue) : ''].filter(Boolean).join(' · ')) + '</span></button>';
    }).join('') : '<div class="sl-find-empty">Nothing matched. Try another word.</div>';
  }
  $('#g-find-res').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]'); if (!b || !LIST) return;
    var l = LIST.filter(function (x) { return x.id === b.dataset.pick; })[0]; if (!l) return;
    $('#g-name').value = (l.name + (l.provider && l.name.indexOf(l.provider) === -1 ? ' (' + l.provider + ')' : '')).slice(0, 150);
    $('#g-price').value = l.costValue ? l.costValue : '';
    $('#g-url').value = l.listingUrl ? location.origin + l.listingUrl : (l.bookingUrl || '');
    resetFinder();
    toast('Added the details. Check the price, then save.');
    track('santa_camp_picked', { category: l.category || '' });
  });

  // share modal
  function giversLink() { return location.origin + '/christmas?share=' + state.family.shareToken; }
  $('#share-btn').onclick = function () {
    $('#share-partner').value = location.origin + '/christmas?join=' + state.family.inviteCode;
    $('#share-givers').value = giversLink();
    openModal('share-scrim');
  };
  $('#share-close').onclick = function () { closeModal('share-scrim'); };
  $('#share-wa').onclick = function () {
    var msg = '🎄 Christmas gift ideas for ' + kidNames(state.family.kids) + ' 🎄\n\n' +
      'Here\'s our list. Before you buy anything, tap "I\'ll get this" on it so nobody doubles up:\n' + giversLink() +
      '\n\nThank you! x';
    copyText(msg).then(function () { toast('Copied, ready to paste into WhatsApp 📲'); track('santa_whatsapp_copied'); })
      .catch(function () { toast('Couldn\'t copy on this device'); });
  };
  // Nudge the family: only the family ideas nobody has claimed yet.
  $('#share-open').onclick = function () {
    var open = state.gifts.filter(function (g) { return g.from === 'family' && !g.claimedBy && g.status === 'idea'; });
    if (!open.length) { toast('Every family idea has been claimed 🎉'); return; }
    var lines = [];
    state.family.kids.forEach(function (k) {
      var mine = open.filter(function (g) { var ks = kidsOfGift(g); return ks.length === 1 && ks[0] === k.id; });
      if (mine.length) lines.push('For ' + k.name + ':\n' + mine.map(function (g) { return '• ' + g.name + (g.price ? ' (' + eur(g.price) + ')' : ''); }).join('\n'));
    });
    var shared = open.filter(function (g) { return kidsOfGift(g).length > 1; });
    if (shared.length) lines.push('For them to share:\n' + shared.map(function (g) { return '• ' + g.name + (g.price ? ' (' + eur(g.price) + ')' : ''); }).join('\n'));
    var msg = '🎄 Still up for grabs for ' + kidNames(state.family.kids) + ' 🎄\n\n' + lines.join('\n\n') +
      '\n\nIf you\'re getting one, tap "I\'ll get this" on it first so nobody doubles up:\n' + giversLink() + '\n\nThank you! x';
    copyText(msg).then(function () { toast('Copied ' + open.length + (open.length === 1 ? ' idea' : ' ideas') + ', ready for WhatsApp 📲'); track('santa_nudge_copied', { open: open.length }); })
      .catch(function () { toast('Couldn\'t copy on this device'); });
  };
  $('#share-reset').onclick = function () {
    var b = $('#share-reset');
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to make a new link. Anyone with the old one loses access.'; return; }
    b.dataset.sure = '';
    api('POST', { action: 'resetShare' }).then(function (d) {
      state.family.shareToken = d.shareToken; $('#share-givers').value = giversLink();
      b.textContent = 'Make a new family link (the old one stops working)';
      toast('New family link made');
    }).catch(function (err) { toast(errorText(err.code)); });
  };

  // kids modal
  $('#kids-btn').onclick = function () {
    $('#kids-family').value = state.family.name || '';
    var c = $('#kids-rows'); c.innerHTML = '';
    state.family.kids.forEach(function (k, i) { kidRow(c, k, i); });
    status($('#kids-status'));
    openModal('kids-scrim');
  };
  $('#kids-add').onclick = function () { var c = $('#kids-rows'); if (c.children.length < 8) kidRow(c, null, c.children.length).focus(); };
  $('#kids-cancel').onclick = function () { closeModal('kids-scrim'); };
  $('#kids-save').onclick = function () {
    var kids = readKidRows($('#kids-rows')), st = $('#kids-status');
    if (!kids.length) { status(st, 'err', errorText('kids_required')); return; }
    var keep = kids.map(function (k) { return k.id; });
    var dropped = state.family.kids.filter(function (k) { return keep.indexOf(k.id) === -1 && state.gifts.some(function (g) { return kidsOfGift(g).indexOf(k.id) !== -1; }); });
    if (dropped.length) { status(st, 'err', 'Remove ' + dropped[0].name + '\'s gifts first, then you can take them off the list.'); return; }
    api('POST', { action: 'kids', kids: kids, familyName: $('#kids-family').value }).then(function (d) {
      state.family.kids = d.kids; state.family.name = $('#kids-family').value || state.family.name;
      closeModal('kids-scrim'); render(); toast('Saved');
    }).catch(function (err) { status(st, 'err', errorText(err.code)); });
  };

  // polling
  function poll() {
    if (polling || document.hidden || !state.pollToken) return;
    if (!$('#gift-scrim').hidden) return; // don't reshuffle under an open form
    polling = true; setSync('busy', 'Checking…');
    api('GET', null, '?poll=' + encodeURIComponent(state.pollToken)).then(function (d) {
      state.gifts = d.gifts || []; render(); setSync('', 'Up to date');
    }).catch(function (err) {
      if (err.status === 401) return load(true);
      setSync('err', 'Offline, retrying');
    }).then(function () { polling = false; });
  }
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(poll, POLL_MS);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  // ── GIVERS ─────────────────────────────────────────────────
  function loadGivers() {
    giversShare = shareParam;
    api('GET', null, '?share=' + encodeURIComponent(shareParam)).then(function (d) {
      giversGifts = d.gifts || [];
      var fam = d.family;
      $('#g-title').textContent = 'Christmas ideas for ' + kidNames(fam.kids);
      document.title = 'Christmas ideas for ' + kidNames(fam.kids) + ' — Sortd Santa List';
      var out = '';
      function giverHtml(g) {
        var url = safeUrl(g.url);
        var meta = (g.taken ? '<span class="sl-tag claimed">' + (g.claimedBy ? '🙋 ' + esc(g.claimedBy) + ' is getting this' : '✅ Already sorted') + '</span>' : '') +
          (g.who ? '<span class="sl-tag who">Idea for ' + esc(g.who) + '</span>' : '') +
          (url ? '<a href="' + esc(url) + '" data-shop="' + esc(g.id) + '" target="_blank" rel="noopener noreferrer nofollow">🔗 ' + esc(host(url)) + '</a>' : '');
        var right = g.taken ? '' : '<button class="sl-btn sl-btn-green sl-btn-sm" data-claim="' + esc(g.id) + '">I\'ll get this</button>';
        return '<div class="sl-gift' + (g.taken ? ' taken' : '') + '"><div><div class="sl-gname" style="cursor:default">' + esc(g.name) + '</div><div class="sl-meta">' + meta + '</div></div>' +
          '<div class="sl-right"><div class="sl-price">' + eur(g.price) + '</div>' + right + '</div></div>';
      }
      function giftKids(g) { return (g.kids && g.kids.length) ? g.kids : [g.kid]; }
      // One section per child, then one per group of children for joint gifts.
      var groups = fam.kids.map(function (k) { return { key: k.id, title: esc(k.emoji) + ' ' + esc(k.name), items: [] }; });
      giversGifts.forEach(function (g) {
        var ks = giftKids(g);
        var key = ks.slice().sort().join(',');
        var grp = groups.filter(function (x) { return x.key === key; })[0];
        if (!grp) {
          var names = fam.kids.filter(function (k) { return ks.indexOf(k.id) !== -1; }).map(function (k) { return k.name; });
          grp = { key: key, title: '🤝 For ' + esc(kidNames(names.map(function (n) { return { name: n }; }))) + ' together', items: [] };
          groups.push(grp);
        }
        grp.items.push(g);
      });
      groups.forEach(function (grp) {
        if (grp.key.indexOf(',') !== -1 && !grp.items.length) return;
        out += '<section class="sl-gkid"><h3>' + grp.title + '</h3>';
        out += grp.items.length ? '<div class="sl-list">' + grp.items.map(giverHtml).join('') + '</div>' : '<div class="sl-empty">No ideas added yet.</div>';
        out += '</section>';
      });
      $('#g-kids').innerHTML = out;
      renderAsk();
      show('v-givers');
      track('santa_givers_view');
    }).catch(function (err) {
      $('#err-title').textContent = err.status === 404 ? 'This link doesn\'t work any more' : 'Hmm, that didn\'t load';
      $('#err-msg').textContent = err.status === 404 ? 'Ask the family to send you their latest Santa List link.' : 'Please refresh and try again.';
      show('v-error');
    });
  }
  // Remember which shop links a giver opened with "Just looking", so we can
  // ask "Did you buy it?" when they come back to the page.
  function openedKey() { return 'sl_opened_' + giversShare; }
  function getOpened() { try { return JSON.parse(localStorage.getItem(openedKey()) || '[]'); } catch (e) { return []; } }
  function setOpened(ids) { try { localStorage.setItem(openedKey(), JSON.stringify(ids.slice(-20))); } catch (e) {} }
  function giverGift(id) { return giversGifts.filter(function (g) { return g.id === id; })[0]; }
  var shopGift = null, claimThenShop = null;

  // 1. Tapping a shop link on an unclaimed gift asks first.
  $('#g-kids').addEventListener('click', function (e) {
    var a = e.target.closest('a[data-shop]'); if (!a) return;
    var g = giverGift(a.dataset.shop);
    if (!g || g.taken) return; // already claimed: just open the shop
    e.preventDefault();
    shopGift = g;
    $('#shop-gift').textContent = g.name;
    openModal('shop-scrim');
  });
  $('#shop-yes').onclick = function () {
    if (!shopGift) return;
    closeModal('shop-scrim');
    claimThenShop = safeUrl(shopGift.url);
    openClaim(shopGift.id);
    track('santa_shop_prompt', { choice: 'yes' });
  };
  $('#shop-look').onclick = function () {
    if (!shopGift) return;
    var url = safeUrl(shopGift.url);
    var ids = getOpened(); if (ids.indexOf(shopGift.id) === -1) ids.push(shopGift.id); setOpened(ids);
    closeModal('shop-scrim');
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    track('santa_shop_prompt', { choice: 'looking' });
  };
  $('#shop-cancel').onclick = function () { closeModal('shop-scrim'); };

  // 2. Back from the shop: "Did you buy it?"
  function renderAsk() {
    var box = $('#g-ask'); if (!box || !giversShare) return;
    var ids = getOpened().filter(function (id) { var g = giverGift(id); return g && !g.taken; });
    setOpened(ids);
    var g = giverGift(ids[ids.length - 1]);
    if (!g) { box.hidden = true; return; }
    box.hidden = false;
    $('#g-ask-name').textContent = g.name;
    $('#g-ask-yes').onclick = function () { claimThenShop = null; openClaim(g.id); };
    $('#g-ask-no').onclick = function () { setOpened(getOpened().filter(function (x) { return x !== g.id; })); renderAsk(); };
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && giversShare) renderAsk(); });

  function openClaim(id) {
    claiming = giversGifts.filter(function (g) { return g.id === id; })[0];
    if (!claiming) return;
    $('#claim-gift').textContent = claiming.name;
    $('#claim-form').hidden = false; $('#claim-done').hidden = true;
    try { $('#claim-name').value = localStorage.getItem('sl_giver') || ''; } catch (e) {}
    status($('#claim-status'));
    openModal('claim-scrim');
    setTimeout(function () { $('#claim-name').focus(); }, 50);
  }
  $('#claim-cancel').onclick = function () { closeModal('claim-scrim'); claimThenShop = null; };
  $('#claim-done-close').onclick = function () { closeModal('claim-scrim'); };
  $('#claim-shop').addEventListener('click', function () { setTimeout(function () { closeModal('claim-scrim'); }, 300); });
  $('#claim-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#claim-name').value.trim(); if (!name || !claiming) return;
    try { localStorage.setItem('sl_giver', name); } catch (e2) {}
    api('POST', { action: 'claim', share: giversShare, id: claiming.id, name: name }).then(function () {
      track('santa_gift_claimed');
      var claimedId = claiming.id;
      setOpened(getOpened().filter(function (x) { return x !== claimedId; }));
      if (claimThenShop) {
        // Claimed from the shop prompt: now send them to the shop.
        $('#claim-form').hidden = true; $('#claim-done').hidden = false;
        $('#claim-shop').href = claimThenShop;
        claimThenShop = null;
      } else {
        closeModal('claim-scrim'); toast('Thank you! It\'s yours 🎁');
      }
      loadGivers();
    }).catch(function (err) {
      status($('#claim-status'), 'err', errorText(err.code));
      if (err.code === 'taken') setTimeout(function () { closeModal('claim-scrim'); loadGivers(); }, 1500);
    });
  });

  // ── boot ───────────────────────────────────────────────────
  function load(quiet) {
    if (!quiet) show('v-loading');
    return api('GET').then(function (d) {
      if (!d.loggedIn) {
        $('#login-join-note').hidden = !joinParam;
        show('v-login');
        return;
      }
      state.email = d.email;
      if (!d.family) { showSetup(); return; }
      if (joinParam) {
        if (joinParam !== d.family.inviteCode) toast('You\'re already on a family list, so we\'ve opened that one.');
        clearJoinParam();
      }
      state.family = d.family; state.gifts = d.gifts || []; state.pollToken = d.pollToken;
      $('#sl-account').hidden = !d.planner;
      show('v-list'); render(); setSync('', 'Up to date'); startPolling();
    }).catch(function () {
      show('v-error');
    });
  }

  if (shareParam && /^[A-Za-z0-9]{16,64}$/.test(shareParam)) loadGivers();
  else load();
})();
