#!/usr/bin/env node
// Build AmbientOS agent profile pages + hub page from templates + data.
// Idempotent: re-running on unchanged inputs produces zero git diff.
// Pure stdlib — no npm dependencies.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const DATA = path.join(REPO, 'data', 'agent-profiles.json');
const TPL_PROFILE = path.join(REPO, 'templates', 'agent-profile.html');
const TPL_HUB = path.join(REPO, 'templates', 'agent-hub.html');
const OUT_BASE = path.join(REPO, 'ambientos', 'agents');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`ERROR reading ${p}: ${e.message}`); process.exit(1); }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); }
  catch (e) { console.error(`ERROR reading ${p}: ${e.message}`); process.exit(1); }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOwnsList(owns) {
  return owns.map(item => `<li>${escapeHtml(item)}</li>`).join('\n          ');
}

function renderCrewChips(agents, currentId) {
  return agents
    .filter(a => a.id !== currentId)
    .map(a =>
      `<a class="ap-agent-crew-chip" href="/ambientos/agents/${a.id}">
          <img class="ap-agent-crew-chip-avatar" src="${a.portrait}" alt="${escapeHtml(a.name)}" width="24" height="24">
          <span>${escapeHtml(a.name)}</span>
        </a>`
    )
    .join('\n        ');
}

function renderHubCards(agents) {
  return agents.map(a =>
    `<a class="ap-agent-hub-card" href="/ambientos/agents/${a.id}" data-agent-id="${a.id}">
        <img class="ap-agent-hub-card-portrait" src="${a.portrait}" alt="${escapeHtml(a.name)} portrait" loading="lazy">
        <h2 class="ap-agent-hub-card-name">${escapeHtml(a.name)}</h2>
        <p class="ap-agent-hub-card-role">${escapeHtml(a.role)} · Tier ${a.tier}</p>
        <span class="ap-agent-hub-card-status" data-status=""></span>
      </a>`
  ).join('\n      ');
}

function substitute(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in vars)) {
      console.error(`ERROR: unresolved placeholder {{${key}}} in template`);
      process.exit(1);
    }
    return vars[key];
  });
}

function writeIfChanged(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return false;
  }
  fs.writeFileSync(filePath, content);
  return true;
}

function main() {
  const data = readJson(DATA);
  const tplProfile = readText(TPL_PROFILE);
  const tplHub = readText(TPL_HUB);
  const agents = data.agents || [];

  if (agents.length !== 8) {
    console.error(`ERROR: expected 8 agents in data file, got ${agents.length}`);
    process.exit(1);
  }

  let writes = 0;

  // Per-agent profile pages
  for (const agent of agents) {
    const vars = {
      id: agent.id,
      name: escapeHtml(agent.name),
      role: escapeHtml(agent.role),
      tier: String(agent.tier),
      portrait: agent.portrait,
      pullQuote: escapeHtml(agent.pullQuote),
      bio: escapeHtml(agent.bio),
      ownsList: renderOwnsList(agent.owns),
      crewChips: renderCrewChips(agents, agent.id)
    };
    const html = substitute(tplProfile, vars);
    const outPath = path.join(OUT_BASE, agent.id, 'index.html');
    if (writeIfChanged(outPath, html)) writes++;
  }

  // Hub page
  const hubVars = {
    hubCards: renderHubCards(agents)
  };
  const hubHtml = substitute(tplHub, hubVars);
  if (writeIfChanged(path.join(OUT_BASE, 'index.html'), hubHtml)) writes++;

  console.log(`build-agent-profiles: ${agents.length} profiles + 1 hub; ${writes} files written.`);
}

main();
