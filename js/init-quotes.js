// File: /js/init-quotes.js – Load Quote of the Moment

document.addEventListener('DOMContentLoaded', () => {
    const quoteEl = document.getElementById('nova-quote');
    if (!quoteEl) return;
  
    fetch('/data/mood-scan.json')
      .then(res => res.json())
      .then(data => {
        quoteEl.textContent = `💭 "${data.quote || 'Nova is still thinking...'}"`;
      })
      .catch(err => {
        quoteEl.textContent = '💭 "Silence. The AI rests."';
        console.warn('[Nova Quotes] Failed to load quote.', err);
      });
  });
  