// valeStorage.js — isolated accessor for Vale's CEO-only personal state. Every key is
// stored under a 'vale/' blob path so it can never collide with company-state's
// <key>.json rooting, and NONE of these keys are in company-state's VALID_KEYS — so they
// are unreachable via the anonymous /api/company-state surface. This is the privacy seam.
'use strict';

var storage = require('./companyStorage');

var ALLOWED_KEYS = {
  valeSeed: 1,          // CEO-authored onboarding knowledge (durable)
  valeMemory: 1,        // earned memories (typed, TTL'd)
  valeConversations: 1, // chat ring buffer
  valeBriefs: 1,        // brief history
  ceoActionList: 1,     // CEO manual to-dos
  ceoProfile: 1         // stub now; Career agent fills later
};

function _key(key) { return 'vale/' + key; }

async function getVale(key) {
  if (!ALLOWED_KEYS[key]) throw new Error('vale key not allowed: ' + key);
  return storage.getState(_key(key));
}

async function setVale(key, value) {
  if (!ALLOWED_KEYS[key]) throw new Error('vale key not allowed: ' + key);
  return storage.setState(_key(key), value);
}

module.exports = { getVale, setVale, ALLOWED_KEYS, _key };
