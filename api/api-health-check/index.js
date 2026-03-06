// api-health-check — GET: Live health check for external API endpoints
// Pings each endpoint server-side (avoids CORS), returns status + latency

const https = require('https');
const http = require('http');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const ENDPOINTS = [
  { id: 'gemini',      name: 'Gemini API',           url: 'https://generativelanguage.googleapis.com/',                         method: 'GET', expect: [200, 404] },
  { id: 'azure_blob',  name: 'Azure Blob Storage',   url: 'https://cardforgeblobdata.blob.core.windows.net/?comp=list',        method: 'GET', expect: [200, 400, 403, 404, 409] },
  { id: 'azure_func',  name: 'Azure Functions',       url: 'https://ambientpixels-nova-api.azurewebsites.net/api/company-state?key=_ping', method: 'GET', expect: [200, 404] },
  { id: 'x_api',       name: 'X (Twitter) API',      url: 'https://api.x.com/2/openapi.json',                                  method: 'GET', expect: [200, 401, 403] },
  { id: 'linkedin',    name: 'LinkedIn API',          url: 'https://api.linkedin.com/v2/me',                                    method: 'GET', expect: [200, 401, 403, 404] },
  { id: 'bluesky',     name: 'Bluesky API',            url: 'https://bsky.social/xrpc/com.atproto.server.describeServer',        method: 'GET', expect: [200] },
  { id: 'brave',       name: 'Brave Search',           url: 'https://api.search.brave.com/res/v1/web/search',                    method: 'GET', expect: [200, 401, 422] },
  { id: 'stripe',      name: 'Stripe API',             url: 'https://api.stripe.com/v1',                                         method: 'GET', expect: [200, 401, 404] },
  { id: 'appinsights', name: 'App Insights',            url: 'https://api.applicationinsights.io/v1/apps',                        method: 'GET', expect: [200, 401, 404] },
  { id: 'github',      name: 'GitHub API',            url: 'https://api.github.com/',                                           method: 'GET', expect: [200, 403] }
];

const TIMEOUT_MS = 8000;

function ping(endpoint) {
  return new Promise(function (resolve) {
    const start = Date.now();
    const proto = endpoint.url.startsWith('https') ? https : http;

    const req = proto.get(endpoint.url, { timeout: TIMEOUT_MS }, function (res) {
      const latencyMs = Date.now() - start;
      const reachable = endpoint.expect.indexOf(res.statusCode) !== -1;
      res.resume(); // drain response
      resolve({
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        status: res.statusCode,
        reachable: reachable,
        latencyMs: latencyMs
      });
    });

    req.on('error', function () {
      resolve({
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        status: 0,
        reachable: false,
        latencyMs: null
      });
    });

    req.on('timeout', function () {
      req.destroy();
      resolve({
        id: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        status: 0,
        reachable: false,
        latencyMs: TIMEOUT_MS
      });
    });
  });
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  try {
    const results = await Promise.all(ENDPOINTS.map(ping));
    const reachableCount = results.filter(function (r) { return r.reachable; }).length;

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        ok: true,
        apiVersion: '2026-03-06i',
        checkedAt: new Date().toISOString(),
        summary: { total: results.length, reachable: reachableCount, down: results.length - reachableCount },
        endpoints: results
      }
    };
  } catch (err) {
    context.log.error('[api-health-check] Error:', err.message);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { ok: false, error: err.message }
    };
  }
};
