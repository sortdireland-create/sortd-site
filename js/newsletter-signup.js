// Wires up the "Get the newsletter" signup box in the site footer
// (added Sept 2026) to the existing /.netlify/functions/subscribe
// endpoint, which already creates/updates a Customer.io profile and
// sends a "you're on the list" confirmation email — this file only
// adds the missing frontend: nothing on the site previously posted to
// that function.
//
// Progressive enhancement: the form still has a real <input type=email>
// and a real <button type=submit>, this just intercepts submit so the
// page never navigates away, and shows an inline success/error message.
(function () {
  function initFootNlForm(form) {
    var wrap = form.closest('.foot-nl');
    var msgEl = wrap ? wrap.querySelector('.foot-nl-msg') : null;
    var btn = form.querySelector('.foot-nl-btn');
    var input = form.querySelector('.foot-nl-input');
    if (!btn || !input) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (input.value || '').trim();
      if (!email) return;

      if (msgEl) {
        msgEl.textContent = '';
        msgEl.className = 'foot-nl-msg';
      }
      btn.disabled = true;
      var originalLabel = btn.textContent;
      btn.textContent = 'Joining…';

      fetch('/.netlify/functions/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('subscribe failed');
          return res.json().catch(function () { return {}; });
        })
        .then(function () {
          if (msgEl) {
            msgEl.textContent = "You're on the list! Check your inbox to confirm.";
            msgEl.className = 'foot-nl-msg ok';
          }
          form.reset();
        })
        .catch(function () {
          if (msgEl) {
            msgEl.textContent = 'Something went wrong — please try again.';
            msgEl.className = 'foot-nl-msg err';
          }
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = originalLabel;
        });
    });
  }

  document.querySelectorAll('.foot-nl-form').forEach(initFootNlForm);
})();
