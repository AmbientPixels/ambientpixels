// memory-select.js — which L4 memories reach the prompt.
//
// Pure. No I/O. Replaces `memories.slice(-10)` in prompt-builders (2026-10-06).
//
// Why: with "last 10 by array position", Echo's entire memory block was nine
// consolidated rate-limit notices and one experiment announcement. Thirteen of the
// fleet's 57 memories were "I emitted more than 3 actions last cycle". The things an
// agent must not forget — a CEO correction, a scored bet, a quality-gate rejection
// with the specific issue — were pushed out by log lines.
//
// Selection order (highest first), most recent first inside each tier:
//   1. CEO corrections and scored outcomes (sources auto:ceo-*, auto:bet-verdict,
//      auto:experiment-verdict). Never dropped while there is room.
//   2. Durable agent knowledge: decision, constraint, verified_fact, resolved_incident,
//      preference.
//   3. Synthesis: consolidated_belief, weekly_report, reflection, learning.
//   4. Transient: feedback, context — capped at FEEDBACK_CAP so a run of quality-gate
//      rejections cannot fill the block.
// Dropped always: auto:rate-limit (the cap is already stated in the prompt),
// placeholder texts, expired entries.
//
// The chosen set is returned in chronological order so the agent reads it as a
// timeline, which is how the previous block read.
'use strict';

const DEFAULT_LIMIT = 10;
const FEEDBACK_CAP = 2;
const MIN_TEXT_CHARS = 20;

const PRIORITY_SOURCES = ['auto:ceo-edit', 'auto:ceo-revision', 'auto:bet-verdict', 'auto:experiment-verdict'];
const DROP_SOURCES = ['auto:rate-limit', 'auto:performance-reflection'];
const TIER2_TYPES = new Set(['decision', 'constraint', 'verified_fact', 'resolved_incident', 'preference']);
const TIER3_TYPES = new Set(['consolidated_belief', 'weekly_report', 'reflection', 'learning']);
const TIER4_TYPES = new Set(['feedback', 'context']);

function _ts(m) {
  const t = Date.parse((m && (m.timestamp || m.ts)) || '');
  return Number.isFinite(t) ? t : 0;
}

function isPlaceholderText(text) {
  const t = String(text || '').trim();
  if (t.length < MIN_TEXT_CHARS) return true;
  if (/^(string|text|null|undefined|n\/?a|todo|tbd|\.+)$/i.test(t)) return true;
  // A consolidated belief whose "core belief" is a placeholder carries nothing either.
  return /core belief:\s*(string|text|null|undefined|n\/?a)\s*$/i.test(t);
}

function tierOf(m) {
  const src = String((m && m.source) || '');
  if (PRIORITY_SOURCES.some(p => src.indexOf(p) === 0)) return 1;
  const type = String((m && m.type) || '').toLowerCase();
  if (TIER2_TYPES.has(type)) return 2;
  if (TIER3_TYPES.has(type)) return 3;
  if (TIER4_TYPES.has(type)) return 4;
  return 3;
}

function isEligible(m, nowMs) {
  if (!m || isPlaceholderText(m.text)) return false;
  const src = String(m.source || '');
  if (DROP_SOURCES.some(p => src.indexOf(p) === 0)) return false;
  if (m.expiresAt) {
    const e = Date.parse(m.expiresAt);
    if (Number.isFinite(e) && e <= nowMs) return false;
  }
  return true;
}

// memories: the agent's L4 array (any order). Returns a new array, chronological.
function selectMemoriesForPrompt(memories, limit, nowMs) {
  const cap = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const pool = (Array.isArray(memories) ? memories : []).filter(m => isEligible(m, now));
  const byTier = { 1: [], 2: [], 3: [], 4: [] };
  pool.forEach(m => byTier[tierOf(m)].push(m));
  Object.keys(byTier).forEach(k => byTier[k].sort((a, b) => _ts(b) - _ts(a)));

  const chosen = [];
  const take = (list, max) => {
    for (let i = 0; i < list.length && chosen.length < cap && i < max; i++) chosen.push(list[i]);
  };
  take(byTier[1], Infinity);
  take(byTier[2], Infinity);
  take(byTier[3], Infinity);
  take(byTier[4], FEEDBACK_CAP);

  return chosen.sort((a, b) => _ts(a) - _ts(b));
}

// Sources whose text deserves the "YOU PREVIOUSLY REFLECTED — do not repeat the
// mistake" callout. Rate-limit and performance notices are not corrections.
const CALLOUT_SOURCES = ['auto:ceo-edit', 'auto:ceo-revision', 'auto:bet-verdict', 'auto:experiment-verdict', 'auto:quality-gate'];
function selectCalloutMemories(memories, limit, nowMs) {
  const cap = Number.isFinite(limit) && limit > 0 ? limit : 2;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return (Array.isArray(memories) ? memories : [])
    .filter(m => isEligible(m, now) && CALLOUT_SOURCES.some(p => String(m.source || '').indexOf(p) === 0))
    .sort((a, b) => _ts(b) - _ts(a))
    .slice(0, cap)
    .reverse();
}

module.exports = {
  selectMemoriesForPrompt,
  selectCalloutMemories,
  isPlaceholderText,
  tierOf,
  DEFAULT_LIMIT, FEEDBACK_CAP, MIN_TEXT_CHARS, PRIORITY_SOURCES, DROP_SOURCES, CALLOUT_SOURCES
};
