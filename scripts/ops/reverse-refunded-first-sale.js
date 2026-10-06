#!/usr/bin/env node
// reverse-refunded-first-sale.js — remove the `first_sale` achievement and the
// sales counter that Echo and Scribe earned from the founder's own refunded test
// purchases (the $398 "first revenue"; external revenue is $0).
//
// The engine already excludes internal revenue from XP on read (revenueLedger
// internal-email classification, 2026-07-30), but the achievements and counters
// minted before that fix are frozen in the ledger and shown on the public Fleet
// page. This is a one-off correction, recorded on the ledger with a note.
//
//   node scripts/ops/reverse-refunded-first-sale.js --dry-run
//   node scripts/ops/reverse-refunded-first-sale.js
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
const TARGETS = ['echo', 'scribe'];

function correct(ledger) {
  const next = JSON.parse(JSON.stringify(ledger || {}));
  next.corrections = Array.isArray(next.corrections) ? next.corrections : [];
  const log = [];
  TARGETS.forEach(id => {
    const A = next.perAgent && next.perAgent[id];
    if (!A) return;
    const before = { sales: (A.counters && A.counters.sales) || 0, achievements: (A.achievements || []).map(a => a.id) };
    const had = (A.achievements || []).some(a => a.id === 'first_sale');
    A.achievements = (A.achievements || []).filter(a => a.id !== 'first_sale');
    if (A.counters) A.counters.sales = 0;
    if (had || before.sales > 0) {
      next.corrections.push({ at: NOW, agentId: id, removed: ['first_sale'], salesBefore: before.sales, reason: 'Founder self-purchases, refunded; external revenue $0 (CEO, 2026-10-06)' });
      log.push(id + ': first_sale ' + (had ? 'removed' : 'absent') + ', sales ' + before.sales + ' → 0');
    } else log.push(id + ': nothing to correct');
  });
  return { next, log };
}

(async () => {
  const meta = await storage.getStateWithMeta('agentRewards');
  if (meta.local || meta.failed) { console.error('REFUSING: local fallback or failed read'); process.exit(3); }
  const { log } = correct(meta.value);
  console.log(log.join('\n'));
  if (DRY) { console.log('--dry-run: nothing written'); return; }
  const backupPath = path.join(ROOT, '..', 'state-backup-' + NOW.slice(0, 10) + '-agentRewards.json');
  fs.writeFileSync(backupPath, JSON.stringify({ at: NOW, agentRewards: meta.value }, null, 2));
  console.log('Backup written:', backupPath);
  const r = await storage.mutateState('agentRewards', cur => correct(cur).next);
  console.log('written:', r.written, 'attempts', r.attempts);
})().catch(e => { console.error('FAILED:', e && e.message); process.exit(1); });
