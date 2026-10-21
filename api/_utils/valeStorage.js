// valeStorage.js — isolated accessor for Vale's CEO-only personal state. Every key is
// stored under a 'vale/' blob path so it can never collide with company-state's
// <key>.json rooting, and NONE of these keys are in company-state's VALID_KEYS — so they
// are unreachable via the anonymous /api/company-state surface. This is the privacy seam.
//
// Key classes (2026-10-17, mail access): what the vale-state endpoint may expose.
//   gate   — read/write with the normal Vale gate (old principal while strict auth is off)
//   bearer — read-only, and only with a verified Microsoft bearer token, whatever the flags
//            say: anything that can hold mail-derived text (chat history included)
//   rules  — only through vale-state's rules.get / rules.set ops, bearer token always
//   never  — server-only (refresh token, OAuth pending state, audit, brief log)
'use strict';

var storage = require('./companyStorage');

var KEY_CLASS = {
  valeSeed: 'gate',           // CEO-authored onboarding knowledge (durable)
  valeMemory: 'gate',         // earned memories (typed, TTL'd)
  valeBriefs: 'gate',         // Discord brief history (company facts only)
  ceoActionList: 'gate',      // CEO manual to-dos
  ceoProfile: 'gate',         // CEO profile (workHours for the mail brief)
  valeConversations: 'bearer', // chat ring buffer — may contain mail answers
  valeMailState: 'bearer',    // latest derived triage (no bodies)
  valeMailBriefs: 'bearer',   // email brief history
  valeMailRules: 'rules',     // VIP / muted / receipts / rules-only / projects
  valeMailToken: 'never',     // encrypted refresh token + connection status
  valeConnectPending: 'never', // OAuth state + PKCE verifier (10-min TTL)
  valeMailAudit: 'never',     // one entry per run, no message content
  valeBriefLog: 'never',      // per-Pacific-date send status + inbox watermark
  valeDraftRate: 'never',     // vale-draft hourly counter: { hour, count } only, no content
  valeTeamsLog: 'never',      // Teams channel posts: what was told when (ids, dates), no content
  valeTeamsChat: 'never'      // Teams chat turns (no mail is ever read there); server-side only
};

var ALLOWED_KEYS = {};
Object.keys(KEY_CLASS).forEach(function (k) { ALLOWED_KEYS[k] = 1; });

function _key(key) { return 'vale/' + key; }

function keyClass(key) { return KEY_CLASS[key] || null; }

// May vale-state let this caller read/write this key? via: 'bearer' | 'principal'.
function accessFor(key, mode, via) {
  var cls = keyClass(key);
  if (cls === 'gate') return (via === 'bearer' || via === 'principal') ? 'allow' : 'deny';
  if (cls === 'bearer') return (mode === 'read' && via === 'bearer') ? 'allow' : 'deny';
  return 'deny'; // rules (own ops), never, unknown
}

function _check(key) { if (!ALLOWED_KEYS[key]) throw new Error('vale key not allowed: ' + key); }

async function getVale(key) {
  _check(key);
  return storage.getState(_key(key));
}

// Use when "read failed" must not look like "empty" (token, rules, brief log).
async function getValeWithMeta(key) {
  _check(key);
  return storage.getStateWithMeta(_key(key));
}

async function setVale(key, value) {
  _check(key);
  return storage.setState(_key(key), value);
}

// ETag-guarded read-modify-write; refuses to write over a failed read.
async function mutateVale(key, mutator, opts) {
  _check(key);
  return storage.mutateState(_key(key), mutator, opts);
}

module.exports = { getVale, getValeWithMeta, setVale, mutateVale, keyClass, accessFor, ALLOWED_KEYS, KEY_CLASS, _key };
