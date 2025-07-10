// pulse-bar-dashboard.js
// Handles Nova dashboard state and Gemini API diagnostics for pulse-bar.html
// Follows Windsurf modularity and DRY rules

import { sendGeminiPrompt } from './gemini-api.js';

// --- Nova State ---
async function fetchNovaSessionState() {
  try {
    const res = await fetch('/data/nova-session-boot.txt');
    if (!res.ok) throw new Error('Failed to fetch Nova session boot');
    const raw = await res.text();
    // Try to parse as JSON or fallback to extracting key fields
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // Fallback: extract with regex
      data = {};
      const mood = /Mood:\s*([^\n]+)/i.exec(raw); if (mood) data.mood = mood[1];
      const awareness = /Awareness:\s*([^\n]+)/i.exec(raw); if (awareness) data.awareness = awareness[1];
      const clutter = /Memory Clutter:\s*([^\n]+)/i.exec(raw); if (clutter) data.clutter = clutter[1];
      const glitch = /Glitch Factor:\s*([^\n]+)/i.exec(raw); if (glitch) data.glitch = glitch[1];
    }
    document.getElementById('dashboardMood').textContent = data.mood || '—';
    document.getElementById('dashboardAwareness').textContent = data.awareness || '—';
    document.getElementById('dashboardClutter').textContent = data.clutter || '—';
    document.getElementById('dashboardGlitch').textContent = data.glitch || '—';
  } catch (err) {
    document.getElementById('dashboardMood').textContent = 'Error';
    document.getElementById('dashboardAwareness').textContent = '—';
    document.getElementById('dashboardClutter').textContent = '—';
    document.getElementById('dashboardGlitch').textContent = '—';
  }
}

// --- Gemini Diagnostics ---
async function testGeminiAPI() {
  const prompt = 'Nova system ping.';
  document.getElementById('dashboardGeminiPrompt').textContent = prompt;
  const t0 = performance.now();
  try {
    const resp = await sendGeminiPrompt(prompt);
    const t1 = performance.now();
    document.getElementById('dashboardGeminiResponse').textContent = resp.candidates?.[0]?.content?.parts?.[0]?.text || '[No response]';
    document.getElementById('dashboardGeminiLatency').textContent = ((t1-t0).toFixed(0)) + ' ms';
    document.getElementById('dashboardGeminiError').textContent = '—';
  } catch (err) {
    const t1 = performance.now();
    document.getElementById('dashboardGeminiResponse').textContent = '[Error]';
    document.getElementById('dashboardGeminiLatency').textContent = ((t1-t0).toFixed(0)) + ' ms';
    document.getElementById('dashboardGeminiError').textContent = err.message || 'Unknown error';
  }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  fetchNovaSessionState();
  testGeminiAPI();
});
