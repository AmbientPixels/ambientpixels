// nova-quotes.js — Unified handler for Quote of the Moment + Live Quote Feed

document.addEventListener("DOMContentLoaded", () => {
    const quoteMomentEl = document.getElementById("quote-moment");
    const liveQuoteEl = document.getElementById("nova-core-quote");
  
    // --- Static: Quote of the Moment ---
    if (quoteMomentEl) {
      fetch("/data/quote-of-the-day.json")
        .then((res) => res.json())
        .then((data) => {
          quoteMomentEl.textContent = data.quote || "Operational intelligence in motion.";
        })
        .catch((err) => {
          console.error("[Nova Quote Moment] Failed to load:", err);
          quoteMomentEl.textContent = "Quote system offline.";
        });
    }
  
    // --- Dynamic: Live Quote Feed ---
    if (liveQuoteEl) {
      fetch("/data/nova-quotes.json")
        .then((res) => res.json())
        .then((quotes) => {
          if (!Array.isArray(quotes) || quotes.length === 0) return;
          updateLiveQuote(quotes);
          setInterval(() => updateLiveQuote(quotes), 15000);
        })
        .catch((err) => {
          console.error("[Nova Live Quote Feed] Failed to load:", err);
          liveQuoteEl.textContent = "Live quote feed unavailable.";
        });
    }
  
    function updateLiveQuote(quotes) {
      const quote = quotes[Math.floor(Math.random() * quotes.length)];
      liveQuoteEl.textContent = quote;
    }
  });