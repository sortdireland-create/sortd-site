// js/account.js — swaps the nav's "Log in" link to "My account" when the
// visitor is logged in.
//
// The real session (sortd_session) is an HttpOnly cookie on purpose — no
// JS, including this file, can read it, which is what keeps it safe from
// XSS cookie theft. Login/logout also set a second, non-HttpOnly
// "sortd_logged_in=1" marker cookie that carries no auth power of its own
// (it's just the string "1") — this file only reads THAT one, purely to
// decide what the nav link should say. Every page/function that actually
// needs to know who's logged in checks the HttpOnly cookie server-side
// (see netlify/functions/lib/session.js), never this flag.
(function () {
  function isLoggedIn() {
    return document.cookie.split('; ').some(function (c) { return c === 'sortd_logged_in=1'; });
  }
  function apply() {
    var link = document.getElementById('nav-account-link');
    if (!link) return;
    if (isLoggedIn()) {
      link.textContent = 'My account';
      link.href = '/account';
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
})();
