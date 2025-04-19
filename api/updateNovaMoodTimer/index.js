const axios = require("axios");

module.exports = async function (context, myTimer) {
  const timestamp = new Date().toISOString();
  context.log(`[Nova Timer] Mood sync started at ${timestamp}`);

  try {
    const response = await axios.post(
      "https://ambientpixels-nova-api.azurewebsites.net/api/synthesizeNovaMood"
    );

    const mood = response.data?.mood || "unknown";
    context.log(`[Nova Timer] Mood updated successfully: ${mood}`);
  } catch (error) {
    context.log.error("[Nova Timer] Failed to update mood:", error.message);
  }
};
