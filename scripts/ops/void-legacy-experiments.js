#!/usr/bin/env node
// void-legacy-experiments.js — mark every agentExperiments entry verdicted by the
// deleted approval-rate evaluator as `void`, keeping its history readable.
//
// Why: 34 "concluded" experiments carry verdicts (27 discard / 3 keep / 4 inconclusive)
// computed from CEO approval rate over n=3 tagged actions while the CEO was away, and
// baselines that summed cumulative poll samples (avgLikesPerPost 8→37 during zero
// posting). No prompt cites them any more, but a dashboard or a future agent could.
// Active ones are left active (the engagement gates still score them honestly).
//
//   node scripts/ops/void-legacy-experiments.js --dry-run
//   node scripts/ops/void-legacy-experiments.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const _candidates = [process.env.AP_LOCAL_SETTINGS, path.join(ROOT, 'api', 'local.settings.json'), path.join(ROOT, 'local.settings.json'), 'C:/Dev/Ambientpixels/ambientpixels/local.settings.json', 'C:/Dev/Ambientpixels/ambientpixels/api/local.settings.json'].filter(Boolean);
const _settingsPath = _candidates.find(p => fs.existsSync(p));
if (!_settingsPath) { console.error('local.settings.json not found in: ' + _candidates.join(', ')); process.exit(2); }
const settings = JSON.parse(fs.readFileSync(_settingsPath, 'utf8'));
Object.keys(settings.Values || {}).forEach(k => { if (!process.env[k]) process.env[k] = settings.Values[k]; });
const storage = require(path.join(ROOT, 'api', '_utils', 'companyStorage'));
const DRY = process.argv.includes('--dry-run');
const NOW = new Date().toISOString();
const REASON = 'verdict_measured_ceo_approval_rate_not_outcomes';

function voidLegacy(list) {
  const out = (Array.isArray(list) ? list : []).map(e => {
    if (!e || e.status === 'active') return e;
    if (e.status === 'void') return e;
    // Anything concluded/discarded WITHOUT an engagementMetric came from the legacy evaluator.
    if (e.engagementMetric) return e;
    return Object.assign({}, e, {
      status: 'void', legacyStatus: e.status, legacyResult: e.result || null,
      voidedAt: NOW, voidReason: REASON,
      note: 'Verdict came from the approval-rate evaluator removed 2026-10-06; baseline avgLikesPerPost summed cumulative poll rows. Not evidence for or against the hypothesis.'
    });
  });
  return out;
}

(async () => {
  const meta = await storage.getStateWithMeta('agentExperiments');
  if (meta.local || meta.failed) { console.error('REFUSING: local fallback or failed read'); process.exit(3); }
  const next = voidLegacy(meta.value);
  const n = next.filter(e => e && e.status === 'void' && e.voidedAt === NOW).length;
  console.log('would void', n, 'of', (meta.value || []).length, 'experiments; active kept:', next.filter(e => e && e.status === 'active').length);
  if (DRY) return;
  const backupPath = path.join(ROOT, '..', 'state-backup-' + NOW.slice(0, 10) + '-experiments.json');
  fs.writeFileSync(backupPath, JSON.stringify({ at: NOW, agentExperiments: meta.value }, null, 2));
  console.log('Backup written:', backupPath);
  const r = await storage.mutateState('agentExperiments', cur => voidLegacy(cur));
  console.log('written:', r.written, 'attempts', r.attempts);
})().catch(e => { console.error('FAILED:', e && e.message); process.exit(1); });
