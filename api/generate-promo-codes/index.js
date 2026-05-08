// generate-promo-codes — CEO-only endpoint to mint redemption codes.
// POST /api/generate-promo-codes
//   { count, campaign, grant_type, expires_in_days? }
//
// Auth: x-company-secret: pixelpusher
// expires_in_days defaults to 30. Pass null explicitly for never-expires.

const crypto = require('crypto');
const promo = require('../_lib/promo-codes');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret'
};

// Base32-style alphabet — no I/O/0/1 to avoid visual confusion when reading codes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SUPPORTED_GRANTS = new Set(['founder_flag']);

function randomChar() {
  return ALPHABET[crypto.randomBytes(1)[0] % ALPHABET.length];
}

function randomSegment(len) {
  let out = '';
  for (let i = 0; i < len; i++) out += randomChar();
  return out;
}

function generateCode() {
  return 'FOUNDER-' + randomSegment(4) + '-' + randomSegment(4);
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  if (req.headers['x-company-secret'] !== 'pixelpusher') {
    context.res = { status: 403, headers: CORS_HEADERS, body: { error: 'CEO access required' } };
    return;
  }

  const body = req.body || {};
  const count = Math.max(1, Math.min(500, parseInt(body.count, 10) || 0));
  const campaign = String(body.campaign || '').trim() || 'default';
  const grantType = String(body.grant_type || 'founder_flag');

  if (!count) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'count must be a positive integer' } };
    return;
  }
  if (!SUPPORTED_GRANTS.has(grantType)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'unsupported grant_type', supported: Array.from(SUPPORTED_GRANTS) } };
    return;
  }

  let expiresAt = null;
  if (body.expires_in_days === null) {
    expiresAt = null;
  } else {
    const days = body.expires_in_days == null ? 30 : Number(body.expires_in_days);
    if (!isFinite(days) || days < 0) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'expires_in_days must be a non-negative number, null, or omitted' } };
      return;
    }
    expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  }

  try {
    const record = await promo.loadCodes();
    const existing = new Set((record.codes || []).map(function (c) { return String(c.code).toUpperCase(); }));

    const created = [];
    let collisions = 0;
    const MAX_COLLISIONS = count * 10;

    while (created.length < count) {
      const code = generateCode();
      if (existing.has(code)) {
        collisions++;
        if (collisions > MAX_COLLISIONS) {
          context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'too many code collisions; alphabet space may be exhausted' } };
          return;
        }
        continue;
      }
      existing.add(code);
      const entry = {
        code,
        status: 'unredeemed',
        grant: { type: grantType },
        campaign,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
        redeemed_by: null,
        redeemed_at: null
      };
      record.codes.push(entry);
      created.push(entry);
    }

    const ok = await promo.saveCodes(record);
    if (!ok) {
      context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'failed to persist codes' } };
      return;
    }

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        success: true,
        generated: created.length,
        campaign,
        grant_type: grantType,
        expires_at: expiresAt,
        codes: created.map(function (c) {
          return { code: c.code, expires_at: c.expires_at, campaign: c.campaign };
        })
      }
    };
  } catch (err) {
    context.log.error('[generate-promo-codes] ' + err.message);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'internal error: ' + err.message } };
  }
};
