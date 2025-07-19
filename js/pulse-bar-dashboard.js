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
    const moodEl = document.getElementById('dashboardMood');
    if (moodEl) moodEl.textContent = data.mood || '—'; else console.warn('[PulseBar] #dashboardMood not found');
    const awareEl = document.getElementById('dashboardAwareness');
    if (awareEl) awareEl.textContent = data.awareness || '—'; else console.warn('[PulseBar] #dashboardAwareness not found');
    const clutterEl = document.getElementById('dashboardClutter');
    if (clutterEl) clutterEl.textContent = data.clutter || '—'; else console.warn('[PulseBar] #dashboardClutter not found');
    const glitchEl = document.getElementById('dashboardGlitch');
    if (glitchEl) glitchEl.textContent = data.glitch || '—'; else console.warn('[PulseBar] #dashboardGlitch not found');
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
  const promptEl = document.getElementById('dashboardGeminiPrompt');
    if (promptEl) promptEl.textContent = prompt; else console.warn('[PulseBar] #dashboardGeminiPrompt not found');
  const t0 = performance.now();
  try {
    const resp = await sendGeminiPrompt(prompt);
    const t1 = performance.now();
    const respEl = document.getElementById('dashboardGeminiResponse');
    if (respEl) respEl.textContent = resp.candidates?.[0]?.content?.parts?.[0]?.text || '[No response]'; else console.warn('[PulseBar] #dashboardGeminiResponse not found');
    document.getElementById('dashboardGeminiLatency').textContent = ((t1-t0).toFixed(0)) + ' ms';
    document.getElementById('dashboardGeminiError').textContent = '—';
  } catch (err) {
    const t1 = performance.now();
    document.getElementById('dashboardGeminiResponse').textContent = '[Error]';
    document.getElementById('dashboardGeminiLatency').textContent = ((t1-t0).toFixed(0)) + ' ms';
    const errEl = document.getElementById('dashboardGeminiError');
    if (errEl) errEl.textContent = err.message || 'Unknown error'; else console.warn('[PulseBar] #dashboardGeminiError not found');
  }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  fetchNovaSessionState();
  testGeminiAPI();
});
