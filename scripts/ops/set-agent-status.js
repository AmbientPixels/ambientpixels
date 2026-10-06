#!/usr/bin/env node
// set-agent-status.js — flip an agent's registry status (active | dormant).
//
// Why (2026-10-06): Pixel and Cipher have no outcome lane and were skipped in 98 and
// 94 of the last 100 heartbeats. `dormant` is the honest word: constants._applyRegistry
// builds AGENT_IDS from status === 'active', so a dormant agent is not prompted, not
// ranked on the XP ladder, and not counted toward fleet size — and a lane assignment
// (status back to active) reactivates it with memories and seeds intact. Nothing is
// retired; the registry entry stays.
//
//   node scripts/ops/set-agent-status.js --dry-run dormant pixel cipher
//   node scripts/ops/set-agent-status.js dormant pixel cipher
//   node scripts/ops/set-agent-status.js active pixel
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

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const rest = args.filter(a => a !== '--dry-run');
const status = rest[0];
const ids = rest.slice(1).map(s => String(s).toLowerCase());
if (['active', 'dormant'].indexOf(status) === -1 || !ids.length) { console.error('usage: set-agent-status.js [--dry-run] <active|dormant> <agentId...>'); process.exit(2); }
const PROTECTED = { nova: true, cipher: false }; // cipher may go dormant (CEO 2026-10-06); nova never
const NOW = new Date().toISOString();

(async () => {
  const meta = await storage.getStateWithMeta('agentRegistry');
  if (meta.local || meta.failed) { console.error('REFUSING: local fallback or failed read'); process.exit(3); }
  const reg = meta.value || { agents: [] };
  const activeAfter = reg.agents.filter(a => a && a.status === 'active' && !(status === 'dormant' && ids.indexOf(a.id) !== -1)).length + (status === 'active' ? ids.length : 0);
  if (activeAfter < 5) { console.error('REFUSING: fleet would drop below FLEET_MIN_SIZE (5)'); process.exit(3); }
  ids.forEach(id => {
    const a = reg.agents.find(x => x && x.id === id);
    if (!a) { console.error('unknown agent', id); process.exit(2); }
    if (PROTECTED[id]) { console.error('REFUSING: protected agent', id); process.exit(3); }
    console.log(id + ': ' + a.status + ' → ' + status);
  });
  if (DRY) { console.log('--dry-run: nothing written'); return; }
  const backupPath = path.join(ROOT, '..', 'state-backup-' + NOW.slice(0, 10) + '-registry.json');
  fs.writeFileSync(backupPath, JSON.stringify({ at: NOW, agentRegistry: reg }, null, 2));
  console.log('Backup written:', backupPath);
  const r = await storage.mutateState('agentRegistry', cur => {
    const next = JSON.parse(JSON.stringify(cur || { agents: [] }));
    next.agents.forEach(a => {
      if (!a || ids.indexOf(a.id) === -1) return;
      a.statusHistory = Array.isArray(a.statusHistory) ? a.statusHistory : [];
      a.statusHistory.push({ at: NOW, from: a.status, to: status, by: 'ceo', note: status === 'dormant' ? 'No outcome lane; reactivate by assigning one (2026-10-06 learning plan)' : 'Reactivated' });
      a.status = status;
      if (status === 'dormant') a.dormantAt = NOW; else delete a.dormantAt;
    });
    return next;
  });
  console.log('written:', r.written, 'attempts', r.attempts);
})().catch(e => { console.error('FAILED:', e && e.message); process.exit(1); });
