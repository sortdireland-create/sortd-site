// js/saved.js — shared "Save" (heart) behaviour for listing cards.
// Included after search.js on any page whose cards can be saved
// (camps.html, weekly-classes.html, find-an-activity.html, account.html).
//
// Two tiers, matching the brief this was built from (don't force an
// account before browsing):
//   - Not logged in: saves live only in this browser's localStorage.
//     The first-ever save shows a one-time, dismissible nudge toward
//     creating an account — never again after that, logged in or not.
//   - Logged in (sortd_logged_in=1 marker cookie, same one js/account.js
//     reads): saves write through to the parent's Users record via
//     save-listing.js, and the page's heart states load from
//     get-saved.js on page load, so they're correct on any device.
//
// Deliberately NOT handled here: migrating a browser's anonymous saves
// into an account the first time that browser logs in. Today those stay
// separate — an anonymous save doesn't retroactively appear in the
// account once you log in on the same browser. Worth building once this
// proves people actually use Save; flagged rather than silently skipped.

(function () {
  const LOCAL_KEY = 'sortd_saved_local';
  const PROMPT_SHOWN_KEY = 'sortd_save_prompt_shown';

  let savedSet = new Set();
  let loggedIn = false;
  let ready = false;
  const readyCallbacks = [];

  function isLoggedIn() {
    return document.cookie.split('; ').some((c) => c === 'sortd_logged_in=1');
  }

  function readLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocal(arr) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(arr));
    } catch (e) {
      // Private browsing / storage disabled — Save still works for this
      // page view via the in-memory savedSet, it just won't persist.
    }
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
    btn.setAttribute('aria-label', saved ? 'Remove from saved' : 'Save for later');
  }

  function showAccountPrompt() {
    if (localStorage.getItem(PROMPT_SHOWN_KEY)) return;
    try { localStorage.setItem(PROMPT_SHOWN_KEY, '1'); } catch (e) { /* ignore */ }

    const toast = document.createElement('div');
    toast.className = 'save-toast';
    toast.innerHTML =
      '<div class="save-toast-body">' +
      '<div class="save-toast-title">Saved!</div>' +
      '<div class="save-toast-sub">Want to keep your shortlist in one place?</div>' +
      '</div>' +
      '<a href="/login" class="save-toast-cta">Create your free account</a>' +
      '<button class="save-toast-close" aria-label="Dismiss">&#10005;</button>';
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));

    function dismiss() {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 250);
    }
    toast.querySelector('.save-toast-close').addEventListener('click', dismiss);
    setTimeout(dismiss, 8000);
  }

  async function toggle(id, btn) {
    const willSave = !savedSet.has(id);

    // Optimistic UI — flip immediately, reconcile after.
    if (willSave) savedSet.add(id); else savedSet.delete(id);
    setButtonState(btn, willSave);

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

    // Not logged in — local only.
    writeLocal(Array.from(savedSet));
    if (willSave) showAccountPrompt();
  }

  function onReady(cb) {
    if (ready) cb();
    else readyCallbacks.push(cb);
  }

  async function init() {
    loggedIn = isLoggedIn();
    if (loggedIn) {
      try {
        const res = await fetch('/.netlify/functions/get-saved', { credentials: 'include' });
        const data = await res.json();
        savedSet = new Set(data.saved || []);
      } catch (e) {
        console.error('get-saved failed, falling back to empty:', e);
        savedSet = new Set();
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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
