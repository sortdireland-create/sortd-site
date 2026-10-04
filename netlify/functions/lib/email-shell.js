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

const BODY_FONT = "'Nunito','Trebuchet MS',Verdana,Arial,sans-serif";
const HEAD_FONT = "'Baloo 2','Trebuchet MS',Verdana,Arial,sans-serif";

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function emailShell(innerHtml, unsubscribeUrl, opts) {
  const o = opts || {};
  const tint = TINTS[o.audience] || TINTS.provider;
  const eyebrow = o.eyebrow
    ? `<p style="margin:10px 0 0;font-family:${BODY_FONT};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${tint.ink};">${escapeHtml(o.eyebrow)}</p>`
    : '';
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Nunito:wght@400;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#CFE8F6;font-family:${BODY_FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#CFE8F6;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#ffffff;border:1px solid ${BORDER};border-radius:18px;overflow:hidden;">
<tr><td style="background:${tint.bg};padding:28px 32px 24px;text-align:left;">
<span style="font-family:${HEAD_FONT};font-size:30px;font-weight:800;line-height:1;color:${NAVY};">sortd<span style="color:${ACCENT};">.</span></span>
${eyebrow}
</td></tr>
<tr><td style="padding:32px;color:${NAVY};font-size:16px;font-family:${BODY_FONT};font-weight:400;line-height:1.65;">
${innerHtml}
</td></tr>
<tr><td style="border-top:1px solid ${BORDER};padding:20px 32px 24px;text-align:left;">
<p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};font-family:${BODY_FONT};">sortd · Ireland · <a href="https://sortd-ireland.ie" style="color:${ACCENT};text-decoration:none;font-weight:700;">sortd-ireland.ie</a></p>
<p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${MUTED};font-family:${BODY_FONT};">Questions? <a href="mailto:hello@sortd-ireland.ie" style="color:${ACCENT};text-decoration:underline;">hello@sortd-ireland.ie</a> · <a href="https://sortd-ireland.ie/privacy-policy" style="color:${ACCENT};text-decoration:underline;">Privacy Policy</a></p>
${unsubscribeUrl ? `<p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:${MUTED};font-family:${BODY_FONT};"><a href="${unsubscribeUrl}" style="color:${ACCENT};text-decoration:underline;">Unsubscribe</a> from emails like this</p>` : ''}
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
<a href="${url}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-family:${HEAD_FONT};font-weight:700;text-decoration:none;font-size:16px;border-radius:999px;">${text}</a>
</td></tr></table>`;
}

// Soft tinted summary box (listing details etc.). `html` is trusted markup.
function emailBox(html, audience) {
  const tint = TINTS[audience] || TINTS.provider;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tint.bg};border-radius:16px;margin:0 0 20px;"><tr><td style="padding:16px 20px;font-size:15px;color:${NAVY};line-height:1.8;font-family:${BODY_FONT};">
${html}
</td></tr></table>`;
}

module.exports = { emailShell, emailButton, emailBox, escapeHtml };
