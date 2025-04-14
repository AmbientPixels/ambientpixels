// scripts/generateQuoteOfTheDay.js
const fs = require("fs");
const path = require("path");

const quotesPath = path.join(__dirname, "../data/nova-quotes.json");
const outputPath = path.join(__dirname, "../data/quote-of-the-day.json");

function pickRandomQuote(quotes) {
  return quotes[Math.floor(Math.random() * quotes.length)];
}

function run() {
  const quotes = JSON.parse(fs.readFileSync(quotesPath, "utf-8"));
  const selected = pickRandomQuote(quotes);
  const output = {
    quote: selected,
    updated: new Date().toISOString()
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log("✅ Quote of the Day updated:", output.quote);
}

run();
