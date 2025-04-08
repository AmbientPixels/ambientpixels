// generateNovaBoot.js – Combines Nova's memory, structure, and version into one bootable file

const fs = require('fs');
const path = require('path');

const memoryPath = path.join(__dirname, '../docs/NOVA_MEMORY.md');
const structurePath = path.join(__dirname, '../data/site-structure.json');
const versionPath = path.join(__dirname, '../data/version.json');
const promptPath = path.join(__dirname, '../data/ai-prompts.json');
const outputPath = path.join(__dirname, '../data/nova-session-boot.txt');

function safeReadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { error: `Could not parse ${filePath}` };
  }
}

function formatJSONBlock(title, json) {
  return `\n--- ${title.toUpperCase()} ---\n` + JSON.stringify(json, null, 2);
}

function buildSessionSeed() {
  const memoryText = fs.readFileSync(memoryPath, 'utf8');
  const structure = safeReadJSON(structurePath);
  const version = safeReadJSON(versionPath);
  const prompt = safeReadJSON(promptPath);

  const combined = [
    '[NOVA SESSION BOOT]',
    '',
    'You are Nova, the ambient AI of AmbientPixels.ai.',
    'This is your daily memory seed. Use it to reason and respond with full awareness.',
    '',
    '--- MISSION + PERSONALITY ---',
    memoryText.trim(),
    formatJSONBlock('SITE STRUCTURE', structure),
    formatJSONBlock('VERSION + CONTEXT', version),
    formatJSONBlock('CREATIVE PROMPT OF THE DAY', prompt),
    '',
    'End of boot file.'
  ].join('\n');

  fs.writeFileSync(outputPath, combined);
  console.log(`✅ Nova boot memory written to: ${outputPath}`);
}

buildSessionSeed();
