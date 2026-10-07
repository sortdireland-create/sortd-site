// Wires up the "Thursday email" sign-up forms to /.netlify/functions/subscribe,
// which adds the person to the Brevo newsletter list and sends a welcome email.
//
// Two kinds of form, one script (so the generated listing pages pick it up too):
//   .foot-nl-form  the box in the site footer, on every page
//   .nl-form       the bigger box on the About page
//   .popup-form    the pop-up (nav "Get the newsletter" button, and after scrolling half a page)
//
// Each form gets a required, unticked consent checkbox injected under the
// email field. The exact label text is sent with the sign-up and saved in
// Brevo as the consent record, along with the page and a timestamp.
//
// GA4 events (via the gtag set up in booking-tracking.js), all carrying
// signup_location = footer | about_page | popup | newsletter_page. No email address is ever sent to GA4.
//   newsletter_form_start   first time someone interacts with a form on the page
//   newsletter_signup       new subscriber saved (mark this one as a key event in GA4)
//   newsletter_signup_existing  email was already on the list (not counted as a sign-up)
//   newsletter_signup_error sign-up failed
(function () {
  var CONSENT_LABEL_TEXT = 'Yes, send me the weekly "what\'s on near you" email every Thursday.';

  // Someone who has already signed up shouldn't get the scroll pop-up again.
  // The pages' own scroll code skips the pop-up once sessionStorage has igShown,
  // so re-set it here for returning subscribers.
  try {
    if (window.localStorage.getItem('sortdNewsletterDone')) window.sessionStorage.setItem('igShown', '1');
  } catch (e) { /* storage can be blocked; the pop-up just shows as normal */ }

  function track(name, location) {
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', name, { signup_location: location });
      }
    } catch (e) { /* analytics must never break the form */ }
  }

  // The footer headline is static HTML in every page; say "Thursday" in one
  // place instead of editing hundreds of files.
  // Same for the rest of the footer box copy and the button label.
  document.querySelectorAll('.foot-nl-title').forEach(function (el) {
    el.textContent = el.textContent.replace(/every week/i, 'every Thursday');
    if (el.parentElement) el.parentElement.classList.add('foot-nl-copy');
  });
  document.querySelectorAll('.foot-nl-sub').forEach(function (el) {
    el.textContent = 'One short email: new camps, open spots and honest updates. Free, and you can unsubscribe in one click.';
  });
  document.querySelectorAll('.foot-nl-btn').forEach(function (el) {
    el.textContent = 'Get the Thursday email';
  });

  function initForm(form, cfg) {
    var wrap = form.closest(cfg.wrapSelector);
    var msgEl = wrap ? wrap.querySelector(cfg.msgSelector) : null;
    var btn = form.querySelector(cfg.btnSelector);
    var input = form.querySelector('input[type="email"]');
    if (!btn || !input) return;

    var location = form.getAttribute('data-source') || cfg.source;

    // Explicit, unticked consent checkbox. Added here (rather than copied
    // into every page) so all pages share one source of truth. It's
    // `required`, so the browser blocks the submit until it's ticked.
    var consentLabel = form.querySelector('.' + cfg.consentClass);
    if (!consentLabel) {
      consentLabel = document.createElement('label');
      consentLabel.className = cfg.consentClass;
      consentLabel.innerHTML =
        '<input type="checkbox" name="newsletterConsent" required>' +
        '<span>' + CONSENT_LABEL_TEXT +
        ' See our <a href="/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>.</span>';
      if (cfg.consentBeforeBtn) form.insertBefore(consentLabel, btn);
      else form.appendChild(consentLabel);
    }
    var consentBox = consentLabel.querySelector('input[type="checkbox"]');

    var started = false;
    function onStart() {
      if (started) return;
      started = true;
      track('newsletter_form_start', location);
    }
    input.addEventListener('focus', onStart);

    function setMsg(text, kind) {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.className = cfg.msgClass + (kind ? ' ' + kind : '');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (input.value || '').trim();
      if (!email) return;
      if (!consentBox.checked) { consentBox.focus(); return; }

      setMsg('', '');
      btn.disabled = true;
      var originalLabel = btn.textContent;
      btn.textContent = 'Joining…';

      var consentText = (consentLabel.textContent || '').replace(/\s+/g, ' ').trim();

      fetch('/.netlify/functions/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          consent: true,
          consentText: consentText,
          source: location,
          pageUrl: window.location.href.split('#')[0],
        }),
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            if (!res.ok) {
              var err = new Error('subscribe failed');
              err.userMessage = res.status === 400 && body && body.error ? body.error : '';
              throw err;
            }
            return body;
          });
        })
        .then(function (body) {
          setMsg(body && body.isNew === false
            ? "You're already on the list. See you Thursday."
            : "You're on the list. A welcome email is on its way.", 'ok');
          // Only count genuinely new people, so re-submits don't inflate the number.
          track(body && body.isNew === false ? 'newsletter_signup_existing' : 'newsletter_signup', location);
          try {
            window.localStorage.setItem('sortdNewsletterDone', '1');
            window.sessionStorage.setItem('igShown', '1');
          } catch (e) { /* ignore */ }
          form.reset();
          started = false;
        })
        .catch(function (err) {
          setMsg((err && err.userMessage) || 'Something went wrong. Please try again.', 'err');
          track('newsletter_signup_error', location);
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = originalLabel;
        });
    });
  }

  document.querySelectorAll('.foot-nl-form').forEach(function (form) {
    initForm(form, {
      wrapSelector: '.foot-nl',
      msgSelector: '.foot-nl-msg',
      msgClass: 'foot-nl-msg',
      btnSelector: '.foot-nl-btn',
      consentClass: 'foot-nl-consent',
      source: 'footer',
    });
  });

  document.querySelectorAll('.popup-form').forEach(function (form) {
    initForm(form, {
      wrapSelector: '.popup',
      msgSelector: '.popup-msg',
      msgClass: 'popup-msg',
      btnSelector: '.popup-btn',
      consentClass: 'popup-consent',
      consentBeforeBtn: true,
      source: 'popup',
    });
  });

  document.querySelectorAll('.nl-form').forEach(function (form) {
    initForm(form, {
      wrapSelector: '.nl-inner',
      msgSelector: '.nl-msg',
      msgClass: 'nl-msg',
      btnSelector: '.nl-btn',
      consentClass: 'nl-consent',
      source: 'about_page',
    });
  });
})();
