// contentIndex — GET /api/content-index
// Reads content-engine/index.json from Blob, returns filtered results.
// Query params: ?limit=200&preset=ap-neon-glass&status=success

const storage = require('../_utils/companyStorage');
const imageEngine = require('../_lib/contentEngine/imageEngine');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

module.exports = async function (context, req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    context.res = {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal'
      }
    };
    return;
  }

  // Auth
  var secret = (req.headers && req.headers['x-company-secret']) || '';
  var clientPrincipal = (req.headers && req.headers['x-ms-client-principal']) || '';
  if (!storage.validateSecret(secret) && !clientPrincipal) {
    context.res = { status: 403, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
    return;
  }

  try {
    // Read index.json from blob
    var sdk = require('@azure/storage-blob');
    var connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connStr) {
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true, count: 0, results: [] }) };
      return;
    }

    var client = sdk.BlobServiceClient.fromConnectionString(connStr);
    var container = client.getContainerClient('company-state');
    var blob = container.getBlockBlobClient('content-engine/index.json');

    var index = [];
    try {
      var download = await blob.download(0);
      var chunks = [];
      for await (var chunk of download.readableStreamBody) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      var body = Buffer.concat(chunks).toString('utf8');
      index = JSON.parse(body);
      if (!Array.isArray(index)) index = [];
    } catch (e) {
      // index.json doesn't exist yet — return empty
      context.log('[contentIndex] index.json not found or empty, returning []');
      context.res = { status: 200, headers: CORS, body: JSON.stringify({ ok: true, count: 0, results: [] }) };
      return;
    }

    // Query params
    var query = req.query || {};
    var limitParam = Math.min(Math.max(parseInt(query.limit) || 200, 1), 500);
    var presetFilter = (query.preset || '').trim() || null;
    var statusFilter = (query.status || '').trim() || null;

    // Filter in-memory
    var results = index;
    if (presetFilter) {
      results = results.filter(function (e) { return e.preset === presetFilter; });
    }
    if (statusFilter) {
      results = results.filter(function (e) { return e.status === statusFilter; });
    }

    // Most recent first
    results.reverse();

    // Apply limit
    if (results.length > limitParam) {
      results = results.slice(0, limitParam);
    }

    context.res = {
      status: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        count: results.length,
        results: results
      })
    };

  } catch (err) {
    context.log.error('[contentIndex] Error:', err);
    context.res = {
      status: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Internal error: ' + (err.message || String(err)) })
    };
  }
};
