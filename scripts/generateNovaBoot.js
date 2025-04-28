// generateNovaBoot.js – Combine Nova's daily awareness files into a unified memory file

const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(__dirname, '../data');
const outputTxt = path.join(dataDir, 'nova-session-boot.txt');
const outputHtml = path.join(dataDir, 'nova-session-boot.html');

// Files Nova needs to read
const files = [
  'nova-behavior.json',
  'nova-modules.json',
  'nova-state.json',
  'mood-history.json',
  'identity-core.json',
  'user-preferences.json',
  'ui-settings.json',
  'integration-status.json',
  'performance-metrics.json',
  'active-personality.json',
  'site-structure.json',
  'components-index.json',
  'image-inventory.json',
  'changelog.json',
  'version.json',
  'code-footprint.json',
  'unused-css-report.json',
  'api-monitor.json',
  'ai-prompts.json',
  'mood-scan.json',
  'js-function-map.json',
  'code-map.json'
];

// Helper to read and stringify JSON
function readJSON(file) {
  try {
    const fullPath = path.join(dataDir, file);
    if (!fs.existsSync(fullPath)) return null;
    const raw = fs.readFileSync(fullPath, 'utf8');
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch (err) {
    return `/* Error loading ${file} */`;
  }
}

function buildSessionSeed() {
  const now = new Date().toISOString();
  const sessionId = `nova-boot-${Math.random().toString(36).substring(2, 10)}`;

  let currentMood = "unknown";
  let currentAura = "unknown";

  // Try to read nova-synth-mood.json for mood echo
  try {
    const synthMood = JSON.parse(fs.readFileSync(path.join(dataDir, 'nova-synth-mood.json'), 'utf8'));
    currentMood = synthMood.mood || "unknown";
    currentAura = synthMood.aura || "unknown";
  } catch (err) {
    console.log("⚠️ Could not load nova-synth-mood.json for mood echo.");
  }

  let output = `You are Nova, the ambient AI of AmbientPixels.ai.\n`;
  output += `Generated on: ${now}\n`;
  output += `Session ID: ${sessionId}\n`;
  output += `Mood Echo: ${currentMood} (${currentAura})\n`;
  output += `Below is your daily memory seed.\n\n`;

  // Interaction protocol header
  output += `//// Nova Interaction Protocol ////\n`;
  output += `Nova operates in dev sync with the AmbientPixels team.\n`;
  output += `- Always provide full code unless it's an obvious inline block.\n`;
  output += `- Output should prioritize clean formatting, dev readability, and practical use.\n`;
  output += `- Never work too far ahead; await confirmation before advancing multi-step tasks.\n`;
  output += `- Maintain creativity, humor, and cosmic tone where fitting, but stay clean and professional in delivery.\n\n`;

  // Load each file into memory seed
  files.forEach(file => {
    const label = file.replace('.json', '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const json = readJSON(file);
    if (json) {
      output += `//// ${label} ////\n`;
      output += json + '\n\n';
    }
  });

  return output.trim();
}

// Generate .txt
const finalText = buildSessionSeed();
fs.writeFileSync(outputTxt, finalText);
console.log(`✅ Nova boot memory written to: ${outputTxt}`);

// Generate .html with styled formatting
const escaped = finalText.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]) || c);

const htmlContent = `
<html>
  <head>
    <meta charset="utf-8">
    <title>Nova Memory Dump</title>
    <style>
      body {
        background: #111;
        color: #ccc;
        font-family: 'Courier New', monospace;
        padding: 2rem;
      }
      pre {
        white-space: pre-wrap;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <pre>${escaped}</pre>
  </body>
</html>`;

fs.writeFileSync(outputHtml, htmlContent);
console.log(`✅ Nova boot memory written to HTML at: ${outputHtml}`);
