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
//   - the header is a solid navy banner (#27314A) with the white wordmark,
//     identical in light and dark mode
//   - no script/handwritten font anywhere in emails (many clients can't load
//     it and it read as clutter); sign off in plain Nunito
//   - body text is regular weight; bold only where it means something. Mail
//     clients that can't load Nunito fall back to Trebuchet/Verdana, which
//     look very heavy at weight 600, so 600 is never used.
//   - rounded corners, no circles
//   - dark mode: built to survive it rather than to be switched.
//       Gmail (Android / iOS) ignores colour-scheme CSS and darkens light
//       colours itself, but never touches images and leaves already-dark
//       colours alone. So the header is a saturated mid-dark banner with the
//       white wordmark on it (reads the same in light and dark, in every
//       client), while page, card and footer are neutral and invert cleanly to
//       charcoal. Clients that honour prefers-color-scheme (Apple Mail,
//       Outlook.com) get a deliberate navy theme from the <style> block.
//       Every colour has a dm-* class.
//
// Usage:
//   const { emailShell, emailButton, emailBox } = require('./lib/email-shell');
//   emailShell(innerHtml, unsubscribeUrl, { audience: 'provider' | 'parent', eyebrow: 'For providers' })

const NAVY = '#1E2A44';
const ACCENT = '#1B8350'; // site green (--gr #1D8A52) one step darker so white text passes AA (4.8:1): buttons, links, wordmark full stop
const BORDER = '#DCE5EE';
const MUTED = '#5B6783';

const BANNER = '#27314A'; // brand navy: header banner behind the white wordmark, same for parents and providers

const TINTS = {
  provider: { bg: '#E7E1F8', ink: '#5B4FCA', banner: BANNER },
  parent: { bg: '#C9F0DA', ink: '#176B42', banner: BANNER },
};

// The wordmark is an image, not text: Gmail/Outlook can't load Baloo 2, so live
// text falls back to Trebuchet/Verdana and no longer looks like the logo. This
// is the white version (transparent background, white "sortd" + light-blue full
// stop, drawn at 3x for retina = 270x99, shown 108x40) for the coloured banner.
// Lives at /images/sortd-logo-email-white.png in the site repo. If the image is
// blocked or missing, the alt text "sortd." shows in white on the banner.
const LOGO_WHITE_URL = 'https://sortd-ireland.ie/images/sortd-logo-email-white.png';

// Dark theme, same family as the light one: deep navy surfaces, soft light text,
// brand green lifted so links still pass contrast on dark. Buttons keep the
// brand green with white text.
const DARK_CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark;}
@media (prefers-color-scheme: dark){
  body,.dm-page{background:#0E1626 !important;}
  .dm-card{background:#18233A !important;border-color:#2B3A58 !important;}
  .dm-body,.dm-body p,.dm-body strong,.dm-box{color:#E9EEF8 !important;}
  .dm-muted,.dm-foot p{color:#A9B4CC !important;}
  .dm-foot{border-color:#2B3A58 !important;}
  .dm-link,.dm-foot a,.dm-body a:not(.dm-btn){color:#6FD0A0 !important;}
  .dm-box-provider{background:#2A2552 !important;}
  .dm-box-parent{background:#17392B !important;}
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
    ? `<td style="padding-left:16px;vertical-align:middle;font-family:${BODY_FONT};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#ffffff;">${escapeHtml(o.eyebrow)}</td>`
    : '';
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@400;700&display=swap" rel="stylesheet">
<style>${DARK_CSS}</style></head>
<body style="margin:0;padding:0;background:#F3F6F9;font-family:${BODY_FONT};">
<table role="presentation" class="dm-page" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F6F9;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" class="dm-card" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border:1px solid ${BORDER};border-radius:18px;overflow:hidden;">
<tr><td class="dm-head" bgcolor="${tint.banner}" style="background:${tint.banner};padding:22px 32px;text-align:left;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;"><a href="https://sortd-ireland.ie" style="text-decoration:none;"><img src="${LOGO_WHITE_URL}" width="108" height="40" alt="sortd." style="display:block;border:0;outline:none;text-decoration:none;font-family:${HEAD_FONT};font-size:30px;font-weight:800;line-height:1;color:#ffffff;"></a></td>
${eyebrow}
</tr></table>
</td></tr>
<tr><td class="dm-body" style="padding:28px 32px 32px;color:${NAVY};font-size:16px;font-family:${BODY_FONT};font-weight:400;line-height:1.65;">
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
