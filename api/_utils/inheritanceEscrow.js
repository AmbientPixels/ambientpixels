// Track C Phase 1 — freeze a retiring agent's knowledge into the agentInheritance
// escrow.
//
// Retirement itself deletes nothing, but memoryConsolidate iterates EVERY key in
// agentMemories with no active-agent filter (memoryConsolidate/index.js:75), so an
// archived agent's memories keep being collapsed forever. The snapshot has to be
// taken at retirement or the source quietly degrades.
//
// Pure functions only — all IO lives in the approveProposal retire branch. Nothing
// reads these escrows yet; distillation, hire-time matching and the successor prompt
// block are Phase 2, which owns every status other than 'raw'.
//
// Spec: docs/superpowers/specs/2026-07-31-retirement-knowledge-inheritance-design.md

'use strict';

function _clone(list) {
  if (!Array.isArray(list)) return [];
  try { return JSON.parse(JSON.stringify(list)); } catch (_e) { return []; }
}

// Freeze one retiring agent's knowledge. Never mutates or aliases its inputs — the
// source agentMemories bucket must survive exactly as it was, because it is the
// recovery path if this capture is ever lost.
function buildEscrow(input) {
  const i = input || {};
  const reg = i.registryEntry || {};
  const agentId = String(i.agentId || '');
  const memories = _clone(i.memories);
  const reports = _clone(i.reports);
  return {
    agentId: agentId,
    name: reg.name || agentId,
    role: reg.role || '',
    retiredAt: i.retiredAt || null,
    retiredReason: i.retiredReason || '',
    capturedAt: i.capturedAt || null,
    status: 'raw',
    memoryCount: memories.length,
    reportCount: reports.length,
    raw: { memories: memories, reports: reports }
  };
}

// Idempotent insert. An existing escrow always wins: a re-approved retirement must
// never overwrite a frozen snapshot with a consolidation-degraded one.
function captureEscrow(store, escrow, nowIso) {
  const src = (store && typeof store === 'object') ? store : {};
  const escrows = (src.escrows && typeof src.escrows === 'object') ? src.escrows : {};
  const id = escrow && escrow.agentId;
  if (!id || escrows[id]) {
    return { store: { escrows: escrows, updatedAt: src.updatedAt || null }, added: false };
  }
  const merged = Object.assign({}, escrows);
  merged[id] = escrow;
  return { store: { escrows: merged, updatedAt: nowIso || null }, added: true };
}

module.exports = { buildEscrow, captureEscrow };
