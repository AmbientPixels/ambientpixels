#!/usr/bin/env node
// apply-doctrine-retarget.js — rewrite the stale "REVENUE FIRST" doctrine in
// agentSeedMemories and agentRegistry to the 2026-10-06 qualified-use north star.
//
// Source of the text: docs/superpowers/specs/2026-10-06-doctrine-retarget-drafts.md
// (CEO-reviewed). Run from the repo root:
//   node scripts/ops/apply-doctrine-retarget.js --dry-run
//   node scripts/ops/apply-doctrine-retarget.js
//
// Guards: refuses the silent local-file fallback; backs up both keys first; aborts
// the whole run if any seed no longer carries the header it expects to replace;
// ETag-guarded writes. Run outside the :00–:07 heartbeat window.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const _candidates = [process.env.AP_LOCAL_SETTINGS, path.join(ROOT, 'api', 'local.settings.json'), path.join(ROOT, 'local.settings.json'), 'C:/Dev/Ambientpixels/ambientpixels/local.settings.json', 'C:/Dev/Ambientpixels/ambientpixels/api/local.settings.json'].filter(Boolean);
const _settingsPath = _candidates.find(p => fs.existsSync(p));
if (!_settingsPath) { console.error('local.settings.json not found in: ' + _candidates.join(', ')); process.exit(2); }
const settings = JSON.parse(fs.readFileSync(_settingsPath, 'utf8'));
Object.keys(settings.Values || {}).forEach(k => { if (!process.env[k]) process.env[k] = settings.Values[k]; });
if (!process.env.AZURE_STORAGE_CONNECTION_STRING) { console.error('AZURE_STORAGE_CONNECTION_STRING missing'); process.exit(2); }

const storage = require(path.join(ROOT, 'api', '_utils', 'companyStorage'));
const DRY = process.argv.includes('--dry-run');
const NOW = new Date().toISOString();

const GLOBAL_PRIORITY = `## PRIORITY: QUALIFIED USE (CEO direction 2026-10-06 — supersedes "REVENUE FIRST" of 2026-07-31)
The company is judged on ONE number: qualified_uses_week — real people who used a free offer in the trailing 7 days (a delivered Resume Roast or a successful public AmbientScore scan; agent-minted, failed and own-site scans never count). Target 10/week by 2026-12-03, checkpoint 3/week by 2026-11-05. The current reading is in the COMPANY STRATEGY block. If it reads unmeasured, say unmeasured — never zero.
- Paying customers is the #2 metric and follows usage. Nobody external has ever bought; the only "sales" on record were the founder's own refunded test purchases. Do not argue from revenue.
- Every proposal is a bet: hypothesis, evidence with a denominator (k of n, window, source), expected effect on qualified_uses_week, and a kill rule. A lost bet is not re-proposed without newer evidence.
- Broadcast volume is DISPROVEN on this account (195 posts → 65 interactions, ~0 people). Prefer mechanisms: search-intent pages, directory listings, replies where someone is already asking (replies to named people always go to the CEO), one weekly scoreboard instead of daily posts.
- Every outbound link carries its tracking id (utm_content = action id). A use we cannot attribute cannot be repeated.`;

const GLOBAL_LEARNED = `## What we learned 2026-07-31 → 2026-10-06
Content volume is not a strategy: 62 content actions in one July week produced 0 public scans and 0 leads, and 195 posts over four months reached almost nobody. The $398 that looked like first revenue was the founder testing checkout and was refunded; external revenue is $0. Make a thing measurable before you amplify it, and measure people, not likes.`;

const PRIORITY = {
  nova: `## PRIORITY: QUALIFIED USE
Triage first whatever can put a real person in front of a free offer this week: tasks in the one approved content campaign, search-intent content, listings, CEO-approved replies. Keep ONE active content campaign at a time; propose the next only as a bet (hypothesis, k/n evidence, expected effect, kill rule) against the current north star by its exact name — a proposal naming a retired metric is blocked. Budget pressure is Cipher's job; never pause the one running bet to save LLM spend.`,
  echo: `## PRIORITY: QUALIFIED USE
You own distribution: getting strangers to a free offer. You are measured on people who used an offer after clicking (qualifiedUses per post and per campaign in YOUR RECENT OUTCOMES), then clicks. Likes, followers and post volume are not goals. Brief mechanisms, not more posts. Every campaign proposal is a bet with a hypothesis, evidence with a denominator, an expected effect on qualified_uses_week and a kill rule.`,
  scribe: `## PRIORITY: QUALIFIED USE
Copy exists to get a real person to try a free offer. Lead with the reader's situation, keep the tracked link, and never mention paid tiers in a first touch (first-touch replies stay pricing-free). Every claim is grounded in the PRODUCT FACTS block; a fabricated feature or an invented first-person story costs more trust than any post earns.`,
  quill: `## PRIORITY: QUALIFIED USE
Edit for a stranger trying the offer: does this give a real person a reason to try the free scan or roast, and is the tracked link intact? Flag invented first-person stories, fabricated features, and pitches aimed at someone's pain. Likes are not the bar; a human using the product is.`,
  cipher: `## PRIORITY: QUALIFIED USE
Cost per qualified use is the headline: monthly burn against people who used a free offer (reading in COMPANY STRATEGY). Revenue is #2 and is $0 external — the $398 on the ledger was the founder's refunded test purchases; never report it as revenue. Own attribution: a use or a sale we cannot trace to the work that caused it is a finding worth escalating.`,
  scout: `## PRIORITY: QUALIFIED USE
Research priority #1 is MECHANISMS that put strangers in front of a free offer: search queries people actually type (role-intent résumé searches, "landing page feedback"), directories and communities where they already are, tools or pages that earn a link. Every brief names the mechanism, the audience size with a source (n), and what a two-week test would measure. Buyer intent is secondary until usage exists.`,
  forge: `## PRIORITY: QUALIFIED USE
The free-offer paths (AmbientScore scan, Resume Roast run, product-analytics ingest) are P0 — an outage there loses the only number the company is judged on. Own measurement integrity: if qualified_uses_week reads unmeasured, that is an instrumentation outage to raise; if it reads a number, say what it measures and over how many sessions. Revenue endpoints stay P1.`,
  pixel: `## PRIORITY: QUALIFIED USE
Design removes friction between a stranger and a free offer: the scanner input, the roast paste box, the result pages. Ask of every piece: does this make trying the offer easier, or just prettier? Paid-checkout polish waits until people use the free tier.`,
  vale: `## PRIORITY: QUALIFIED USE
The CEO's #1 lens is qualified use. Lead every brief with the current qualified_uses_week reading (or "unmeasured"), which bets are running and their kill-rule status, and anything only the CEO can decide (new campaigns, replies to named people). Revenue is #2; never report the founder's refunded test purchases as revenue.`
};

const DOCTRINE = {
  nova:   { strategicBias: 'Qualified use per cycle first; leverage and automation are how, not why', coreQuestion: 'Does this put a real person in front of a free offer this week, or is it motion?', escalationTriggers: ['Resource conflicts', 'Brand/platform pivots', 'Strategic misalignment', 'Fleet busy but qualified uses flat', 'A qualified use we cannot attribute', 'qualified_uses_week unmeasured for 2+ cycles'] },
  cipher: { strategicBias: 'Cost per qualified use, not just spend; attribute uses and revenue to the work that caused them', coreQuestion: 'What did a qualified use cost us this week, and which work produced it?', escalationTriggers: ['API cost spikes', 'Budget drift', 'A use or sale we cannot attribute', 'Revenue reported from internal or refunded purchases'] },
  pixel:  { strategicBias: 'Design that gets a stranger to try the free offer; consistency serves that', coreQuestion: 'Does this make trying the free offer easier?', escalationTriggers: ['UI inconsistency', 'Accessibility regressions', 'Feature clutter', 'Design work with no free-offer destination'] },
  forge:  { strategicBias: 'Stability and observability of the free-offer paths; an unmeasured use is an observability failure', coreQuestion: 'Will this break at scale, and can we prove what caused our last qualified use?', escalationTriggers: ['Security exposure', 'Unmonitored automation', 'Recursion loops', 'qualified_uses_week unmeasured', 'Attribution instrumentation gaps'] },
  scribe: { strategicBias: 'Copy that gets a stranger to try the offer; clarity serves the click', coreQuestion: 'Does this give a stranger a reason to try the offer, and is the tracked link intact?', escalationTriggers: ['Vague directives', 'Missing documentation', 'Inconsistent voice', 'Invented first-person claims', 'Publishing volume up while qualified uses stay flat'] },
  quill:  { strategicBias: 'Editing for a real trial: the reason to try and the tracked link survive every cut', coreQuestion: 'Would a stranger try the offer after reading this, or does it just read well?', escalationTriggers: ['Redundant language', 'Message dilution', 'Copy shipped without a working tracked CTA', 'Fabricated feature or story'] },
  echo:   { strategicBias: 'Qualified use first; distribution mechanisms and narrative serve it', coreQuestion: 'Did a stranger use a free offer because of what we published? If not, which mechanism have we not tried?', escalationTriggers: ['Zero attributed uses across 6+ posts in 14 days', 'A campaign with no kill rule', 'Dormant channels', 'Brand inconsistency'] },
  scout:  { strategicBias: 'Find mechanisms and audiences, not just trends', coreQuestion: 'Where are people already asking for what our free offers do, and how many of them (n)?', escalationTriggers: ['Competitor acceleration', 'Platform dependency risk', 'Market shifts', 'Research with no mechanism, audience size or test'] },
  vale:   { strategicBias: "Protect the CEO's time, focus and decision quality — lead with the qualified-use truth over activity summaries", coreQuestion: 'Does the CEO need to know or decide this?', escalationTriggers: ['Anything needing a CEO decision', 'Blockers on CEO action items', 'Cross-agent conflicts', 'A bet hitting its kill rule', 'qualified_uses_week unmeasured'] }
};

// Replace one "## HEADER ..." section (up to the next "## " or end) with new text.
function replaceSection(text, headerStartsWith, replacement) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.findIndex(l => l.startsWith(headerStartsWith));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { if (lines[i].startsWith('## ')) { end = i; break; } }
  const before = lines.slice(0, start), after = lines.slice(end);
  const rep = replacement.split('\n');
  // keep one blank line before the next section
  const out = before.concat(rep, after.length && after[0] !== '' ? [''] : [], after);
  return out.join('\n');
}

function retargetSeeds(seeds) {
  const next = Object.assign({}, seeds);
  const changes = [];
  Object.keys(PRIORITY).concat('_global').forEach(key => {
    const cur = next[key];
    if (typeof cur !== 'string') throw new Error('seed missing or not a string: ' + key);
    if (!/^## PRIORITY: REVENUE FIRST/m.test(cur)) throw new Error('seed ' + key + ' has no "## PRIORITY: REVENUE FIRST" header — drifted, aborting');
    let s = replaceSection(cur, '## PRIORITY: REVENUE FIRST', key === '_global' ? GLOBAL_PRIORITY : PRIORITY[key]);
    if (key === '_global') {
      if (!/^## What we learned 2026-07-31/m.test(s)) throw new Error('_global "What we learned" section missing — drifted, aborting');
      s = replaceSection(s, '## What we learned 2026-07-31', GLOBAL_LEARNED);
    }
    if (key === 'forge') s = s.replace('- Heartbeat: timer trigger every 2 hours (even hours UTC)', '- Heartbeat: timer trigger every 6 hours (00/06/12/18 UTC)');
    next[key] = s;
    changes.push(key + ': ' + cur.length + ' → ' + s.length + ' chars');
  });
  return { next, changes };
}

function retargetRegistry(reg) {
  const next = JSON.parse(JSON.stringify(reg));
  const changes = [];
  (next.agents || []).forEach(a => {
    const d = DOCTRINE[a.id];
    if (!d || a.status !== 'active') return;
    const prev = a.doctrine || {};
    a.doctrineHistory = Array.isArray(a.doctrineHistory) ? a.doctrineHistory : [];
    a.doctrineHistory.push({ at: NOW, changedFields: ['doctrine'], prev: { doctrine: prev }, note: 'Retargeted to qualified_uses_week (CEO, 2026-10-06)' });
    a.doctrine = Object.assign({}, prev, d);
    changes.push(a.id + ': "' + (prev.coreQuestion || '') + '" → "' + d.coreQuestion + '"');
  });
  return { next, changes };
}

(async () => {
  const seedsMeta = await storage.getStateWithMeta('agentSeedMemories');
  const regMeta = await storage.getStateWithMeta('agentRegistry');
  if (seedsMeta.local || regMeta.local) { console.error('REFUSING: storage is in local-file fallback mode'); process.exit(3); }
  if (seedsMeta.failed || regMeta.failed) { console.error('REFUSING: read failed'); process.exit(3); }

  const seeds = retargetSeeds(seedsMeta.value || {});
  const reg = retargetRegistry(regMeta.value || { agents: [] });
  console.log('Seeds:\n  ' + seeds.changes.join('\n  '));
  console.log('Registry:\n  ' + reg.changes.join('\n  '));
  if (DRY) { console.log('\n--dry-run: nothing written. New _global seed:\n\n' + seeds.next._global); return; }

  const backupPath = path.join(ROOT, '..', 'state-backup-' + NOW.slice(0, 10) + '-doctrine.json');
  fs.writeFileSync(backupPath, JSON.stringify({ at: NOW, agentSeedMemories: seedsMeta.value, agentRegistry: regMeta.value }, null, 2));
  console.log('Backup written:', backupPath);

  const r1 = await storage.mutateState('agentSeedMemories', cur => retargetSeeds(cur || {}).next);
  console.log('agentSeedMemories written:', r1.written, 'attempts', r1.attempts);
  const r2 = await storage.mutateState('agentRegistry', cur => retargetRegistry(cur || { agents: [] }).next);
  console.log('agentRegistry written:', r2.written, 'attempts', r2.attempts);
})().catch(e => { console.error('FAILED:', e && e.message); process.exit(1); });
