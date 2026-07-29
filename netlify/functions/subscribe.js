// Netlify serverless function — sortd newsletter signup → Customer.io
// Place this file at: netlify/functions/subscribe.js
//
// MIGRATED from MailerLite to Customer.io. This creates/updates a customer
// PROFILE in Customer.io (their "Track API") — it does NOT send a newsletter
// itself. Actual newsletter sends happen from Customer.io's dashboard
// (Campaigns/Broadcasts), same as they did manually in MailerLite before.
//
// Requires these Netlify env vars:
//   CUSTOMERIO_SITE_ID       — Track API site ID (Customer.io → Settings → API Credentials)
//   CUSTOMERIO_TRACK_API_KEY — Track API key, same location
//   CUSTOMERIO_REGION        — "us" or "eu", depending which region you picked at signup
//                              (get this wrong and every request silently fails)

const REGION = (process.env.CUSTOMERIO_REGION || 'us').toLowerCase();
const TRACK_HOST = REGION === 'eu' ? 'track-eu.customer.io' : 'track.customer.io';

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const siteId = process.env.CUSTOMERIO_SITE_ID;
  const apiKey = process.env.CUSTOMERIO_TRACK_API_KEY;
  if (!siteId || !apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Customer.io Track API credentials not set' }) };
  }

  let data;
  try {
    if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
      data = JSON.parse(event.body);
    } else {
      data = Object.fromEntries(new URLSearchParams(event.body));
    }
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { email, 'first-name': firstName, county, 'child1-age': child1Age, 'child2-age': child2Age } = data;

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email is required' }) };
  }

  const cleanEmail = email.trim().toLowerCase();

  // Customer.io identifies profiles by an ID you choose — using the email
  // itself as the ID is the simplest approach for a newsletter-only use case.
  const attributes = {
    email: cleanEmail,
    subscribed_at: Math.floor(Date.now() / 1000), // Customer.io wants unix timestamps
  };
  if (firstName) attributes.first_name = firstName.trim();
  if (county)    attributes.county = county.trim();
  if (child1Age) attributes.child1_age = parseInt(child1Age, 10);
  if (child2Age) attributes.child2_age = parseInt(child2Age, 10);

  try {
    const auth = Buffer.from(`${siteId}:${apiKey}`).toString('base64');
    const response = await fetch(`https://${TRACK_HOST}/api/v1/customers/${encodeURIComponent(cleanEmail)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify(attributes),
    });

    if (response.ok) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, message: 'Subscriber added' }),
      };
    } else {
      const result = await response.text();
      console.error('Customer.io error:', result);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Failed to add subscriber' }),
      };
    }
  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error, please try again' }),
    };
  }
};
