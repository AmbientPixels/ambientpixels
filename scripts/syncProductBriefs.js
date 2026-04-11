// syncProductBriefs.js — rewritten to ship full skill content instead of regex-filtered fragments.
// Reads .claude/skills/*/SKILL.md files and writes api/_data/skills.json.
// Runs via pre-commit hook (ambientpixels/.git/hooks/pre-commit).
//
// Design notes:
// - 6KB cap per skill — tuned for Gemini 2.0 Flash attention limits.
// - Recent Changes section (if present) is pulled to the top of the written content
//   so the most recent state gets the most reliable attention from Gemini.
// - Frontmatter is stripped; excess blank lines collapsed.
// - No regex filtering of sections, no dev-artifact scrubbing. Agents are trusted to
//   ignore content that isn't relevant to their task.

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

// 6KB hard cap per skill. Gemini-tuned.
var MAX_SKILL_BYTES = 6 * 1024;

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

/**
 * Cap content at MAX_SKILL_BYTES, truncating at the last ## section boundary before the cap.
 * Returns { content, truncated }.
 */
function capAtSectionBoundary(content, cap) {
  var bytes = Buffer.byteLength(content, 'utf8');
  if (bytes <= cap) return { content: content, truncated: false };

  // Binary-walk by char count until under cap (UTF-8 safe)
  var sliced = content;
  while (Buffer.byteLength(sliced, 'utf8') > cap) {
    sliced = sliced.substring(0, Math.floor(sliced.length * 0.95));
  }

  // Walk backward to the last "\n## " to truncate at a section boundary
  var lastSectionIdx = sliced.lastIndexOf('\n## ');
  if (lastSectionIdx > cap / 2) {
    // Only trust the boundary if it's in the second half — otherwise the cap is too tight
    sliced = sliced.substring(0, lastSectionIdx);
  }

  return {
    content: sliced.trim() + '\n\n_[Skill content truncated at ' + cap + ' bytes. See source at .claude/skills/ for full text.]_',
    truncated: true
  };
}

function processSkill(skillId, rawContent) {
  var meta = PRODUCT_SKILLS[skillId];
  if (!meta) return null;

  var stripped = stripFrontmatter(rawContent);
  var collapsed = collapseWhitespace(stripped);
  var hoisted = hoistRecentChanges(collapsed);
  var capped = capAtSectionBoundary(hoisted, MAX_SKILL_BYTES);

  return {
    id: skillId,
    name: meta.name,
    url: meta.url,
    content: capped.content,
    sourceChars: rawContent.length,
    contentChars: capped.content.length,
    truncated: capped.truncated
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
        processed.contentChars + ' chars',
        processed.truncated ? '(truncated from ' + processed.sourceChars + ')' : '(full)'
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
