/*
 * Sortd — mobile burger menu
 * ------------------------------------------------------------------
 * Site-wide, self-contained. Loaded automatically by /js/booking-tracking.js
 * (which is on every page), or include directly:
 *   <script src="/js/mobile-nav.js" defer></script>
 *
 * Works with both nav variants on the site:
 *   1. <nav> … <div class="navlinks"> …          (site.css pages)
 *   2. <nav class="nav"><div class="nav-inner"> … <div class="nav-links"> …  (listing pages)
 *
 * The burger shows whenever the page's own CSS hides the links container,
 * so it follows each page's breakpoint (900px / 768px) without hard-coding it.
 * The panel re-clones the nav links each time it opens, so changes made by
 * other scripts (e.g. account.js swapping "Log in" → "My account") carry over.
 */
(function () {
  if (window.__sortdMobileNav) return;
  window.__sortdMobileNav = true;

  var CSS = [
    '.smn-btn{display:none;align-items:center;justify-content:center;width:44px;height:44px;margin-left:4px;',
    '  border:1.5px solid var(--bd,#C3DCEC);border-radius:12px;background:#fff;color:var(--nv,#1E2A44);cursor:pointer;',
    '  padding:0;flex-shrink:0;-webkit-tap-highlight-color:transparent;}',
    '.smn-btn:focus-visible{outline:2px solid var(--sk,#3D77A3);outline-offset:2px;}',
    '.smn-btn svg{width:22px;height:22px;display:block;}',
    '.smn-btn .smn-x{display:none;}',
    '.smn-open .smn-btn .smn-x{display:block;}',
    '.smn-open .smn-btn .smn-bars{display:none;}',
    '.smn-collapsed .smn-btn{display:inline-flex;}',
    '.smn-collapsed .smn-ig{display:none !important;}',
    '.smn-nav{position:sticky;}',
    '.smn-panel{display:none;position:absolute;left:0;right:0;top:100%;background:#fff;',
    '  border-bottom:1px solid var(--bd,#C3DCEC);box-shadow:0 14px 28px rgba(30,42,68,.12);',
    '  padding:8px 20px 20px;max-height:calc(100vh - 70px);overflow-y:auto;z-index:1000;}',
    '.smn-open.smn-collapsed .smn-panel{display:block;}',
    '.smn-panel a{display:flex;align-items:center;gap:10px;font-family:"Nunito",sans-serif;font-weight:700;',
    '  font-size:17px;color:var(--nv,#1E2A44);text-decoration:none;padding:14px 4px;opacity:1;',
    '  border:none;border-bottom:1px solid #EEF3F7;text-transform:none;}',
    '.smn-panel a:last-child{border-bottom:none;}',
    '.smn-panel a:active,.smn-panel a:hover{color:var(--sk,#3D77A3);}',
    '.smn-panel a.smn-cta{justify-content:center;margin-top:12px;background:var(--sk,#3D77A3);color:#fff;',
    '  border-radius:999px;padding:13px 20px;border:none;}',
    '.smn-panel a .ti{font-size:20px;}',
    /* variant 1 (site.css <nav>): tighten the bar on phones so logo + CTA + burger fit */
    '@media (max-width:600px){',
    '  nav.smn-v1{padding:12px 20px;}',
    '  nav.smn-v1 .nav-cta{padding:9px 14px;font-size:13px;white-space:nowrap;}',
    '}',
    '@media (max-width:360px){ nav.smn-v1 .nav-cta{display:none;} }'
  ].join('\n');

  var BARS = '<svg class="smn-bars" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var X = '<svg class="smn-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function init() {
    var links = document.querySelector('nav .navlinks, nav .nav-links');
    if (!links) return;
    var nav = links.closest('nav');
    if (!nav || nav.querySelector('.smn-btn')) return;

    var v1 = links.classList.contains('navlinks');
    nav.classList.add('smn-nav', v1 ? 'smn-v1' : 'smn-v2');

    var style = document.createElement('style');
    style.id = 'smn-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    // Instagram icon outside the links: hide it on mobile, show it in the panel instead
    var ig = null;
    Array.prototype.forEach.call(nav.querySelectorAll('a[href*="instagram.com"]'), function (a) {
      if (!links.contains(a)) { a.classList.add('smn-ig'); ig = ig || a; }
    });

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'smn-btn';
    btn.setAttribute('aria-label', 'Open menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'smn-panel');
    btn.innerHTML = BARS + X;

    var panel = document.createElement('div');
    panel.className = 'smn-panel';
    panel.id = 'smn-panel';

    // Where the burger goes: right-hand group (v1) or end of .nav-inner (v2)
    var host = v1 ? (nav.lastElementChild !== links ? nav.lastElementChild : nav) : (links.parentElement || nav);
    host.appendChild(btn);
    nav.appendChild(panel);

    function build() {
      panel.innerHTML = '';
      Array.prototype.forEach.call(links.querySelectorAll('a[href]'), function (a) {
        var c = a.cloneNode(true);
        c.removeAttribute('id');
        c.removeAttribute('class');
        panel.appendChild(c);
      });
      // Extra items outside the links container (e.g. Log in): mark with data-smn-item
      Array.prototype.forEach.call(nav.querySelectorAll('a[data-smn-item]'), function (a) {
        if (links.contains(a)) return;
        var c = a.cloneNode(true); c.removeAttribute('id'); c.removeAttribute('class'); panel.appendChild(c);
      });
      if (ig) {
        var i = document.createElement('a');
        i.href = ig.href; i.target = '_blank'; i.rel = 'noopener';
        i.innerHTML = '<i class="ti ti-brand-instagram"></i> Instagram';
        panel.appendChild(i);
      }
      // Full-width button at the bottom of the panel: mark with data-smn-cta
      var cta = nav.querySelector('a[data-smn-cta]');
      if (cta) {
        var b = document.createElement('a');
        b.href = cta.href; b.className = 'smn-cta'; b.textContent = cta.textContent;
        panel.appendChild(b);
      }
    }

    function setOpen(open) {
      if (open) build();
      nav.classList.toggle('smn-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!nav.classList.contains('smn-open'));
    });
    panel.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('click', function (e) {
      if (nav.classList.contains('smn-open') && !nav.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('smn-open')) { setOpen(false); btn.focus(); }
    });

    function sync() {
      var collapsed = getComputedStyle(links).display === 'none';
      nav.classList.toggle('smn-collapsed', collapsed);
      if (!collapsed && nav.classList.contains('smn-open')) setOpen(false);
    }
    sync();
    window.addEventListener('resize', sync);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
