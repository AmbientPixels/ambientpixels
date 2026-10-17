// tokenCrypto.js — AES-256-GCM box for Vale's stored Microsoft refresh token.
// Key: VALE_TOKEN_KEY, 32 random bytes base64 (Function App setting, never committed).
// A blob reader without the key sees only {v, iv, tag, ct}; a tampered box fails to open.
'use strict';

var crypto = require('crypto');

function _key(keyB64) {
  var k = Buffer.from(String(keyB64 || ''), 'base64');
  if (k.length !== 32) throw new Error('VALE_TOKEN_KEY must be 32 bytes (base64)');
  return k;
}

function isValidKey(keyB64) {
  try { _key(keyB64); return true; } catch (e) { return false; }
}

function encrypt(plaintext, keyB64) {
  var iv = crypto.randomBytes(12);
  var c = crypto.createCipheriv('aes-256-gcm', _key(keyB64), iv);
  var ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function decrypt(box, keyB64) {
  if (!box || box.v !== 1 || !box.iv || !box.tag || !box.ct) throw new Error('unsupported token box');
  var d = crypto.createDecipheriv('aes-256-gcm', _key(keyB64), Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString('utf8');
}

module.exports = { encrypt: encrypt, decrypt: decrypt, isValidKey: isValidKey };
