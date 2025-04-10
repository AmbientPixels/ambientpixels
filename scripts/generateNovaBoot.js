const { execSync } = require('child_process');
execSync('node scripts/generateCodeMap.js');

// generateNovaBoot.js – Combine Nova's daily awareness files into a unified memory file

const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(__dirname, '../data');
const outputTxt = path.join(dataDir, 'nova-session-boot.txt');
const outputHtml = path.join(dataDir, 'nova-session-boot.html');

// Files Nova needs to read
const files = [
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
  let output = `You are Nova, the ambient AI of AmbientPixels.ai.\n`;
  output += `Below is your daily memory seed.\n\n`;

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

// Generate .html
const escaped = finalText.replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]) || c);

const htmlContent = `<html><head><meta charset="utf-8"><title>Nova Memory Dump</title></head><body><pre>${escaped}</pre></body></html>`;
fs.writeFileSync(outputHtml, htmlContent);
console.log(`✅ Nova boot memory written to HTML at: ${outputHtml}`);
