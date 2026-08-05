// Shared CEO-secret check for endpoints that gate on `x-company-secret`.
//
// Why this exists: 18 endpoints used to compare the header against a hardcoded
// 'pixelpusher' literal, bypassing storage.validateSecret() entirely. The repo is
// public, so that literal was never a credential. They now all route through here.
//
// The presence check is load-bearing. storage.validateSecret() returns true when
// COMPANY_WRITE_SECRET is unset (fail-open, which is the documented rollback path).
// Without `!!headerValue`, unsetting that variable would grant CEO rights to callers
// sending no credential at all -- on payout runs, promo minting, and agent approval.
// Requiring a non-empty header keeps rollback at "open to anyone who knows the
// secret" rather than "open to everyone, silently".
const storage = require('./companyStorage');

function isValidCeoSecret(headerValue) {
  return !!headerValue && storage.validateSecret(headerValue);
}

module.exports = { isValidCeoSecret };
