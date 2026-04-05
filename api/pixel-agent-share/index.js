// pixel-agent-share — Returns HTML page with OG meta tags for social link unfurling
// GET /api/pixel-agent-share?run=RUNID

const storage = require('../_utils/companyStorage');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  const runId = req.query.run;
  if (!runId) {
    context.res = { status: 302, headers: { Location: '/pixel-agents/' }, body: '' };
    return;
  }

  try {
    const runs = (await storage.getState('pixelAgentRuns')) || [];
    const run = runs.find(r => r.runId === runId);

    if (!run) {
      context.res = { status: 302, headers: { Location: '/pixel-agents/' }, body: '' };
      return;
    }

    const result = run.result || {};
    const score = result.score ?? result.overall_score ?? null;
    const verdict = result.verdict ?? result.overall_verdict ?? null;

    const title = (run.agentName || 'Agent') + ' Result \u2014 Pixel Agents';
    let description = 'AI agent result from Pixel Agents';
    if (score !== null && verdict) {
      description = 'Score: ' + Math.round(Number(score)) + '/100 \u2014 "' + String(verdict).substring(0, 120) + '"';
    } else if (score !== null) {
      description = 'Score: ' + Math.round(Number(score)) + '/100';
    } else if (verdict) {
      description = '"' + String(verdict).substring(0, 150) + '"';
    }

    const imageUrl = 'https://ambientpixels-nova-api.azurewebsites.net/api/pixel-agent-share-card?run=' + encodeURIComponent(runId);
    const agentUrl = 'https://ambientpixels.ai/pixel-agents/run.html?agent=' + encodeURIComponent(run.agentId);

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    const html = '<!DOCTYPE html>\n' +
      '<html lang="en">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>' + esc(title) + '</title>\n' +
      '<meta property="og:type" content="website">\n' +
      '<meta property="og:title" content="' + esc(title) + '">\n' +
      '<meta property="og:description" content="' + esc(description) + '">\n' +
      '<meta property="og:image" content="' + esc(imageUrl) + '">\n' +
      '<meta property="og:image:width" content="1200">\n' +
      '<meta property="og:image:height" content="630">\n' +
      '<meta property="og:url" content="' + esc(agentUrl) + '">\n' +
      '<meta name="twitter:card" content="summary_large_image">\n' +
      '<meta name="twitter:title" content="' + esc(title) + '">\n' +
      '<meta name="twitter:description" content="' + esc(description) + '">\n' +
      '<meta name="twitter:image" content="' + esc(imageUrl) + '">\n' +
      '<meta http-equiv="refresh" content="0;url=' + esc(agentUrl) + '">\n' +
      '</head>\n<body>\n' +
      '<p>Redirecting to <a href="' + esc(agentUrl) + '">' + esc(run.agentName || 'Pixel Agents') + '</a>...</p>\n' +
      '</body>\n</html>';

    context.res = {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      },
      body: html
    };

  } catch (err) {
    context.log.error('[Share] Error:', err.message);
    context.res = { status: 302, headers: { Location: '/pixel-agents/' }, body: '' };
  }
};
