// linkedinTest — POST /api/linkedin-test
// Diagnostic endpoint for testing LinkedIn org-page posting.
// Validates token, checks org ACL, optionally posts a minimal test.
// Protected by x-company-secret header (same as company-state).

const https = require('https');
const storage = require('../_utils/companyStorage');

const ORG_ID = process.env.LINKEDIN_ORG_ID || '107826087';
const AUTHOR_URN = 'urn:li:organization:' + ORG_ID;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal'
      }
    };
    return;
  }

  // Auth: require x-company-secret or Azure SWA principal
  const secret = (req.headers && req.headers['x-company-secret']) || '';
  const clientPrincipal = (req.headers && req.headers['x-ms-client-principal']) || '';
  const isAuthenticated = !!clientPrincipal;
  if (!storage.validateSecret(secret) && !isAuthenticated) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: 'Unauthorized. Provide x-company-secret header or be logged in via Azure SWA.' }) };
    return;
  }

  const body = req.body || {};
  const dryRun = body.dryRun !== false; // default: true (safe)
  const testText = body.text || 'Test post from AmbientPixels API integration. [' + new Date().toISOString() + ']';
  const token = process.env.LINKEDIN_ACCESS_TOKEN || '';

  const diagnostics = {
    timestamp: new Date().toISOString(),
    orgId: ORG_ID,
    authorUrn: AUTHOR_URN,
    dryRun: dryRun,
    steps: []
  };

  // ─── Step 1: Token present? ───
  if (!token) {
    diagnostics.steps.push({ step: 'token-check', status: 'FAIL', error: 'LINKEDIN_ACCESS_TOKEN env var is not set.' });
    context.res = { status: 200, headers: CORS, body: JSON.stringify(diagnostics) };
    return;
  }
  diagnostics.steps.push({ step: 'token-check', status: 'PASS', detail: 'Token is set (' + token.length + ' chars)' });

  // ─── Step 2: Token validity via /v2/userinfo ───
  try {
    const userinfo = await _httpGet('api.linkedin.com', '/v2/userinfo', token, {});
    if (userinfo.statusCode === 200) {
      const data = _safeParse(userinfo.body);
      diagnostics.steps.push({ step: 'token-validity', status: 'PASS', detail: 'Token is valid. User: ' + (data.name || data.sub || 'unknown') });
    } else if (userinfo.statusCode === 401) {
      diagnostics.steps.push({ step: 'token-validity', status: 'FAIL', error: 'Token expired or revoked (401). Generate a new token at https://www.linkedin.com/developers/apps' });
      context.res = { status: 200, headers: CORS, body: JSON.stringify(diagnostics) };
      return;
    } else if (userinfo.statusCode === 403) {
      diagnostics.steps.push({ step: 'token-validity', status: 'WARN', detail: 'Token alive but lacks openid scope (403 on /v2/userinfo). OK for posting.' });
    } else {
      diagnostics.steps.push({ step: 'token-validity', status: 'WARN', detail: '/v2/userinfo returned HTTP ' + userinfo.statusCode + '. Proceeding.' });
    }
  } catch (err) {
    diagnostics.steps.push({ step: 'token-validity', status: 'WARN', error: 'Network error on /v2/userinfo: ' + err.message + '. Proceeding.' });
  }

  // ─── Step 3: Org ACL check ───
  try {
    const aclPath = '/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organizationalTarget,role,state))';
    const acl = await _httpGet('api.linkedin.com', aclPath, token, { 'X-Restli-Protocol-Version': '2.0.0' });

    if (acl.statusCode === 200) {
      const data = _safeParse(acl.body);
      const elements = (data && data.elements) || [];
      const orgUrn = 'urn:li:organization:' + ORG_ID;
      const match = elements.find(function (e) { return e.organizationalTarget === orgUrn; });

      if (match) {
        diagnostics.steps.push({
          step: 'org-acl',
          status: 'PASS',
          detail: 'Token owner IS an admin of org ' + ORG_ID,
          role: match.role || 'ADMINISTRATOR',
          state: match.state || 'APPROVED'
        });
      } else {
        diagnostics.steps.push({
          step: 'org-acl',
          status: 'FAIL',
          error: 'Token owner is NOT an admin of org ' + ORG_ID + '. Found ' + elements.length + ' org(s) but none match.',
          orgsFound: elements.map(function (e) { return e.organizationalTarget; }),
          fix: 'The LinkedIn account that generated this token must be a Page Admin on https://www.linkedin.com/company/' + ORG_ID + '/admin/'
        });
      }
    } else if (acl.statusCode === 403) {
      diagnostics.steps.push({
        step: 'org-acl',
        status: 'FAIL',
        error: '403 on organizationAcls — token missing w_organization_social or r_organization_admin scope.',
        fix: 'Go to https://www.linkedin.com/developers/apps → your app → Products → request "Advertising API". Then re-generate token with w_organization_social scope.',
        rawBody: acl.body.substring(0, 300)
      });
    } else {
      diagnostics.steps.push({
        step: 'org-acl',
        status: 'WARN',
        detail: 'organizationAcls returned HTTP ' + acl.statusCode,
        rawBody: acl.body.substring(0, 300)
      });
    }
  } catch (err) {
    diagnostics.steps.push({ step: 'org-acl', status: 'WARN', error: 'Network error: ' + err.message });
  }

  // ─── Step 4: Scope introspection via /v2/introspectToken (best-effort) ───
  try {
    const introPath = '/v2/introspectToken';
    const introBody = 'token=' + encodeURIComponent(token);
    const intro = await _httpPost('api.linkedin.com', introPath, introBody, token, {
      'Content-Type': 'application/x-www-form-urlencoded'
    });
    if (intro.statusCode === 200) {
      const data = _safeParse(intro.body);
      diagnostics.steps.push({
        step: 'scope-introspection',
        status: 'INFO',
        scopes: data.scope || 'unknown',
        active: data.active,
        expiresIn: data.expires_in || null
      });
    } else {
      diagnostics.steps.push({
        step: 'scope-introspection',
        status: 'SKIP',
        detail: 'introspectToken returned HTTP ' + intro.statusCode + ' (may require client credentials). Not critical.'
      });
    }
  } catch (err) {
    diagnostics.steps.push({ step: 'scope-introspection', status: 'SKIP', detail: 'introspectToken unavailable: ' + err.message });
  }

  // ─── Step 5: Post attempt (if dryRun=false) ───
  if (dryRun) {
    diagnostics.steps.push({
      step: 'post-attempt',
      status: 'SKIPPED',
      detail: 'dryRun=true (default). Set { "dryRun": false } in request body to actually post.',
      wouldPost: {
        endpoint: '/v2/ugcPosts',
        author: AUTHOR_URN,
        text: testText.substring(0, 80) + (testText.length > 80 ? '...' : '')
      }
    });
  } else {
    try {
      const ugcPayload = JSON.stringify({
        author: AUTHOR_URN,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: testText },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
      });

      const post = await _httpPost('api.linkedin.com', '/v2/ugcPosts', ugcPayload, token, {
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0'
      });

      if (post.statusCode === 201) {
        const data = _safeParse(post.body);
        const postUrn = (data && data.id) || post.headers['x-restli-id'] || '';
        diagnostics.steps.push({
          step: 'post-attempt',
          status: 'SUCCESS',
          detail: 'Post published to org page!',
          postUrn: postUrn,
          postUrl: postUrn ? 'https://www.linkedin.com/feed/update/' + postUrn : '',
          statusCode: 201
        });
      } else if (post.statusCode === 403) {
        const data = _safeParse(post.body);
        diagnostics.steps.push({
          step: 'post-attempt',
          status: 'FAIL',
          statusCode: 403,
          error: (data && data.message) || post.body.substring(0, 300),
          fix: 'Token missing w_organization_social scope OR token owner is not a Page Admin on org ' + ORG_ID + '.'
        });
      } else {
        diagnostics.steps.push({
          step: 'post-attempt',
          status: 'FAIL',
          statusCode: post.statusCode,
          error: post.body.substring(0, 500)
        });
      }
    } catch (err) {
      diagnostics.steps.push({ step: 'post-attempt', status: 'FAIL', error: 'Network error: ' + err.message });
    }
  }

  // ─── Summary ───
  const fails = diagnostics.steps.filter(function (s) { return s.status === 'FAIL'; });
  diagnostics.summary = {
    totalSteps: diagnostics.steps.length,
    passed: diagnostics.steps.filter(function (s) { return s.status === 'PASS' || s.status === 'SUCCESS'; }).length,
    failed: fails.length,
    warnings: diagnostics.steps.filter(function (s) { return s.status === 'WARN'; }).length,
    verdict: fails.length === 0 ? 'ALL CHECKS PASSED' : 'ISSUES FOUND — see failed steps'
  };

  context.log('[linkedinTest] Diagnostics:', JSON.stringify(diagnostics, null, 2));
  context.res = { status: 200, headers: CORS, body: JSON.stringify(diagnostics, null, 2) };
};

// ─── HTTP helpers (no dependencies) ───

function _httpGet(hostname, path, token, extraHeaders) {
  return new Promise(function (resolve, reject) {
    var headers = Object.assign({ 'Authorization': 'Bearer ' + token }, extraHeaders || {});
    var opts = { hostname: hostname, path: path, method: 'GET', headers: headers };
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ statusCode: res.statusCode, body: data, headers: res.headers }); });
    });
    req.on('error', reject);
    req.setTimeout(10000, function () { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function _httpPost(hostname, path, body, token, extraHeaders) {
  return new Promise(function (resolve, reject) {
    var headers = Object.assign({
      'Authorization': 'Bearer ' + token,
      'Content-Length': Buffer.byteLength(body)
    }, extraHeaders || {});
    var opts = { hostname: hostname, path: path, method: 'POST', headers: headers };
    var req = https.request(opts, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () { resolve({ statusCode: res.statusCode, body: data, headers: res.headers }); });
    });
    req.on('error', reject);
    req.setTimeout(15000, function () { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function _safeParse(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}
