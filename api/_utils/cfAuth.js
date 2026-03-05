// cfAuth.js — Shared auth extraction for CardForge endpoints

function extractUserInfo(req, context) {
  const principalHeader = req.headers['x-ms-client-principal'] || req.headers['x-cf-auth-principal'];
  if (principalHeader) {
    try {
      const decoded = Buffer.from(principalHeader, 'base64').toString('utf8');
      const clientPrincipal = JSON.parse(decoded);
      const userId = clientPrincipal.userId || 'anonymous';
      const claims = clientPrincipal.claims || clientPrincipal.userClaims || [];
      const emailClaim = claims.find(c => c.typ === 'emails' || c.typ === 'email');
      const email = emailClaim ? emailClaim.val : (clientPrincipal.userDetails || null);
      return { userId, email, isAuthenticated: userId !== 'anonymous', principal: clientPrincipal };
    } catch (err) {
      if (context && context.log && typeof context.log.warn === 'function') {
        context.log.warn('Failed to parse client principal: ' + err.message);
      }
    }
  }

  const principalId = req.headers['x-ms-client-principal-id'];
  if (principalId && principalId !== 'anonymous') {
    return { userId: principalId, email: null, isAuthenticated: true, principal: null };
  }

  // Dev fallback
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) {
      return { userId: devUserId, email: null, isAuthenticated: true, principal: null };
    }
  }

  return { userId: 'anonymous', email: null, isAuthenticated: false, principal: null };
}

module.exports = { extractUserInfo };
