const axios = require('axios');

module.exports = async function (context, req) {
  const functionKey = process.env.NOVA_API_KEY;

  if (!functionKey) {
    context.log.error('Function key is missing.');
    context.res = { status: 500, body: { error: 'Server configuration error.' } };
    return;
  }

  const moodUrl = `https://ambientpixels-nova-api.azurewebsites.net/api/synthesizenovamood?code=${functionKey}`;

  try {
    const response = await axios.post(moodUrl, req.body, {
      headers: { 'Content-Type': 'application/json' }
    });

    context.res = {
      status: 200,
      body: response.data
    };
  } catch (error) {
    context.log.error('Proxy error:', error.message);
    context.res = {
      status: 500,
      body: { error: 'Failed to fetch mood.' }
    };
  }
};
