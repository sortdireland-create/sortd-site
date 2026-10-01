// netlify/functions/logout.js
// GET /.netlify/functions/logout — clears both the session cookie and the
// display-only "logged in" flag cookie (see lib/session.js), then sends
// the person home. No Airtable call needed — logging out just means this
// browser no longer carries a valid cookie, the token record itself was
// already marked Used at login time.

const { clearSessionCookies } = require('./lib/session');

const SITE_URL = 'https://sortd-ireland.ie';

exports.handler = async function () {
  return {
    statusCode: 302,
    headers: { Location: `${SITE_URL}/` },
    multiValueHeaders: { 'Set-Cookie': clearSessionCookies() },
    body: '',
  };
};
