// valeAuth.js — CEO-only gate for Vale endpoints. Decodes the SWA/B2C principal via the
// shared cfAuth helper and checks the email against the CEO_EMAILS allowlist (or a ceo/
// admin role). Never uses the shared x-company-secret and never fails open.
'use strict';

var { extractUserInfo } = require('./cfAuth');

function parseCeoAllowlist(envVal) {
  return String(envVal || '')
    .split(',')
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);
}

function isCeo(userInfo, allowlist) {
  if (!userInfo || !userInfo.isAuthenticated) return false;
  var email = (userInfo.email || '').toLowerCase();
  if (email && allowlist.indexOf(email) !== -1) return true;
  var roles = (userInfo.principal && (userInfo.principal.userRoles || [])) || [];
  return roles.indexOf('ceo') !== -1 || roles.indexOf('admin') !== -1;
}

// I/O wrapper: reads CEO_EMAILS from env, extracts the principal, returns {ok, userInfo}.
function requireCeo(req, context) {
  var allow = parseCeoAllowlist(process.env.CEO_EMAILS);
  var userInfo = extractUserInfo(req, context);
  return { ok: isCeo(userInfo, allow), userInfo: userInfo };
}

module.exports = { parseCeoAllowlist, isCeo, requireCeo };
