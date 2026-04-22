// healthz — public read-only liveness probe for the keep-alive pinger.
// No auth, no side effects, no state reads. Target: <100ms warm.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  context.res = {
    status: 200,
    headers: corsHeaders,
    body: {
      ok: true,
      ts: new Date().toISOString(),
      app: 'ambientpixels-nova-api'
    }
  };
};
