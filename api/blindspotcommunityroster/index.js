const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=60'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS };
    return;
  }
  context.res = {
    status: 200,
    headers: CORS_HEADERS,
    body: {
      ok: true,
      asOf: new Date().toISOString(),
      window: 'week',
      total: 0,
      nextCursor: null,
      players: []
    }
  };
};
