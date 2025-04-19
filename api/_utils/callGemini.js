const axios = require("axios");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

module.exports = async function callGemini(input) {
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;
  const headers = {
    "Content-Type": "application/json"
  };

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Read this and identify emotional tone and internal state:\n\n"${input}"\n\nReturn a short mood summary.`
          }
        ]
      }
    ]
  };

  try {
    const res = await axios.post(url, body, { headers });
    const reply = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return reply || "uncertain";
  } catch (err) {
    console.error("🔥 Gemini call failed:", err.response?.data || err.message);
    throw new Error("Gemini API failed");
  }
};
