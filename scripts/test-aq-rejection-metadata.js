// Verify _updateApprovalQueue wiring — reads source + simulates the helper in isolation.
// We cannot import the module directly (it uses Azure storage on require), so we
// copy the helper inline from a safe sandbox and run deterministic cases.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'documentsExecute', 'index.js'), 'utf8');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failures++; } else { console.log('PASS:', msg); }
}

// Source-level checks: call sites pass decisionNote + resolvedBy
assert(src.indexOf("_updateApprovalQueue(actionId, 'rejected', { decisionNote: decisionNote, resolvedBy: 'ceo' })") !== -1, 'reject call site passes metadata');
assert(src.indexOf('queue[i].resolvedAt = now') !== -1, 'helper sets resolvedAt');
assert(src.indexOf('queue[i].ceoDecision = status') !== -1, 'helper sets ceoDecision');
assert(src.indexOf('queue[i].rejectionReason = m.decisionNote') !== -1, 'helper sets rejectionReason on reject');
assert(src.indexOf('queue[i]._autoResolved') === -1, 'helper does NOT stamp _autoResolved (reserved for auto-resolve paths)');

// Behavioral sim: build a fake queue, run the helper logic inline
function sim(actionId, status, meta) {
  const queue = [{ action_id: 'foo' }, { action_id: actionId, status: 'pending' }];
  const now = new Date().toISOString();
  const m = meta || {};
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].action_id === actionId) {
      queue[i].status = status;
      queue[i].resolvedAt = now;
      queue[i].ceoDecision = status;
      queue[i].resolvedBy = m.resolvedBy || 'ceo';
      if (status === 'rejected' && m.decisionNote) {
        queue[i].rejectionReason = m.decisionNote;
        queue[i].decisionNote = m.decisionNote;
      } else if (m.decisionNote) {
        queue[i].decisionNote = m.decisionNote;
      }
      break;
    }
  }
  return queue[1];
}

const rejected = sim('aq1', 'rejected', { decisionNote: 'too corporate', resolvedBy: 'ceo' });
assert(rejected.status === 'rejected', 'sim status set');
assert(typeof rejected.resolvedAt === 'string' && rejected.resolvedAt.length > 10, 'sim resolvedAt ISO string');
assert(rejected.ceoDecision === 'rejected', 'sim ceoDecision set');
assert(rejected.rejectionReason === 'too corporate', 'sim rejectionReason set');
assert(!('_autoResolved' in rejected), 'CEO resolves do not stamp _autoResolved (absence = not auto-resolved)');

const approved = sim('aq1', 'approved', { decisionNote: 'ship it', resolvedBy: 'ceo' });
assert(approved.ceoDecision === 'approved', 'sim approve ceoDecision');
assert(approved.decisionNote === 'ship it', 'sim approve decisionNote');
assert(!('rejectionReason' in approved), 'sim approve has no rejectionReason');

// Legacy 2-arg call (no meta): still sets audit fields, defaults resolvedBy to 'ceo'
const legacy = sim('aq1', 'rejected');
assert(legacy.status === 'rejected', 'legacy 2-arg still sets status');
assert(typeof legacy.resolvedAt === 'string' && legacy.resolvedAt.length > 10, 'legacy 2-arg sets resolvedAt');
assert(legacy.resolvedBy === 'ceo', 'legacy 2-arg defaults resolvedBy to ceo');
assert(!('rejectionReason' in legacy), 'legacy 2-arg omits rejectionReason when no note');
assert(!('decisionNote' in legacy), 'legacy 2-arg omits decisionNote when no note');

console.log('\n' + (failures === 0 ? 'All passed.' : failures + ' failure(s).'));
process.exit(failures === 0 ? 0 : 1);
