// pixel-agent-run — Public agent execution endpoint (Claude API)
// POST /api/pixel-agent-run { agentId, input }

const fetch = require('node-fetch');
const crypto = require('crypto');
const storage = require('../_utils/companyStorage');
const path = require('path');
const fs = require('fs');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const RATE_LIMIT_PER_DAY = 3;

// Load agent registry at cold start
let agentRegistry = null;
function loadAgentRegistry() {
  if (agentRegistry) return agentRegistry;
  const filePath = path.join(__dirname, '..', '_data', 'pixel-agents.json');
  agentRegistry = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return agentRegistry;
}

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip || 'unknown').digest('hex').substring(0, 16);
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.headers['client-ip']
    || 'unknown';
}

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

module.exports = async function (context, req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: corsHeaders, body: '' };
    return;
  }

  if (!ANTHROPIC_API_KEY) {
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Pixel Agents offline — API key not configured.' }
    };
    return;
  }

  try {
    const body = req.body || {};
    const { agentId, input } = body;

    // Validate agent
    const agents = loadAgentRegistry();
    const agent = agents.find(a => a.id === agentId && a.active);

    if (!agent) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: {
          error: 'Unknown or inactive agent: ' + (agentId || 'none'),
          availableAgents: agents.filter(a => a.active).map(a => a.id)
        }
      };
      return;
    }

    // Validate input
    if (!input || !input.trim()) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: { error: 'No input provided.' }
      };
      return;
    }

    // URL validation for url-type agents
    if (agent.inputValidation === 'url') {
      try {
        new URL(input.trim());
      } catch {
        context.res = {
          status: 400,
          headers: corsHeaders,
          body: { error: 'Invalid URL. Please enter a valid website URL.' }
        };
        return;
      }
    }

    // Rate limiting (IP-based, per day) — skip for authenticated users
    const isAuthed = req.headers['x-company-secret'] === 'pixelpusher';
    const clientIP = getClientIP(req);
    const ipHash = hashIP(clientIP);
    const today = todayKey();
    let rateLimits = {};
    let userRuns = 0;

    if (!isAuthed) {
      try {
        rateLimits = (await storage.getState('pixelAgentRateLimits')) || {};
      } catch { rateLimits = {}; }

      const userKey = ipHash + '_' + today;
      userRuns = rateLimits[userKey] || 0;

      const cost = agent.rateLimitCost || 1;
      if (userRuns + cost > RATE_LIMIT_PER_DAY) {
        context.res = {
          status: 429,
          headers: corsHeaders,
          body: {
            error: 'Daily limit reached',
            message: `You've used all ${RATE_LIMIT_PER_DAY} free runs for today. Come back tomorrow!`,
            remaining: 0
          }
        };
        return;
      }
    }

    // Web search enrichment (for agents that need live data)
    let searchContext = '';
    if (agent.webSearch) {
      try {
        const { searchInternal } = require('../toolsWebSearch');
        const queries = agent.searchConfig?.queries
          ? agent.searchConfig.queries.map(q => q.replace('{{input}}', input.trim()))
          : [input.trim()];
        const maxResults = agent.searchConfig?.maxResults || 5;

        const allResults = [];
        for (const q of queries) {
          const searchResult = await searchInternal(q, maxResults, 'pixel-agent-' + agentId, context);
          if (searchResult.ok && searchResult.results.length > 0) {
            allResults.push(...searchResult.results);
          }
        }

        if (allResults.length > 0) {
          searchContext = '\n\n--- LIVE WEB SEARCH RESULTS ---\n' +
            allResults.map((r, i) => (i + 1) + '. ' + r.title + '\n   ' + r.url + '\n   ' + r.snippet).join('\n\n') +
            '\n--- END SEARCH RESULTS ---\n';
          context.log('[PixelAgentRun] Web search returned ' + allResults.length + ' results for ' + queries.length + ' queries');
        }
      } catch (searchErr) {
        context.log.warn('[PixelAgentRun] Web search failed (non-fatal):', searchErr.message);
      }
    }

    // URL content fetching (for agents that analyze actual site content)
    let siteContext = '';
    if (agent.fetchUrl && agent.inputValidation === 'url') {
      try {
        const nodeFetch = require('node-fetch');
        const targetUrl = input.trim();
        context.log('[PixelAgentRun] Fetching URL:', targetUrl);

        const siteRes = await nodeFetch(targetUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PixelAgents/1.0; +https://ambientpixels.ai)',
            'Accept': 'text/html'
          },
          redirect: 'follow'
        });

        if (siteRes.ok) {
          let html = await siteRes.text();

          // Strip scripts, styles, comments, and SVG
          html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
          html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
          html = html.replace(/<svg[\s\S]*?<\/svg>/gi, '');
          html = html.replace(/<!--[\s\S]*?-->/g, '');

          // Extract title
          const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const pageTitle = titleMatch ? titleMatch[1].trim() : '';

          // Extract meta description
          const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
          const metaDesc = metaMatch ? metaMatch[1].trim() : '';

          // Strip remaining HTML tags, normalize whitespace
          let text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

          // Truncate to ~4000 chars to keep prompt reasonable
          if (text.length > 4000) text = text.substring(0, 4000) + '...';

          siteContext = '\n\n--- SITE CONTENT FROM ' + targetUrl + ' ---\n' +
            (pageTitle ? 'Title: ' + pageTitle + '\n' : '') +
            (metaDesc ? 'Meta Description: ' + metaDesc + '\n' : '') +
            'Content:\n' + text +
            '\n--- END SITE CONTENT ---\n';

          context.log('[PixelAgentRun] Fetched site content: ' + text.length + ' chars');
        } else {
          context.log.warn('[PixelAgentRun] Site fetch returned ' + siteRes.status);
          siteContext = '\n\n[Note: Could not fetch site content — HTTP ' + siteRes.status + ']\n';
        }
      } catch (fetchErr) {
        context.log.warn('[PixelAgentRun] URL fetch failed (non-fatal):', fetchErr.message);
        siteContext = '\n\n[Note: Could not fetch site content — ' + fetchErr.message + ']\n';
      }
    }

    // Build prompt
    const userMessage = agent.userPromptTemplate.replace('{{input}}', input.trim()) + searchContext + siteContext;

    // Call Claude API
    context.log('[PixelAgentRun] Agent:', agentId, 'Input:', input.substring(0, 100));

    const claudeBody = {
      model: MODEL,
      max_tokens: agent.generationConfig?.maxOutputTokens || 1500,
      temperature: agent.generationConfig?.temperature || 0.8,
      system: agent.systemPrompt,
      messages: [
        { role: 'user', content: userMessage }
      ]
    };

    const apiRes = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(claudeBody)
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      context.log.error('[PixelAgentRun] Claude API error:', apiRes.status, JSON.stringify(data));
      context.res = {
        status: 502,
        headers: corsHeaders,
        body: { error: agent.name + ' encountered a system fault. Try again.' }
      };
      return;
    }

    const rawText = data?.content?.[0]?.text || '';

    // Parse structured JSON response
    let result = null;
    try {
      // Strip markdown code fences if present
      let cleaned = rawText.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      }
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      context.log.warn('[PixelAgentRun] JSON parse failed, returning raw text');
      result = { raw: rawText };
    }

    // Image generation for hybrid agents (Claude analysis + Gemini image)
    if (agent.imageGeneration && result && !result.raw) {
      try {
        const imageEngine = require('../_lib/contentEngine/imageEngine');

        const preset = imageEngine.VALID_PRESETS.indexOf(result.preset) !== -1
          ? result.preset : 'ap-neon-glass';

        const imgOpts = {
          topic: (agent.imageConfig?.topicPrefix || '') + input.substring(0, 200),
          goal: result.image_prompt || 'Generate a brand visual identity',
          preset: preset,
          outputType: agent.imageConfig?.outputType || 'square_image'
        };

        context.log('[PixelAgentRun] Image generation — preset:', preset, 'output:', imgOpts.outputType);
        const imgResult = await imageEngine.generateImage(imgOpts);
        result.image_url = imgResult.imageUrl;
        context.log('[PixelAgentRun] Image generated:', imgResult.imageUrl);
      } catch (imgErr) {
        context.log.error('[PixelAgentRun] Image generation failed:', imgErr.message);
        result.image_url = null;
      }
    }

    // Generate run ID
    const runId = 'run-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');

    // Update rate limit (skip for authenticated users)
    if (!isAuthed) {
      const userKey = ipHash + '_' + today;
      rateLimits[userKey] = userRuns + (agent.rateLimitCost || 1);
      // Clean old entries (keep only today's)
      for (const key of Object.keys(rateLimits)) {
        if (!key.endsWith('_' + today)) delete rateLimits[key];
      }
      storage.setState('pixelAgentRateLimits', rateLimits).catch(() => {});
    }

    // Store run result for share URLs
    const runRecord = {
      runId,
      agentId: agent.id,
      agentName: agent.name,
      agentIcon: agent.icon,
      agentTier: agent.tier,
      input: input.substring(0, 500),
      result,
      timestamp: new Date().toISOString()
    };

    // Store run (append to runs list, cap at 1000)
    try {
      let runs = (await storage.getState('pixelAgentRuns')) || [];
      runs.push(runRecord);
      if (runs.length > 1000) runs = runs.slice(-1000);
      await storage.setState('pixelAgentRuns', runs);
    } catch { /* non-fatal */ }

    // Update usage stats
    try {
      let stats = (await storage.getState('pixelAgentStats')) || {};
      stats[agentId] = (stats[agentId] || 0) + 1;
      stats._totalRuns = (stats._totalRuns || 0) + 1;
      await storage.setState('pixelAgentStats', stats);
    } catch { /* non-fatal */ }

    // Log token usage to Claude cost tracking
    const usage = data?.usage;
    if (usage) {
      context.log('[PixelAgentRun] Tokens — input:', usage.input_tokens, 'output:', usage.output_tokens);
      storage.logClaudeUsage({
        caller: 'pixel-agent-run',
        model: MODEL,
        agentId: agent.id,
        promptTokens: usage.input_tokens || 0,
        completionTokens: usage.output_tokens || 0,
        totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
      }).catch(() => {});
    }

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: {
        success: true,
        agentId: agent.id,
        agentName: agent.name,
        agentTier: agent.tier,
        result,
        raw: rawText,
        runId,
        timestamp: runRecord.timestamp,
        remaining: Math.max(0, RATE_LIMIT_PER_DAY - userRuns - (agent.rateLimitCost || 1)),
        shareUrl: '/pixel-agents/share.html?run=' + runId
      }
    };

  } catch (err) {
    context.log.error('[PixelAgentRun] Unexpected error:', err.message, err.stack);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: 'Something went wrong. Please try again.' }
    };
  }
};
