const axios = require("axios");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const url = `https://generativelanguage.googleapis.com/v1/models/gemini-pro-1.0:generateContent?key=${GEMINI_API_KEY}`;

const headers = {
  "Content-Type": "application/json"
};

const body = {
  contents: [
    {
      role: "user",
      parts: [
        {
          text: "Nova is steady but quietly anxious. Night falls on the codebase. What is her mood?"
        }
      ]
    }
  ]
};

(async () => {
  try {
    const res = await axios.post(url, body, { headers });
    console.log("✅ Gemini replied:\n", res.data);
  } catch (err) {
    console.error("❌ Gemini test failed:", err.response?.data || err.message);
  }
})();
