#!/usr/bin/env node
// apply-northstar-widen.js — decision 8 (2026-10-06): qualified_uses_week now counts
// every product's first-value event. The code half is strategy-intel.js +
// pa-metrics.countQualifiedPaUses7d. This is the data half: the one sentence in the
// _global seed that defines the metric, the objective's description/retargetNote, and
// the north-star label in companyStrategy. Read-modify-write, ETag-guarded, backup first.
//
//   node scripts/ops/apply-northstar-widen.js --dry-run
//   node scripts/ops/apply-northstar-widen.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const _candidates = [process.env.AP_LOCAL_SETTINGS, path.join(ROOT, 'api', 'local.settings.json'), path.join(ROOT, 'local.settings.json'), 'C:/Dev/Ambientpixels/ambientpixels/local.settings.json'].filter(Boolean);
const _settingsPath = _candidates.find(p => fs.existsSync(p));
if (!_settingsPath) { console.error('local.settings.json not found'); process.exit(2); }
const settings = JSON.parse(fs.readFileSync(_settingsPath, 'utf8'));
Object.keys(settings.Values || {}).forEach(k => { if (!process.env[k]) process.env[k] = settings.Values[k]; });
const storage = require(path.join(ROOT, 'api', '_utils', 'companyStorage'));
const DRY = process.argv.includes('--dry-run');
const NOW = new Date().toISOString();

const OLD_DEF = 'real people who used a free offer in the trailing 7 days (a delivered Resume Roast or a successful public AmbientScore scan; agent-minted, failed and own-site scans never count).';
const NEW_DEF = 'real people who used a free offer in the trailing 7 days: a successful public AmbientScore scan, any Pixel Agents run delivered (Resume Roast is one of the 24), a CardForge quick build, a StoryForge adventure started, a Blindspot card created, or an Agent Forge agent submitted. Agent-minted, failed, own-site and internal sessions never count.';
const OLD_COUNTED = 'only AmbientScore scans and Resume Roast runs are COUNTED today.';
const NEW_COUNTED = 'every one of their free offers is COUNTED (decision 8, 2026-10-06).';

const OBJ_ID = 'obj-build-public';
const OBJ_DESC = 'Content is still the motion; followers are no longer the goal. Success is a human who reached one of our free offers and actually used it: a public AmbientScore scan, any Pixel Agents run delivered (Resume Roast is one of the 24 agents), a CardForge quick build, a StoryForge adventure started, a Blindspot card created, or an Agent Forge agent submitted. Agent-minted, failed, own-site and internal sessions do NOT count and never will. The channel is deliberately unspecified: use whatever demonstrably sends real people (search, aggregators, directories, communities, tools, direct). Every claim tied to a real event, never invented. Judge work on people who used an offer, not on reach, impressions, likes or follower counts.';
const OBJ_NOTE = 'Retargeted 2026-10-06 (CEO): north star qualified_uses_week = successful public AmbientScore scans + every other product\'s first-value event (Pixel Agents runs delivered incl. Resume Roast, CardForge quick builds, StoryForge adventures started, Blindspot cards created, Agent Forge agents submitted), trailing 7 days, internal excluded (decision 8 widened it from scans + Resume Roast only). Target 10/week by 2026-12-03, checkpoint 3/week by 2026-11-05. Search channels take 4-8 weeks to show; social broadcast is measured at ~0 and is not the lever.';
const NS_LABEL = 'People who used any free offer (7d)';

(async () => {
  const seeds = await storage.getStateWithMeta('agentSeedMemories');
  const objs = await storage.getStateWithMeta('objectives');
  const strat = await storage.getStateWithMeta('companyStrategy');
  if ([seeds, objs, strat].some(m => m.local || m.failed)) { console.error('REFUSING: local fallback or failed read'); process.exit(3); }
  const g = String((seeds.value || {})._global || '');
  const hasDef = g.includes(OLD_DEF), hasCounted = g.includes(OLD_COUNTED);
  const obj = (objs.value || []).find(o => o && o.id === OBJ_ID);
  console.log('_global has old definition:', hasDef, '| has "only ... COUNTED today":', hasCounted, '| objective found:', !!obj, '| strategy label:', strat.value && strat.value.northStar && strat.value.northStar[0] && strat.value.northStar[0].label);
  if (!hasDef || !obj) { console.error('ABORT: expected text/objective not present'); process.exit(3); }
  if (DRY) { console.log('--dry-run: nothing written'); return; }
  const backupPath = path.join(ROOT, '..', 'state-backup-' + NOW.slice(0, 10) + '-northstar-widen.json');
  fs.writeFileSync(backupPath, JSON.stringify({ at: NOW, agentSeedMemories: seeds.value, objectives: objs.value, companyStrategy: strat.value }, null, 2));
  console.log('Backup written:', backupPath);
  const r1 = await storage.mutateState('agentSeedMemories', cur => { const n = Object.assign({}, cur || {}); n._global = String(n._global || '').split(OLD_DEF).join(NEW_DEF).split(OLD_COUNTED).join(NEW_COUNTED); return n; });
  console.log('agentSeedMemories written:', r1.written);
  const r2 = await storage.mutateState('objectives', cur => (cur || []).map(o => (o && o.id === OBJ_ID) ? Object.assign({}, o, { description: OBJ_DESC, retargetNote: OBJ_NOTE, updatedAt: NOW, widenedAt: NOW }) : o));
  console.log('objectives written:', r2.written);
  const r3 = await storage.mutateState('companyStrategy', cur => { const n = Object.assign({}, cur || {}); n.northStar = (n.northStar || []).map(m => m && m.metric === 'qualified_uses_week' ? Object.assign({}, m, { label: NS_LABEL }) : m); n.updatedAt = NOW; n.updatedBy = 'CEO (decision 8, 2026-10-06)'; return n; });
  console.log('companyStrategy written:', r3.written);
})().catch(e => { console.error('FAILED:', e && e.message); process.exit(1); });
