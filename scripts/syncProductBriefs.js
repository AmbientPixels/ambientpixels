// syncProductBriefs.js
// Reads .claude/skills/SKILL.md files and extracts product briefs
// into api/_data/product-briefs.json for heartbeat prompt injection.
// Runs automatically in CI/CD before deploy.

var fs = require('fs');
var path = require('path');

var PRODUCT_SKILLS = {
  'blindspot':       { name: 'Blindspot',    url: 'https://ambientpixels.ai/blindspot/' },
  'cardforge':       { name: 'CardForge',    url: 'https://ambientpixels.ai/cardforge/' },
  'storyforge':      { name: 'StoryForge',   url: 'https://ambientpixels.ai/storyforge/' },
  'pixel-agents':    { name: 'Pixel Agents', url: 'https://ambientpixels.ai/pixel-agents/' },
  'ambientscore':    { name: 'AmbientScore', url: 'https://ambientpixels.ai/ambientscore/' },
  'ambientos-guide': { name: 'AmbientOS',    url: 'https://ambientpixels.ai/ambientos/' }
};

var MAX_BRIEF = 1200;

var scriptDir = __dirname;
var repoRoot = path.resolve(scriptDir, '..', '..');
var skillsDir = path.join(repoRoot, '.claude', 'skills');
var outputPath = path.join(scriptDir, '..', 'api', '_data', 'product-briefs.json');

// Sections that contain product knowledge agents can use for content
var GOOD_HEADINGS = [
  /player.?flow|user.?flow|core.?loop/i,
  /combat.?system|battle/i,
  /econom|progression|sparks|pricing/i,
  /feature|what.?it/i,
  /product.?identity|positioning/i,
  /pvp|async.?pvp|multiplayer/i,
  /element.?system/i,
  /crate|loot|cosmetic/i,
  /dimension|scoring/i,
  /the.?8.?agents/i,
  /social.?pipeline|blog.?pipeline|wiki.?pipeline/i,
  /quick.?orientation/i,
  /submission.?pipeline/i,
  /agent.?registry/i,
  /key.?feature/i,
  /card.?shar/i
];

// Sections that are dev-only — skip entirely
var BAD_HEADINGS = [
  /css|stylesheet|theme.?token|breakpoint|responsive/i,
  /file.?(?:structure|map)|directory/i,
  /architecture.?overview|frontend.?arch|server.?file/i,
  /debug|cheat|console/i,
  /test|smoke|playwright/i,
  /fixed.?bug|known.?issue/i,
  /lesson.?learned|gotcha/i,
  /mobile.?polish|desktop.?layout/i,
  /phase.?completed|roadmap/i,
  /decoupl/i,
  /iteration.?cycle|mandatory/i,
  /critical.?safety|do.?not.?touch|high.?blast/i,
  /common.?command|azure.?cli|local.?dev|deploy/i,
  /dashboard|ceo.?view|dev.?view|board.?view/i,
  /convergence|escalation|needs.?attention/i,
  /guardrail|blocking.?gate|guard.?rail/i,
  /heartbeat.?system|heartbeat.?module/i,
  /api.?layer|endpoint|route|rewrite/i,
  /visual.?identity|sound.?effect|card.?renderer/i,
  /auth.?system|b2c|login/i,
  /common.?task|how.?to|modify|add.?a.?new|change/i,
  /pipeline.?dev|cache.?bust/i,
  /critical.?rule|blast.?radius/i,
  /quick.?build.?class|card.?container/i,
  /working.?with/i
];

function parseSections(content) {
  var stripped = content.replace(/^---[\s\S]*?---\s*/, '');
  var lines = stripped.split('\n');
  var sections = [];
  var cur = null;
  var curDepth = 0;
  var curLines = [];

  for (var i = 0; i < lines.length; i++) {
    var m1 = lines[i].match(/^# (.+)/);
    var m2 = lines[i].match(/^## (.+)/);
    var m3 = lines[i].match(/^### (.+)/);
    if (m1 || m2 || m3) {
      if (cur) sections.push({ heading: cur, depth: curDepth, body: curLines.join('\n').trim() });
      cur = (m1 || m2 || m3)[1];
      curDepth = m1 ? 1 : m2 ? 2 : 3;
      curLines = [];
    } else {
      curLines.push(lines[i]);
    }
  }
  if (cur) sections.push({ heading: cur, depth: curDepth, body: curLines.join('\n').trim() });
  return sections;
}

function scrubDevArtifacts(text) {
  var s = text;
  // Remove code blocks
  s = s.replace(/```[\s\S]*?```/g, '');
  // Remove backtick-wrapped content (file refs, code, selectors)
  s = s.replace(/`[^`]+`/g, '');
  // Remove (Phase N — ...) annotations
  s = s.replace(/\(Phase \d+[^)]*\)/g, '');
  // Remove (server-side...) / (client-side...) annotations
  s = s.replace(/\((?:server|client)-side[^)]*\)/g, '');
  // Remove (computed in/by...) refs
  s = s.replace(/\(computed (?:in|by)[^)]+\)/g, '');
  // Remove lines mentioning file paths or Azure infrastructure
  s = s.replace(/^.*(?:ambientpixels\/|api\/|\.js\b|\.css\b|\.html\b|Azure (?:Blob|Function|Static)|blob storage|endpoint|route rewrite).*$/gim, '');
  // Remove empty bullet points
  s = s.replace(/^\s*[-*]\s*$/gm, '');
  // Remove pipe table formatting
  s = s.replace(/^\|.*\|$/gm, '');
  // Remove "For full/deep..." reference lines
  s = s.replace(/^For (?:full|deep) .*$/gm, '');
  // Remove parenthetical refs that became empty after stripping: (in ), (from ), etc.
  s = s.replace(/\([^)]*\bin\b\s*\)/g, '');
  s = s.replace(/\([^)]*\bfrom\b\s*\)/g, '');
  s = s.replace(/\(\s*\)/g, '');
  // Remove "at " / "in " / "lives in " / "lives at " with empty trailing space
  s = s.replace(/(?:lives? (?:at|in)|stored (?:at|in)|defined in|configured in|enforced in)\s+(?=[.\n,—]|$)/gim, '');
  // Remove "Frontend: " and similar labels pointing to nothing
  s = s.replace(/\*\*[^*]+:\*\*\s+(?=\n|$)/g, '');
  // Remove lines that are just "— " or empty bold markers
  s = s.replace(/^\s*—\s*$/gm, '');
  // Remove double spaces from stripped content
  s = s.replace(/  +/g, ' ');
  // Collapse whitespace
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function isGoodSection(heading) {
  for (var i = 0; i < BAD_HEADINGS.length; i++) {
    if (BAD_HEADINGS[i].test(heading)) return false;
  }
  for (var j = 0; j < GOOD_HEADINGS.length; j++) {
    if (GOOD_HEADINGS[j].test(heading)) return true;
  }
  return false;
}

function extractBrief(skillId, content) {
  var meta = PRODUCT_SKILLS[skillId];
  if (!meta) return null;

  var sections = parseSections(content);
  var parts = [];

  // Always include intro paragraph
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].depth === 1 && sections[i].body) {
      var intro = scrubDevArtifacts(sections[i].body.split('\n\n')[0]);
      if (intro.length > 20) parts.push(intro);
      break;
    }
  }

  // Collect good sections
  var used = {};
  for (var j = 0; j < sections.length; j++) {
    var sec = sections[j];
    if (!sec.body || used[sec.heading] || !isGoodSection(sec.heading)) continue;
    used[sec.heading] = true;

    var body = scrubDevArtifacts(sec.body);
    if (body.length < 30) continue;

    // Keep first 300 chars per section
    if (body.length > 300) {
      body = body.substring(0, 300).replace(/\n[^\n]*$/, '') + '...';
    }
    parts.push(sec.heading + ': ' + body);
  }

  var result = parts.join('\n\n');
  if (result.length > MAX_BRIEF) {
    result = result.substring(0, MAX_BRIEF).replace(/\n[^\n]*$/, '');
  }

  return {
    product: meta.name,
    url: meta.url,
    brief: result,
    extractedAt: new Date().toISOString(),
    sourceChars: content.length
  };
}

function main() {
  var resolvedDir = skillsDir;
  if (!fs.existsSync(resolvedDir)) {
    resolvedDir = path.join(process.cwd(), '..', '.claude', 'skills');
  }
  if (!fs.existsSync(resolvedDir)) {
    console.log('[syncProductBriefs] No skills directory found. Writing empty briefs.');
    fs.writeFileSync(outputPath, JSON.stringify({ products: [], generatedAt: new Date().toISOString() }, null, 2));
    return;
  }

  var entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  var products = [];

  for (var i = 0; i < entries.length; i++) {
    if (!entries[i].isDirectory() || !PRODUCT_SKILLS[entries[i].name]) continue;
    var skillFile = path.join(resolvedDir, entries[i].name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    var content = fs.readFileSync(skillFile, 'utf8');
    var brief = extractBrief(entries[i].name, content);
    if (brief) {
      products.push(brief);
      console.log('[syncProductBriefs]', brief.product + ':', brief.brief.length, 'chars from', (content.length / 1024).toFixed(0) + 'KB');
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), products: products }, null, 2));
  console.log('[syncProductBriefs] Wrote', products.length, 'briefs to product-briefs.json');
}

main();
