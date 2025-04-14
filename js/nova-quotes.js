// File: /js/nova-quotes.js — Nova Quote Injector for Homepage + Dashboard

document.addEventListener('DOMContentLoaded', () => {
    const quoteEl = document.getElementById('nova-quote');
    if (!quoteEl) return;
  
    fetch('/data/nova-quotes.json')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const quote = data[Math.floor(Math.random() * data.length)];
          quoteEl.textContent = `💭 "${quote}"`;
        } else {
          quoteEl.textContent = '💭 "Nova is silent."';
        }
      })
      .catch(err => {
        console.warn('[Nova Quotes] Failed to load quotes.', err);
        quoteEl.textContent = '💭 "Nova is offline."';
      });
  });
  