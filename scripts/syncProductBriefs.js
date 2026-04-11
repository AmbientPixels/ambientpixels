// syncProductBriefs.js — ships FULL skill content to api/_data/skills.json.
// Reads .claude/skills/*/SKILL.md files. Runs via pre-commit hook.
//
// Design notes:
// - NO cap. Full skill content ships as-is. Gemini Flash has a 1M token context
//   window — 6 skills totaling ~180KB is 0.2% of that budget.
// - Recent Changes section (if present) is pulled to the top so the freshest
//   state gets the most reliable attention.
// - Frontmatter stripped. Excess blank lines collapsed. That's it.
// - Agents are trusted to read what's relevant to their task.
// - The per-skill injection in prompt-builders.js keeps each skill as its own
//   discrete prompt section — Gemini handles separated reference docs fine,
//   it just struggles with concatenated heterogeneous blocks.

var fs = require('fs');
var path = require('path');

var PRODUCT_SKILLS = {
  'ambientos-guide': { name: 'AmbientOS',    url: 'https://ambientpixels.ai/ambientos/' },
  'blindspot':       { name: 'Blindspot',    url: 'https://ambientpixels.ai/blindspot/' },
  'cardforge':       { name: 'CardForge',    url: 'https://ambientpixels.ai/cardforge/' },
  'storyforge':      { name: 'StoryForge',   url: 'https://ambientpixels.ai/storyforge/' },
  'pixel-agents':    { name: 'Pixel Agents', url: 'https://ambientpixels.ai/pixel-agents/' },
  'ambientscore':    { name: 'AmbientScore', url: 'https://ambientpixels.ai/ambientscore/' }
};

var scriptDir = __dirname;
var skillsDir = path.resolve(scriptDir, '..', '..', '.claude', 'skills');
var outputPath = path.join(scriptDir, '..', 'api', '_data', 'skills.json');

/**
 * Strip YAML frontmatter (---...---) if present.
 */
function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\s*/, '');
}

/**
 * Collapse 3+ consecutive blank lines into 2. Trim trailing whitespace on every line.
 */
function collapseWhitespace(content) {
  return content
    .split('\n')
    .map(function (line) { return line.replace(/[ \t]+$/, ''); })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Pull a "## Recent Changes" section to the top of the content if present.
 * This gives the freshest state the most reliable attention on Gemini.
 */
function hoistRecentChanges(content) {
  var lines = content.split('\n');
  var startIdx = -1;
  var endIdx = -1;

  for (var i = 0; i < lines.length; i++) {
    if (/^##\s+Recent Changes\b/i.test(lines[i])) {
      startIdx = i;
      // Find the next ## (same level) or end of file
      for (var j = i + 1; j < lines.length; j++) {
        if (/^##\s+/.test(lines[j])) {
          endIdx = j;
          break;
        }
      }
      if (endIdx === -1) endIdx = lines.length;
      break;
    }
  }

  if (startIdx === -1) return content; // no Recent Changes section

  // Extract the section
  var recentSection = lines.slice(startIdx, endIdx).join('\n').trim();

  // Remove it from its original location
  var remaining = lines.slice(0, startIdx).concat(lines.slice(endIdx)).join('\n').trim();

  // Find the intro: content from start up to the first ## heading (exclusive)
  var remainingLines = remaining.split('\n');
  var firstH2 = -1;
  for (var k = 0; k < remainingLines.length; k++) {
    if (/^##\s+/.test(remainingLines[k])) {
      firstH2 = k;
      break;
    }
  }

  if (firstH2 === -1) {
    // No other H2 — just prepend recent changes after the H1 intro
    return remaining + '\n\n' + recentSection;
  }

  var intro = remainingLines.slice(0, firstH2).join('\n').trim();
  var rest = remainingLines.slice(firstH2).join('\n').trim();
  return intro + '\n\n' + recentSection + '\n\n' + rest;
}

function processSkill(skillId, rawContent) {
  var meta = PRODUCT_SKILLS[skillId];
  if (!meta) return null;

  var stripped = stripFrontmatter(rawContent);
  var collapsed = collapseWhitespace(stripped);
  var hoisted = hoistRecentChanges(collapsed);

  return {
    id: skillId,
    name: meta.name,
    url: meta.url,
    content: hoisted,
    sourceChars: rawContent.length,
    contentChars: hoisted.length,
    truncated: false
  };
}

function main() {
  if (!fs.existsSync(skillsDir)) {
    console.log('[syncSkills] No skills directory found at', skillsDir, '— writing empty skills.json');
    fs.writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), skills: [] }, null, 2));
    return;
  }

  var entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  var skills = [];

  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory() || !PRODUCT_SKILLS[entries[i].name]) continue;
    var skillFile = path.join(skillsDir, entries[i].name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    var rawContent = fs.readFileSync(skillFile, 'utf8');
    var processed = processSkill(entries[i].name, rawContent);
    if (processed) {
      skills.push(processed);
      console.log(
        '[syncSkills]',
        processed.name + ':',
        processed.contentChars + ' chars (full, from ' + processed.sourceChars + ')'
      );
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), skills: skills }, null, 2));
  console.log('[syncSkills] Wrote', skills.length, 'skills to', path.basename(outputPath));

  // Clean up the old product-briefs.json if it still exists
  var oldBriefsPath = path.join(scriptDir, '..', 'api', '_data', 'product-briefs.json');
  if (fs.existsSync(oldBriefsPath)) {
    try { fs.unlinkSync(oldBriefsPath); console.log('[syncSkills] Removed legacy product-briefs.json'); } catch (e) { /* ignore */ }
  }
}

main();
