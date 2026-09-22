/*
 * Sortd — booking click tracking (GA4)
 * ------------------------------------------------------------------
 * Drop-in, site-wide. Include once per page, anywhere, with defer:
 *   <script src="/js/booking-tracking.js" defer></script>
 *
 * Sends these GA4 events:
 *   booking_click          parent clicked through to a provider's booking page
 *   provider_social_click  parent clicked a provider's Instagram / Facebook / TikTok
 *   provider_contact_click parent clicked a provider's email or phone link
 *
 * Every event carries: listing_id (Airtable record ID), listing_name,
 * provider_name, listing_type (camp|class), click_location, link_url, link_domain.
 *
 * Listing context comes from (in order):
 *   1. data-listing-* attributes on the nearest ancestor, or on <body>
 *   2. the LISTINGS array from /js/camps-data.js (search/home cards)
 *   3. the page URL (/camps/{county}/{slug}) + <h1> as a last resort
 *
 * If a page has no GA4 tag, this script loads it (G-HHTB7S9WJG), so
 * listing pages generated without the tag still get page views + clicks.
 */
(function () {
  'use strict';

  var GA_ID = 'G-HHTB7S9WJG';

  // Sortd's own properties — clicks to these are never provider clicks.
  var OWN_HOSTS = /(^|\.)sortd(-ireland)?\.ie$/i;
  var OWN_SOCIAL = /instagram\.com\/sortd\.ireland|facebook\.com\/sortd|tiktok\.com\/@sortd/i;
  var SOCIAL_HOSTS = /(^|\.)(instagram\.com|facebook\.com|fb\.com|tiktok\.com)$/i;

  // ---- GA4 bootstrap -------------------------------------------------
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function () { window.dataLayer.push(arguments); };
  }
  var hasGaTag = !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]');
  if (!hasGaTag) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  }

  // ---- Helpers ---------------------------------------------------------
  function normUrl(u) {
    try {
      var x = new URL(u, location.href);
      return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase();
    } catch (e) { return ''; }
  }

  function getListings() {
    try {
      // camps-data.js declares `const LISTINGS` at top level: reachable by name, not via window.
      /* global LISTINGS */
      return (typeof LISTINGS !== 'undefined' && Array.isArray(LISTINGS)) ? LISTINGS : [];
    } catch (e) { return []; }
  }

  function fromListingObj(l, via) {
    return {
      listing_id: l.id || '',
      listing_name: l.name || '',
      provider_name: l.provider || '',
      listing_type: l.type === 'weekly' ? 'class' : (l.type || ''),
      _via: via
    };
  }

  function fromAttrs(el) {
    if (!el || !el.getAttribute) return null;
    var id = el.getAttribute('data-listing-id');
    var name = el.getAttribute('data-listing-name');
    if (!id && !name) return null;
    return {
      listing_id: id || '',
      listing_name: name || '',
      provider_name: el.getAttribute('data-provider') || '',
      listing_type: el.getAttribute('data-listing-type') || ''
    };
  }

  function pageType() {
    var m = location.pathname.match(/^\/(camps|classes)\/[^/]+\/[^/]+/) ||
            location.pathname.match(/^\/[^/]+\/(camps|classes)\/[^/]+/); // old scheme
    return m ? (m[1] === 'classes' ? 'class' : 'camp') : '';
  }

  function listingContext(link) {
    // 1. Explicit attributes on the card/section, then on <body>
    var holder = link.closest('[data-listing-id],[data-listing-name]');
    var ctx = fromAttrs(holder) || fromAttrs(document.body);
    if (ctx) return ctx;

    var listings = getListings();
    var type = pageType();

    // 2a. On a listing page: match this page's URL against listingUrl
    if (type && listings.length) {
      var here = normUrl(location.href);
      for (var i = 0; i < listings.length; i++) {
        if (listings[i].listingUrl && normUrl(listings[i].listingUrl) === here) {
          return fromListingObj(listings[i]);
        }
      }
    }
    // 2b. Anywhere: match the clicked link against a bookingUrl
    if (listings.length) {
      var target = normUrl(link.href);
      for (var j = 0; j < listings.length; j++) {
        if (listings[j].bookingUrl && normUrl(listings[j].bookingUrl) === target) {
          return fromListingObj(listings[j]);
        }
      }
    }
    // 3. Last resort: URL slug + page heading
    var h1 = document.querySelector('h1');
    var slug = type ? location.pathname.split('/').filter(Boolean).pop() : '';
    return {
      listing_id: slug,
      listing_name: h1 ? h1.textContent.trim().slice(0, 100) : '',
      provider_name: '',
      listing_type: type
    };
  }

  function clickLocation(link) {
    if (link.closest('nav, header, footer')) return 'site_chrome';
    if (pageType()) {
      if (link.classList.contains('bb')) return 'listing_book_button';
      return 'listing_page';
    }
    return 'listing_card'; // homepage / search / hub pages
  }

  function isBookingLink(link, url) {
    if (link.matches('.bb, [data-track="booking"]')) return true;
    // Outbound link inside a tagged listing card
    if (link.closest('[data-listing-id]')) return true;
    // Same destination as this page's main Book button (e.g. "How to book" row)
    var bb = document.querySelector('a.bb[href]');
    if (bb && normUrl(bb.href) === normUrl(url.href)) return true;
    // Card link that matches a known listing bookingUrl
    var listings = getListings();
    var t = normUrl(url.href);
    for (var i = 0; i < listings.length; i++) {
      if (listings[i].bookingUrl && normUrl(listings[i].bookingUrl) === t) return true;
    }
    // Any other outbound link on a listing page, outside the nav/footer
    return !!pageType();
  }

  function classify(link) {
    var href = link.getAttribute('href') || '';
    if (/^mailto:/i.test(href)) return { event: 'provider_contact_click', method: 'email' };
    if (/^tel:/i.test(href)) return { event: 'provider_contact_click', method: 'phone' };

    var url;
    try { url = new URL(link.href, location.href); } catch (e) { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    if (url.hostname === location.hostname || OWN_HOSTS.test(url.hostname)) return null;
    if (OWN_SOCIAL.test(url.href)) return null;

    if (SOCIAL_HOSTS.test(url.hostname)) {
      return { event: 'provider_social_click', method: url.hostname.replace(/^www\./, '').split('.')[0], url: url };
    }
    if (isBookingLink(link, url)) return { event: 'booking_click', method: 'web', url: url };
    return null; // other outbound links: GA4 enhanced measurement still logs them as "click"
  }

  // ---- Listener --------------------------------------------------------
  var lastFired = { el: null, t: 0 };

  function handle(e) {
    if (e.type === 'auxclick' && e.button !== 1) return; // middle-click only
    var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!link) return;
    if (link.closest('nav, header, footer') && !link.matches('[data-track]')) return;

    var c = classify(link);
    if (!c) return;

    var now = Date.now();
    if (lastFired.el === link && now - lastFired.t < 800) return; // de-dupe
    lastFired = { el: link, t: now };

    var ctx = listingContext(link);
    window.gtag('event', c.event, {
      listing_id: ctx.listing_id,
      listing_name: ctx.listing_name,
      provider_name: ctx.provider_name,
      listing_type: ctx.listing_type,
      click_location: clickLocation(link),
      contact_method: c.method,
      link_url: c.url ? c.url.href.slice(0, 100) : link.getAttribute('href').replace(/^(mailto|tel):.*/i, '$1'),
      link_domain: c.url ? c.url.hostname.replace(/^www\./, '') : '',
      transport_type: 'beacon'
    });
  }

  document.addEventListener('click', handle, true);
  document.addEventListener('auxclick', handle, true);
})();
