const axios = require('axios');

module.exports = async function (context, myTimer) {
  const timestamp = new Date().toISOString();
  context.log(`[Nova Timer] Mood sync started at ${timestamp}`);

  const moodEndpoint = "https://ambientpixels-nova-api.azurewebsites.net/api/synthesizeNovaMood";
  
  // Access the NOVA_API_KEY from Azure's environment variables
  const apiKey = process.env.NOVA_API_KEY; // Get API key from environment variable

  const headers = {
    'Authorization': `Bearer ${apiKey}` // Use the API key in the Authorization header
  };

  try {
    const response = await axios.post(moodEndpoint, {}, { headers });

    const mood = response.data?.mood || "unknown";
    context.log(`[Nova Timer] Mood updated successfully: ${mood}`);
  } catch (error) {
    context.log.error("[Nova Timer] Failed to update mood:", error.message);
  }
};
