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

/**
 * For large skills (>15K chars), extract only agent-relevant sections.
 * Agents need: recent changes, product/agent facts, pipeline rules, guardrails.
 * They don't need: full API docs, CSS architecture, common commands, code examples.
 */
var AGENT_RELEVANT_HEADINGS = [
  'recent changes',
  'quick orientation',
  'the 8 agents',
  'three pipelines',
  'bluesky discovery',
  'key guardrails',
  'products',
  'content quality',
  'founder voice',
  'trust-based governance',
  'campaign scheduler',
  'task lifecycle',
  'convergence',
  'needs attention',
  'ceo revision',
  'self-correcting',
  'model configuration',
  'removed systems',
  'critical safety'
];

var MAX_SKILL_CHARS = 20000;

function extractAgentRelevant(content) {
  var lines = content.split('\n');
  var sections = [];
  var currentSection = { heading: '', lines: [], level: 0 };

  for (var i = 0; i < lines.length; i++) {
    var headingMatch = lines[i].match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      if (currentSection.lines.length > 0) {
        sections.push(currentSection);
      }
      currentSection = {
        heading: headingMatch[2].trim(),
        lines: [lines[i]],
        level: headingMatch[1].length
      };
    } else {
      currentSection.lines.push(lines[i]);
    }
  }
  if (currentSection.lines.length > 0) sections.push(currentSection);

  // Keep intro (before first heading) + sections matching relevant headings
  var kept = [];
  var totalChars = 0;

  for (var j = 0; j < sections.length; j++) {
    var s = sections[j];
    var headingLower = s.heading.toLowerCase();

    // Always keep intro (no heading) and h1 title
    var isIntro = !s.heading || s.level <= 1;
    var isRelevant = AGENT_RELEVANT_HEADINGS.some(function (kw) {
      return headingLower.indexOf(kw) !== -1;
    });

    if (isIntro || isRelevant) {
      var sectionText = s.lines.join('\n');
      if (totalChars + sectionText.length > MAX_SKILL_CHARS) {
        // Truncate this section to fit
        var remaining = MAX_SKILL_CHARS - totalChars;
        if (remaining > 200) {
          kept.push(sectionText.substring(0, remaining) + '\n[... section truncated]');
        }
        break;
      }
      kept.push(sectionText);
      totalChars += sectionText.length;
    }
  }

  return kept.join('\n\n');
}

function processSkill(skillId, rawContent) {
  var meta = PRODUCT_SKILLS[skillId];
  if (!meta) return null;

  var stripped = stripFrontmatter(rawContent);
  var collapsed = collapseWhitespace(stripped);
  var hoisted = hoistRecentChanges(collapsed);

  // For ambientos-guide (system reference doc), extract only agent-relevant sections.
  // Other product skills are kept in full — they're product-specific and agents need them.
  // If any other skill exceeds MAX_SKILL_CHARS, simple truncation with notice.
  var content = hoisted;
  var truncated = false;
  if (skillId === 'ambientos-guide' && hoisted.length > MAX_SKILL_CHARS) {
    content = extractAgentRelevant(hoisted);
    truncated = true;
  } else if (hoisted.length > MAX_SKILL_CHARS) {
    content = hoisted.substring(0, MAX_SKILL_CHARS) + '\n\n[... truncated at ' + MAX_SKILL_CHARS + ' chars]';
    truncated = true;
  }

  return {
    id: skillId,
    name: meta.name,
    url: meta.url,
    content: content,
    sourceChars: rawContent.length,
    contentChars: content.length,
    truncated: truncated
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
