// Netlify serverless function — sortd newsletter signup → MailerLite
// Place this file at: netlify/functions/subscribe.js

// SECURITY FIX: the MailerLite API key used to be hardcoded here in plain text —
// anyone with read access to this file (or a public repo) could see and reuse it.
// It now comes from a Netlify environment variable, same pattern as generate-listings.js.
const MAILERLITE_API_KEY = process.env.MAILERLITE_API_KEY;
const MAILERLITE_API_URL = 'https://connect.mailerlite.com/api';

exports.handler = async function(event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!MAILERLITE_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'MAILERLITE_API_KEY not set in env vars' }) };
  }

  // Parse the form body
  let data;
  try {
    // Handle both JSON and form-encoded bodies
    if (event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
      data = JSON.parse(event.body);
    } else {
      // Parse URL-encoded form data
      data = Object.fromEntries(new URLSearchParams(event.body));
    }
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { email, 'first-name': firstName, county, 'child1-age': child1Age, 'child2-age': child2Age } = data;

  // Validate required fields
  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email is required' }) };
  }

  // Build the MailerLite subscriber payload
  const payload = {
    email: email.trim().toLowerCase(),
    fields: {},
    status: 'active',
    opted_in_at: new Date().toISOString(),
  };

  if (firstName) payload.fields.name = firstName.trim();
  if (county)    payload.fields.county = county.trim();
  if (child1Age) payload.fields.child1_age = parseInt(child1Age, 10);
  if (child2Age) payload.fields.child2_age = parseInt(child2Age, 10);

  try {
    const response = await fetch(`${MAILERLITE_API_URL}/subscribers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${MAILERLITE_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (response.ok || response.status === 200 || response.status === 201) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true, message: 'Subscriber added' }),
      };
    } else {
      // MailerLite returned an error
      console.error('MailerLite error:', result);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: result.message || 'Failed to add subscriber' }),
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
