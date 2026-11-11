// js/saved.js — shared "Save" (heart) behaviour for listing cards.
// Included on any page whose cards can be saved (camps.html,
// weekly-classes.html, find-an-activity.html, index.html, account.html and
// the generated class pages).
//
// Free vs email (Nov 2026): searching camps, classes and What's on is free
// with no email. Saving favourites is behind the email wall:
//   - No email yet: tapping a heart opens a small sheet asking for an
//     email. Submitting it calls request-login (same magic link as /login
//     and the /account unlock), marks this browser as unlocked
//     (localStorage sortd_unlocked, the same flag account.html sets) and
//     saves the listing straight away, so there's no waiting on the email.
//   - Unlocked on this browser, link not clicked yet: saves live in this
//     browser's localStorage.
//   - Logged in (sortd_logged_in=1 marker cookie): saves write through to
//     the parent's Users record via save-listing.js. On the first page load
//     after logging in, any saves kept in this browser are merged into the
//     account (action 'merge') and the local copy is cleared.
// Removing a save is never gated, so hearts saved before this change can
// still be un-hearted.

(function () {
  const LOCAL_KEY = 'sortd_saved_local';
  const UNLOCK_KEY = 'sortd_unlocked';

  let savedSet = new Set();
  let loggedIn = false;
  let ready = false;
  const readyCallbacks = [];

  function isLoggedIn() {
    return document.cookie.split('; ').some((c) => c === 'sortd_logged_in=1');
  }

  function isUnlocked() {
    try { return !!localStorage.getItem(UNLOCK_KEY); } catch (e) { return false; }
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocal(arr) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
    } catch (e) {
      // Private browsing / storage disabled: Save still works for this
      // page view via the in-memory savedSet, it just won't persist.
    }
  }

  function track(name, params) {
    try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) { /* ignore */ }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function paintAll() {
    document.querySelectorAll('[data-save-id]').forEach((btn) => {
      const id = btn.getAttribute('data-save-id');
      setButtonState(btn, savedSet.has(id));
    });
  }

  function setButtonState(btn, saved) {
    btn.classList.toggle('saved', saved);
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
    btn.setAttribute('aria-label', saved ? 'Remove from favourites' : 'Save to favourites');
  }

  // ---- Email sheet (shown to visitors who haven't given an email) ----
  let sheetEl = null;
  let pending = null; // { id, btn } waiting on the email

  function closeSheet() {
    if (!sheetEl) return;
    sheetEl.classList.remove('show');
    document.body.style.overflow = '';
    const el = sheetEl;
    sheetEl = null;
    pending = null;
    setTimeout(() => el.remove(), 200);
  }

  function openSheet(id, btn) {
    if (sheetEl) closeSheet();
    pending = { id, btn };
    const wrap = document.createElement('div');
    wrap.className = 'sv-layer';
    wrap.innerHTML =
      '<div class="sv-sheet" role="dialog" aria-modal="true" aria-labelledby="sv-title">' +
        '<button type="button" class="sv-x" aria-label="Close">&#10005;</button>' +
        '<div class="sv-ico" aria-hidden="true"><i class="ti ti-heart"></i></div>' +
        '<h3 id="sv-title">Save your favourites</h3>' +
        '<p class="sv-sub">Searching is free for everyone. Add your email to keep a list of favourite camps and classes, and get the family calendar as it opens. No password: we\'ll email you a link to log in.</p>' +
        '<form class="sv-form" novalidate>' +
          '<input type="email" name="email" autocomplete="email" required placeholder="you@example.ie" aria-label="Your email">' +
          '<button type="submit" class="sv-btn">Save to favourites</button>' +
          '<label class="sv-opt" style="display:flex;gap:8px;align-items:flex-start;margin:10px 0 0;font-size:13px;line-height:1.45;text-align:left;font-weight:600;"><input type="checkbox" name="newsletterOptIn" style="margin-top:2px;flex:0 0 auto;width:16px;height:16px;"> <span>Also send me the weekly "what\'s on near you" email every Thursday: new camps, open spots and honest updates. See our <a href="/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>' +
        '</form>' +
        '<p class="sv-msg" role="status" aria-live="polite"></p>' +
        '<p class="sv-fine">Already have an account? Same thing: enter your email and we\'ll send a login link. We\'ll use your email to set up your free sortd account. <a href="/privacy-policy" target="_blank" rel="noopener">Privacy policy</a>.</p>' +
      '</div>';
    document.body.appendChild(wrap);
    sheetEl = wrap;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => wrap.classList.add('show'));
    const input = wrap.querySelector('input');
    setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 60);

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('.sv-x') || e.target.closest('[data-sv-close]')) closeSheet();
    });
    wrap.querySelector('form').addEventListener('submit', submitEmail);
    track('save_locked_click', { listing_id: id });
  }

  function submitEmail(e) {
    e.preventDefault();
    const form = e.target;
    const input = form.querySelector('input');
    const btn = form.querySelector('button');
    const msg = sheetEl && sheetEl.querySelector('.sv-msg');
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (msg) { msg.className = 'sv-msg err'; msg.textContent = 'Please enter a valid email address.'; }
      input.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    fetch('/.netlify/functions/request-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: 'save', newsletterOptIn: !!(sheetEl && sheetEl.querySelector('input[name="newsletterOptIn"]:checked')) }),
    })
      .then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.error || 'error'); return d; }))
      .then(() => {
        try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (err) { /* ignore */ }
        document.documentElement.classList.add('is-unlocked');
        const p = pending;
        if (p) {
          savedSet.add(p.id);
          writeLocal(Array.from(savedSet));
          paintAll();
        }
        track('save_unlock_submit');
        if (p) track('save_listing', { listing_id: p.id, logged_in: 'no', via: 'email_wall' });
        if (!sheetEl) return;
        sheetEl.querySelector('.sv-sheet').innerHTML =
          '<button type="button" class="sv-x" aria-label="Close">&#10005;</button>' +
          '<div class="sv-ico sv-ico--ok" aria-hidden="true"><i class="ti ti-circle-check"></i></div>' +
          '<h3 id="sv-title">Saved. Favourites unlocked.</h3>' +
          '<p class="sv-sub">Keep tapping the heart on anything you like. We\'ve sent a login link to <b>' + esc(email) + '</b>: tap it to keep your favourites on any phone or computer.</p>' +
          '<div class="sv-acts"><button type="button" class="sv-btn" data-sv-close>Keep browsing</button><a class="sv-link" href="/account#saved">See my favourites</a></div>';
      })
      .catch((err) => {
        btn.disabled = false;
        btn.textContent = 'Save to favourites';
        if (msg) {
          msg.className = 'sv-msg err';
          msg.textContent = (err && err.message && err.message !== 'error') ? err.message : 'Something went wrong. Please try again.';
        }
      });
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetEl) closeSheet(); });

  // ---- Toggle ----
  async function toggle(id, btn) {
    const willSave = !savedSet.has(id);

    // The email wall: only adding a favourite is gated, never removing one.
    if (willSave && !loggedIn && !isUnlocked()) {
      openSheet(id, btn);
      return;
    }

    // Optimistic UI: flip immediately, reconcile after.
    if (willSave) savedSet.add(id); else savedSet.delete(id);
    setButtonState(btn, willSave);
    track(willSave ? 'save_listing' : 'unsave_listing', { listing_id: id, logged_in: loggedIn ? 'yes' : 'no' });

    if (loggedIn) {
      try {
        const res = await fetch('/.netlify/functions/save-listing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ listingId: id, action: willSave ? 'save' : 'unsave' }),
        });
        if (!res.ok) throw new Error('save-listing failed: ' + res.status);
        const data = await res.json();
        savedSet = new Set(data.saved || []);
        paintAll();
      } catch (e) {
        console.error('Save failed, reverting:', e);
        if (willSave) savedSet.delete(id); else savedSet.add(id);
        setButtonState(btn, !willSave);
      }
      return;
    }

    // Unlocked on this browser but not logged in yet: local only.
    writeLocal(Array.from(savedSet));
  }

  function onReady(cb) {
    if (ready) cb();
    else readyCallbacks.push(cb);
  }

  async function init() {
    loggedIn = isLoggedIn();
    if (loggedIn) {
      const local = readLocal();
      try {
        let data;
        if (local.length) {
          // First visit after logging in on this browser: bring the
          // favourites saved here into the account, then drop the local copy.
          const res = await fetch('/.netlify/functions/save-listing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ action: 'merge', listingIds: local }),
          });
          if (!res.ok) throw new Error('merge failed: ' + res.status);
          data = await res.json();
          writeLocal([]);
          track('saved_merged', { count: local.length });
        } else {
          const res = await fetch('/.netlify/functions/get-saved', { credentials: 'include' });
          data = await res.json();
        }
        savedSet = new Set(data.saved || []);
      } catch (e) {
        console.error('Loading saved failed:', e);
        // Merge failed: show the local ones so nothing looks lost; they
        // stay in localStorage and the merge is retried on the next page.
        savedSet = new Set(local);
      }
    } else {
      savedSet = new Set(readLocal());
    }
    ready = true;
    paintAll();
    readyCallbacks.forEach((cb) => cb());
    readyCallbacks.length = 0;
  }

  window.SortdSaved = {
    toggle,
    isSaved: (id) => savedSet.has(id),
    savedIds: () => Array.from(savedSet),
    paintAll,
    onReady,
    isLoggedIn: () => loggedIn,
    isUnlocked: () => loggedIn || isUnlocked(),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
