// File: js/test-nova-api.js
import config from "./config.js";

async function testQuoteAPI() {
  const url = `${config.apiBase}/generateNovaQuote?code=${config.keys.generateNovaQuote}`;

  try {
    const response = await fetch(url);
    const text = await response.text();
    console.log("✅ Quote API says:", text);
  } catch (error) {
    console.error("❌ Error calling generateNovaQuote:", error);
  }
}

async function testDreamAPI() {
  const url = `${config.apiBase}/dreamLogWriter?code=${config.keys.dreamLogWriter}`;
  const body = JSON.stringify({ dream: "Nova dreamed of glowing circuits..." });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const text = await response.text();
    console.log("✅ Dream API says:", text);
  } catch (error) {
    console.error("❌ Error calling dreamLogWriter:", error);
  }
}

testQuoteAPI();
testDreamAPI();
