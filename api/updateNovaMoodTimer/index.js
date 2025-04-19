const axios = require("axios");

module.exports = async function (context, myTimer) {
  const timestamp = new Date().toISOString();
  context.log(`[Nova Timer] Mood sync started at ${timestamp}`);

  const isLocal = process.env.NODE_ENV !== "production";
  const baseUrl = isLocal
    ? "http://localhost:7071"
    : "https://ambientpixels-nova-api.azurewebsites.net";

  const moodEndpoint = `${baseUrl}/api/synthesize-nova-mood`;

  try {
    const response = await axios.post(moodEndpoint);

    const mood = response.data?.mood || "unknown";
    context.log(`[Nova Timer] Mood updated successfully: ${mood}`);
  } catch (error) {
    context.log.error("[Nova Timer] Failed to update mood:", error.message);
  }
};
