#!/usr/bin/env node
// disable-proposal-generator.js — turn off the deterministic proposal generator cron
// via systemConfig (runtime toggle; no redeploy).
//
// Why (2026-10-06): proposalGeneratorCron mints campaign proposals with
// northStarMetric null and objective proposals naming `bluesky_followers` (retired),
// tagged proposedBy:'nova' and source:'auto:proposal-generator'. They bypass the
// agent-path gates (bet contract, betKey dedup, north-star block) and would reach the
// CEO without a bet, so nothing minted by it can ever be scored. Its own header says
// to disable it once the agent path is sufficient; the agent path has been.
//
// systemConfig is read-modify-write: this script only touches proposalGenerator.
//   node scripts/ops/disable-proposal-generator.js --dry-run
//   node scripts/ops/disable-proposal-generator.js
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

(async () => {
  const meta = await storage.getStateWithMeta('systemConfig');
  if (meta.local || meta.failed) { console.error('REFUSING: local fallback or failed read'); process.exit(3); }
  const cur = meta.value || {};
  console.log('current proposalGenerator:', JSON.stringify(cur.proposalGenerator || null));
  if (DRY) { console.log('--dry-run: would set proposalGenerator.enabled=false'); return; }
  const backupPath = path.join(ROOT, '..', 'state-backup-' + NOW.slice(0, 10) + '-systemConfig.json');
  fs.writeFileSync(backupPath, JSON.stringify({ at: NOW, systemConfig: cur }, null, 2));
  console.log('Backup written:', backupPath);
  const r = await storage.mutateState('systemConfig', c => {
    const next = Object.assign({}, c || {});
    next.proposalGenerator = Object.assign({}, next.proposalGenerator || {}, {
      enabled: false, disabledAt: NOW, disabledBy: 'ceo',
      disabledReason: 'Minted proposals with no bet and a retired north star (bluesky_followers), bypassing the agent-path gates. Agent path is sufficient (2026-10-06 learning plan).'
    });
    return next;
  });
  console.log('written:', r.written, 'attempts', r.attempts);
})().catch(e => { console.error('FAILED:', e && e.message); process.exit(1); });
