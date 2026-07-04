// vale-memory.js — PURE memory logic for Vale (no I/O). Modeled on the fleet's L4
// agentMemories economy, but with write-time dedup (which the fleet lacks) and a
// permanent "CEO corrections" tier. Import into valechat / vale-state; unit-tested.
'use strict';

var DAY_MS = 86400000;
var MAX_MEMORIES = 60;      // FIFO cap for earned memories
var MAX_CONVERSATION = 40;  // ring buffer for chat turns

// TTL in days by type. 0 = never expires (standing knowledge about the CEO).
var TTL_BY_TYPE = { preference: 0, constraint: 0, decision: 90, learning: 30, context: 14 };
var DEFAULT_TTL_DAYS = 14;
var ALLOWED_TYPES = { preference: 1, constraint: 1, decision: 1, learning: 1, context: 1 };

// Sources that are never pruned or evicted — CEO corrections are gospel.
var PERMANENT_SOURCES = { 'auto:ceo-correction': true };

function makeMemory(opts) {
  opts = opts || {};
  var now = opts.now || Date.now();
  var type = ALLOWED_TYPES[opts.type] ? opts.type : 'context';
  var ttlDays = (type in TTL_BY_TYPE) ? TTL_BY_TYPE[type] : DEFAULT_TTL_DAYS;
  return {
    id: 'vm_' + now + '_' + Math.random().toString(36).slice(2, 7),
    type: type,
    text: String(opts.text || '').slice(0, 300),
    source: opts.source || 'vale',
    timestamp: new Date(now).toISOString(),
    expiresAt: ttlDays > 0 ? new Date(now + ttlDays * DAY_MS).toISOString() : null,
    evidence: opts.evidence || null
  };
}

// Normalized key for write-time dedup: type + first 40 chars of lowercased alnum text.
// Collapse every run of non-alphanumerics to a single space so punctuation differences
// (e.g. "plain-English" vs "plain english") normalize identically.
function dedupKey(rec) {
  var t = String(rec.text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return rec.type + '|' + t.slice(0, 40);
}

// Add with write-time dedup + FIFO cap that never evicts permanent sources.
function addMemory(list, rec, opts) {
  opts = opts || {};
  var max = opts.max || MAX_MEMORIES;
  var arr = Array.isArray(list) ? list.slice() : [];
  var key = dedupKey(rec);
  if (arr.some(function (x) { return dedupKey(x) === key; })) {
    return { list: arr, added: false, deduped: true };
  }
  arr.push(rec);
  while (arr.length > max) {
    var idx = arr.findIndex(function (x) { return !PERMANENT_SOURCES[x.source]; });
    if (idx === -1) break; // all permanent — keep them
    arr.splice(idx, 1);
  }
  return { list: arr, added: true, deduped: false };
}

function pruneMemories(list, now) {
  now = now || Date.now();
  if (!Array.isArray(list)) return [];
  return list.filter(function (x) {
    if (PERMANENT_SOURCES[x.source]) return true;
    if (!x.expiresAt) return true;
    return new Date(x.expiresAt).getTime() > now;
  });
}

function pushConversation(list, turn, cap) {
  cap = cap || MAX_CONVERSATION;
  var arr = Array.isArray(list) ? list.slice() : [];
  arr.push(turn);
  if (arr.length > cap) arr = arr.slice(arr.length - cap);
  return arr;
}

function _formatSeed(seed) {
  if (!Array.isArray(seed) || !seed.length) return '';
  var lines = seed.map(function (s) {
    return '- ' + (s.topic ? s.topic + ': ' : '') + String(s.text || '');
  });
  return '\n\nWHAT YOU KNOW ABOUT THE CEO (seed knowledge):\n' + lines.join('\n');
}

// Build the weighted prompt blocks: seed, permanent CEO corrections, recent learned,
// and open action items. Different classes stay in separate blocks so weight is kept.
function formatMemoryBlocks(opts) {
  opts = opts || {};
  var out = _formatSeed(opts.seed);
  var mems = Array.isArray(opts.memories) ? opts.memories : [];

  var corrections = mems.filter(function (x) { return x.source === 'auto:ceo-correction'; }).slice(-5);
  if (corrections.length) {
    out += '\n\nWHAT THE CEO HAS TOLD ME (standing corrections/preferences — always honor):\n' +
      corrections.map(function (x) { return '- ' + x.text; }).join('\n');
  }

  var recent = mems.filter(function (x) { return x.source !== 'auto:ceo-correction'; }).slice(-10);
  if (recent.length) {
    out += '\n\nWHAT I\'VE LEARNED (recent):\n' +
      recent.map(function (x) { return '- [' + x.type + '] ' + x.text; }).join('\n');
  }

  var actions = Array.isArray(opts.actionList)
    ? opts.actionList.filter(function (a) { return a.status !== 'done'; }) : [];
  if (actions.length) {
    out += '\n\nOPEN CEO ACTION ITEMS (things only the CEO can do):\n' +
      actions.map(function (a) { return '- ' + a.title + (a.deadline ? ' (due ' + a.deadline + ')' : ''); }).join('\n');
  }
  return out;
}

module.exports = {
  MAX_MEMORIES, MAX_CONVERSATION, TTL_BY_TYPE, PERMANENT_SOURCES,
  makeMemory, dedupKey, addMemory, pruneMemories, pushConversation, formatMemoryBlocks
};
