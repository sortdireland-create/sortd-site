// netlify/functions/lib/email-shell.js
// The one branded HTML email layout for every email sortd sends
// (newsletter welcome, login link, listing received / verified / live,
// claim confirmation, Rachel's new-listing notice). Before this, each
// function carried its own copy and they drifted.
//
// Matches the live website (css/site.css), not the older brand-skill hexes:
//   page bg #CFE8F6 · card white · text navy #1E2A44 · links/buttons green #1D8A52
//   tints: purple #E7E1F8 (providers), green #C9F0DA (parents)
//   border #C3DCEC · Baloo 2 headings/wordmark · Nunito body
//
// Rules this layout keeps:
//   - no navy blocks (header and footer are light)
//   - no script/handwritten font anywhere in emails (many clients can't load
//     it and it read as clutter); sign off in plain Nunito
//   - body text is regular weight; bold only where it means something. Mail
//     clients that can't load Nunito fall back to Trebuchet/Verdana, which
//     look very heavy at weight 600, so 600 is never used.
//   - rounded corners, no circles
//   - dark mode: two layers.
//       1. Clients that honour the colour-scheme meta + prefers-color-scheme
//          (Apple Mail, iOS Mail, Outlook.com, Thunderbird) get a proper dark
//          theme from the <style> block below, and swap to a white wordmark.
//       2. Gmail (Android / iOS) ignores that and darkens colours itself. It
//          leaves images alone, so a plain navy transparent PNG vanishes on the
//          darkened header. The wordmark PNG therefore carries a thin white
//          halo, readable on pale and dark backgrounds alike.
//     Every colour in the layout has a dm-* class so dark overrides can win.
//
// Usage:
//   const { emailShell, emailButton, emailBox } = require('./lib/email-shell');
//   emailShell(innerHtml, unsubscribeUrl, { audience: 'provider' | 'parent', eyebrow: 'For providers' })

const NAVY = '#1E2A44';
const ACCENT = '#1B8350'; // site green (--gr #1D8A52) one step darker so white text passes AA (4.8:1): buttons, links, wordmark full stop
const BORDER = '#C3DCEC';
const MUTED = '#5B6783';

const TINTS = {
  provider: { bg: '#E7E1F8', ink: '#5B4FCA' },
  parent: { bg: '#C9F0DA', ink: '#176B42' },
};

// The wordmark is an image, not text: Gmail/Outlook can't load Baloo 2, so live
// text falls back to Trebuchet/Verdana and no longer looks like the logo. The
// PNG is the site's own wordmark (Baloo 2 ExtraBold, navy "sortd" + sky-blue
// full stop, transparent background, drawn at 3x for retina; shown at 90x33).
// Lives at /images/sortd-logo-email.png in the site repo. If the image is
// blocked or missing, the alt text "sortd." shows in the same colour and weight.
const LOGO_URL = 'https://sortd-ireland.ie/images/sortd-logo-email.png'; // navy + thin white halo, 288x117 (3x), shown 96x39
// White wordmark (no halo) for clients that really support dark mode. Shown 90x33.
const LOGO_DARK_URL = 'https://sortd-ireland.ie/images/sortd-logo-email-dark.png';

// Dark theme, same family as the light one: deep navy surfaces, soft light text,
// brand green lifted so links still pass contrast on dark. Buttons keep the
// brand green with white text.
const DARK_CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark;}
.dm-logo-dark{display:none !important;max-height:0 !important;overflow:hidden !important;mso-hide:all;}
@media (prefers-color-scheme: dark){
  body,.dm-page{background:#0E1626 !important;}
  .dm-card{background:#18233A !important;border-color:#2B3A58 !important;}
  .dm-head-provider{background:#2A2552 !important;}
  .dm-head-parent{background:#17392B !important;}
  .dm-eyebrow-provider{color:#C4BCFA !important;}
  .dm-eyebrow-parent{color:#8EDDB2 !important;}
  .dm-body,.dm-body p,.dm-body strong,.dm-box{color:#E9EEF8 !important;}
  .dm-muted,.dm-foot p{color:#A9B4CC !important;}
  .dm-foot{border-color:#2B3A58 !important;}
  .dm-link,.dm-foot a,.dm-body a:not(.dm-btn){color:#6FD0A0 !important;}
  .dm-box-provider{background:#2A2552 !important;}
  .dm-box-parent{background:#17392B !important;}
  .dm-logo-light{display:none !important;max-height:0 !important;overflow:hidden !important;mso-hide:all;}
  .dm-logo-dark{display:block !important;max-height:none !important;overflow:visible !important;}
  [style*="color:#5B6783"]{color:#A9B4CC !important;}
}`;

const BODY_FONT = "'Nunito','Trebuchet MS',Verdana,Arial,sans-serif";
const HEAD_FONT = "'Baloo 2','Trebuchet MS',Verdana,Arial,sans-serif";

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emailShell(innerHtml, unsubscribeUrl, opts) {
  const o = opts || {};
  const audienceKey = TINTS[o.audience] ? o.audience : 'provider';
  const tint = TINTS[audienceKey];
  const eyebrow = o.eyebrow
    ? `<p class="dm-eyebrow-${audienceKey}" style="margin:10px 0 0;font-family:${BODY_FONT};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${tint.ink};">${escapeHtml(o.eyebrow)}</p>`
    : '';
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@400;700&display=swap" rel="stylesheet">
<style>${DARK_CSS}</style></head>
<body style="margin:0;padding:0;background:#CFE8F6;font-family:${BODY_FONT};">
<table role="presentation" class="dm-page" width="100%" cellpadding="0" cellspacing="0" style="background:#CFE8F6;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" class="dm-card" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border:1px solid ${BORDER};border-radius:18px;overflow:hidden;">
<tr><td class="dm-head-${audienceKey}" style="background:${tint.bg};padding:28px 32px 24px;text-align:left;">
<a href="https://sortd-ireland.ie" style="text-decoration:none;"><img class="dm-logo-light" src="${LOGO_URL}" width="96" height="39" alt="sortd." style="display:block;border:0;outline:none;text-decoration:none;font-family:${HEAD_FONT};font-size:30px;font-weight:800;line-height:1;color:${NAVY};"><img class="dm-logo-dark" src="${LOGO_DARK_URL}" width="90" height="33" alt="" style="display:none;border:0;outline:none;text-decoration:none;mso-hide:all;max-height:0;overflow:hidden;"></a>
${eyebrow}
</td></tr>
<tr><td class="dm-body" style="padding:32px;color:${NAVY};font-size:16px;font-family:${BODY_FONT};font-weight:400;line-height:1.65;">
${innerHtml}
</td></tr>
<tr><td class="dm-foot" style="border-top:1px solid ${BORDER};padding:20px 32px 24px;text-align:left;">
<p class="dm-muted" style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};font-family:${BODY_FONT};">sortd · Ireland · <a class="dm-link" href="https://sortd-ireland.ie" style="color:${ACCENT};text-decoration:none;font-weight:700;">sortd-ireland.ie</a></p>
<p class="dm-muted" style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${MUTED};font-family:${BODY_FONT};">Questions? <a class="dm-link" href="mailto:hello@sortd-ireland.ie" style="color:${ACCENT};text-decoration:underline;">hello@sortd-ireland.ie</a> · <a class="dm-link" href="https://sortd-ireland.ie/privacy-policy" style="color:${ACCENT};text-decoration:underline;">Privacy Policy</a></p>
${unsubscribeUrl ? `<p class="dm-muted" style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${MUTED};font-family:${BODY_FONT};"><a class="dm-link" href="${unsubscribeUrl}" style="color:${ACCENT};text-decoration:underline;">Unsubscribe</a> from emails like this</p>` : ''}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Primary CTA: green stadium pill.
function emailButton(text, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:999px;background:${ACCENT};">
<a class="dm-btn" href="${url}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-family:${HEAD_FONT};font-weight:700;text-decoration:none;font-size:16px;border-radius:999px;">${text}</a>
</td></tr></table>`;
}

// Soft tinted summary box (listing details etc.). `html` is trusted markup.
function emailBox(html, audience) {
  const tint = TINTS[audience] || TINTS.provider;
  return `<table role="presentation" class="dm-box-${TINTS[audience] ? audience : 'provider'}" width="100%" cellpadding="0" cellspacing="0" style="background:${tint.bg};border-radius:16px;margin:0 0 20px;"><tr><td class="dm-box" style="padding:16px 20px;font-size:15px;color:${NAVY};line-height:1.8;font-family:${BODY_FONT};">
${html}
</td></tr></table>`;
}

module.exports = { emailShell, emailButton, emailBox, escapeHtml };
