// pixel-agent-run — Public agent execution endpoint (Claude API)
// POST /api/pixel-agent-run { agentId, input }

const fetch = require('node-fetch');
const crypto = require('crypto');
const storage = require('../_utils/companyStorage');
const path = require('path');
const fs = require('fs');

const { extractUserInfo } = require('../_utils/cfAuth');
const { PA_LIMITS } = require('../_lib/stripe/entitlements');
const gate = require('./entitlementGate');
const { isValidCeoSecret } = require('../_utils/ceoSecret');

const { callModel, LlmUnavailableError } = require('../_lib/llm');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet';   // primary; _lib/llm appends the fallback tail

// Input ceilings. These are deliberately the SAME 20,000 the paid rewrite
// enforces (`_lib/roastRewrite/composer.js` RESUME_MAX_CHARS), because the two
// used to disagree: the free roast accepted a 50k paste happily, then the $9
// button rejected it with a raw browser alert. Anything we will roast must be
// something we can also sell a rewrite for.
//
// It is also the cost ceiling. Unbounded input against a 200k context window is
// ~$0.60 of tokens per request on a free, anonymous, rate-limit-of-5 endpoint —
// the cheapest possible denial-of-wallet. A cap is better insurance than a
// fallback chain, because it prevents the bill rather than surviving it.
const MAX_INPUT_CHARS = 20000;
const MAX_SECONDARY_CHARS = 6000;
const RATE_LIMIT_ANON = PA_LIMITS.anonDaily;
const RATE_LIMIT_AUTH = PA_LIMITS.freeDaily; // free tier; IP and userId are separate buckets — logging in doubles your allowance. Pro/credits enforced below.

// Built-in scaffold agent for Agent Forge prompt generation
const SCAFFOLD_AGENT = {
  id: '_scaffold',
  name: 'Agent Scaffold',
  active: true,
  inputType: 'textarea',
  inputValidation: 'text',
  systemPrompt: 'You are a prompt engineer for the Pixel Agents platform. Given a user\'s plain-English description of what an AI agent should do, generate a complete agent configuration.\n\nThe available output section types are: score (0-100 number with progress bar), verdict (italic one-line with left border), text (paragraph), list (bullet points), tags (colored pill badges), highlight (bordered callout box).\n\nYou MUST respond with valid JSON:\n{\n  "suggestedName": "<short agent name, 2-3 words>",\n  "suggestedTagline": "<tagline, max 60 chars>",\n  "suggestedCategory": "<one of: audit, content, strategy, naming, pitch, design, lifestyle, tools, career, intel, gaming, creative>",\n  "systemPrompt": "<complete system prompt that enforces JSON output, includes role definition, numbered instructions, and the exact JSON structure the agent must return>",\n  "userPromptTemplate": "<user prompt with {{input}} placeholder>",\n  "suggestedOutputs": [\n    { "key": "<snake_case_key>", "label": "<Display Label>", "type": "<one of the output types above>" }\n  ],\n  "temperature": <0.0-1.0>,\n  "maxTokens": <500-4000>\n}\n\nMake the system prompt detailed and specific. Always enforce JSON output in the system prompt. Include 4-7 output sections. Do NOT wrap in code fences. Return ONLY raw JSON.',
  userPromptTemplate: 'Generate a complete agent configuration for this idea:\n\n{{input}}',
  outputFormat: 'structured',
  outputSections: [],
  generationConfig: { temperature: 0.7, maxOutputTokens: 3000 }
};

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

    // Built-in meta-agents for Agent Forge
    let agent = null;

    if (agentId === '_scaffold') {
      agent = SCAFFOLD_AGENT;
    } else if (agentId === '_test' && body._customAgent) {
      // Custom agent test run from Agent Forge
      agent = body._customAgent;
      agent.active = true;
      agent.id = '_test';
    } else {
      // Normal agent lookup — check built-in registry first, then community
      const agents = loadAgentRegistry();
      agent = agents.find(a => a.id === agentId && a.active);

      // Fallback: check community agents in blob storage
      if (!agent) {
        try {
          const communityAgents = (await storage.getState('pixelAgentCommunity')) || [];
          agent = communityAgents.find(a => a.id === agentId && a.active);
        } catch { /* non-fatal */ }
      }
    }

    if (!agent) {
      const agents = loadAgentRegistry();
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

    // Over-length is rejected, not silently trimmed. Truncation would score a
    // resume the user never submitted and tell them nothing about it — the
    // answer looks complete and is quietly wrong, which is worse than an error.
    if (input.trim().length > MAX_INPUT_CHARS) {
      context.res = {
        status: 400,
        headers: corsHeaders,
        body: {
          error: 'That is ' + input.trim().length.toLocaleString() + ' characters — the limit is '
            + MAX_INPUT_CHARS.toLocaleString() + '. Trim it and try again.',
          limit: MAX_INPUT_CHARS,
          actual: input.trim().length
        }
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

    // Billing + rate limiting — CEO/admin/Pro run unlimited, free tiers get a
    // daily allowance, purchased credits extend past the free allowance.
    const isCEO = isValidCeoSecret(req.headers['x-company-secret']);
    const { userId, isAuthenticated } = extractUserInfo(req, context);
    const clientIP = getClientIP(req);
    const ipHash = hashIP(clientIP);
    const today = todayKey();
    const cost = agent.rateLimitCost || 1;
    const dailyLimit = isAuthenticated ? RATE_LIMIT_AUTH : RATE_LIMIT_ANON;

    // Entitlement lookup (authenticated only) — fail-open to the free tier so
    // a billing-storage outage can never take the product down.
    let isPro = false;
    let credits = 0;
    if (!isCEO && isAuthenticated) {
      if (gate.isAdminUser(userId)) {
        isPro = true;
      } else {
        try {
          const entRecord = await gate.loadPaEntitlements(userId);
          isPro = gate.hasFlag(entRecord, 'paUnlimitedRuns');
          credits = (entRecord && entRecord.paCredits) || 0;
        } catch (entErr) {
          context.log.warn('[PixelAgentRun] entitlements lookup failed (fail-open to free tier):', entErr.message);
        }
      }
    }
    const unlimited = isCEO || isPro;

    let rateLimits = {};
    let userRuns = 0;
    // Count INCLUDING this run, set from whatever actually persisted below.
    // `userRuns` is read before the ~25s model call and is stale by the time the
    // response is built, so it must not be what we quote back to the user.
    let runsUsed = 0;
    let usingCredits = false;

    if (!unlimited) {
      try {
        rateLimits = (await storage.getState('pixelAgentRateLimits')) || {};
      } catch { rateLimits = {}; }

      // IP and userId are separate rate limit buckets — logging in doubles your allowance
      const userKey = isAuthenticated ? userId + '_' + today : ipHash + '_' + today;
      userRuns = rateLimits[userKey] || 0;

      if (userRuns + cost > dailyLimit) {
        if (isAuthenticated && credits >= cost) {
          usingCredits = true; // paid credits carry the run past the free allowance
        } else {
          let message;
          if (!isAuthenticated) {
            // NOT "you've used all 5" — the anonymous bucket is keyed on a hash
            // of the IP, so on carrier CGNAT, office NAT, campus or cafe wifi
            // this fires for someone on their FIRST visit, and tells them a
            // flat lie about their own usage. Say where the limit actually
            // applies, and make signing in read as the fix rather than a
            // penalty. Only bites now that traffic is arriving — especially
            // mobile and social traffic, which is the most NAT-shared there is.
            message = 'That\'s ' + dailyLimit + ' free runs from this network today — shared wifi and mobile networks hit this sooner. '
              + 'Sign in for ' + RATE_LIMIT_AUTH + ' a day counted to you alone.';
          } else if (credits > 0) {
            message = 'This agent costs ' + cost + ' runs and you have ' + credits + ' credit' + (credits !== 1 ? 's' : '') + ' left. Top up a run pack or go Pro for unlimited runs.';
          } else {
            message = 'You\'ve used all ' + dailyLimit + ' free runs for today. Buy a run pack or go Pro for unlimited runs.';
          }
          context.res = {
            status: 429,
            headers: corsHeaders,
            body: {
              error: 'Daily limit reached',
              message: message,
              remaining: 0,
              credits: credits,
              tier: 'free',
              upgradeUrl: '/pixel-agents/upgrade.html'
            }
          };
          return;
        }
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

    // Optional second input, appended as its own context block exactly like
    // searchContext/siteContext above. Opt-in per agent: without a
    // secondaryInput declaration on the config this is a no-op, so the other 23
    // agents build byte-identical prompts.
    let secondaryContext = '';
    if (agent.secondaryInput && typeof body.secondaryInput === 'string') {
      const secondary = body.secondaryInput.trim();
      // This used to .slice(0, 6000) in silence, so a long posting was cut
      // mid-sentence and the resume scored against half a job — with the user
      // told nothing. Same reasoning as the input cap above: say so instead.
      if (secondary.length > MAX_SECONDARY_CHARS) {
        context.res = {
          status: 400,
          headers: corsHeaders,
          body: {
            error: 'That job description is ' + secondary.length.toLocaleString() + ' characters — the limit is '
              + MAX_SECONDARY_CHARS.toLocaleString() + '. Paste the role and requirements sections and try again.',
            limit: MAX_SECONDARY_CHARS,
            actual: secondary.length,
            field: 'secondaryInput'
          }
        };
        return;
      }
      if (secondary) {
        secondaryContext = '\n\n' + (agent.secondaryInput.promptLabel || 'ADDITIONAL CONTEXT') + ':\n' + secondary;
      }
    }

    // Build prompt
    const userMessage = agent.userPromptTemplate.replace('{{input}}', input.trim()) + secondaryContext + searchContext + siteContext;

    // Call Claude API
    context.log('[PixelAgentRun] Agent:', agentId, 'Input:', input.substring(0, 100));

    // Minted before the model call so the spend entry can carry it. Without a
    // shared id, claudeUsage and pixelAgentRuns can only be joined by timestamp
    // proximity, which makes per-run and per-user cost attribution guesswork.
    const runId = 'run-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');

    // Routed through _lib/llm so a single provider cannot take the product
    // down. Previously this was one unconditional fetch to Anthropic: a 429, a
    // 529, or an exhausted credit balance returned 502 to every user of all 24
    // agents at once. The chain reaches Gemini as well, so credit exhaustion
    // now degrades quality rather than ending the session.
    let llm;
    try {
      llm = await callModel({
        model: MODEL,
        runId,
        system: agent.systemPrompt,
        prompt: userMessage,
        maxTokens: agent.generationConfig?.maxOutputTokens || 1500,
        temperature: agent.generationConfig?.temperature,
        json: agent.outputFormat === 'structured',
        caller: 'pixel-agent-run',
        agentId: agent.id
      });
    } catch (err) {
      if (!(err instanceof LlmUnavailableError)) throw err;
      context.log.error('[PixelAgentRun] all models failed:', err.reason, err.message);
      // Say which kind of problem it is. "System fault" reads as "you broke
      // it"; a capacity problem is ours and is worth waiting out, and a credit
      // problem is ours and is NOT worth retrying.
      const message = err.reason === 'capacity'
        ? agent.name + ' is over capacity right now. Give it a minute and try again — your text is still here.'
        : agent.name + ' is temporarily unavailable. This is on us, not your input. Try again shortly.';
      context.res = {
        status: 503,
        headers: { ...corsHeaders, 'Retry-After': '60' },
        body: { error: message, retryable: true, reason: err.reason }
      };
      return;
    }

    if (llm.fellBackFrom) {
      context.log.warn('[PixelAgentRun] served by fallback model', llm.modelId, 'primary', llm.fellBackFrom);
    }

    const rawText = llm.text || '';

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


    // Post-success accounting — consume a credit or count against the free
    // allowance. Runs only after Claude succeeded so a 502 never costs anyone.
    if (!unlimited) {
      if (usingCredits) {
        try {
          credits = await gate.consumePaCredits(userId, cost);
        } catch (credErr) {
          context.log.warn('[PixelAgentRun] credit consumption failed (run already delivered):', credErr.message);
          credits = Math.max(0, credits - cost);
        }
      } else {
        const userKey = isAuthenticated ? userId + '_' + today : ipHash + '_' + today;
        // Read-modify-write through mutateState, not a fire-and-forget setState.
        // The old version read the whole blob near the top of the request, held
        // it across the ~26s model call, then wrote it back — so two concurrent
        // runs both wrote a count based on the same stale read and one of them
        // vanished. Every lost count is a free run someone gets twice, which is
        // a cost leak that scales precisely with the traffic we are chasing.
        // Increments off FRESH state inside the mutator rather than reusing
        // userRuns from before the model call.
        //
        // Fallback if the write below fails outright — still better than the
        // pre-model-call read, which cannot know about this run at all.
        runsUsed = userRuns + cost;
        // AWAITED (2026-08-08). This was fire-and-forget, and in production the
        // write essentially never landed: three consecutive free runs from one
        // IP each reported `remaining: 4`, i.e. the cap did not hold at all.
        // Azure Functions ends the invocation when the handler returns and does
        // not guarantee pending IO afterwards, so an un-awaited blob write is a
        // coin flip. The comment above was right about the cost leak and the
        // mutateState fix was right; not awaiting it undid both.
        //
        // Awaiting costs ~100-300ms on a request that already spends ~25s in the
        // model, and "the user still has their result" stays true because this
        // runs after the answer is produced and the catch is still non-fatal.
        try {
          const rlRes = await storage.mutateState('pixelAgentRateLimits', (current) => {
            const next = current || {};
            next[userKey] = (next[userKey] || 0) + cost;
            // Keep only today's entries so the blob cannot grow without bound.
            for (const key of Object.keys(next)) {
              if (!key.endsWith('_' + today)) delete next[key];
            }
            return next;
          });
          // Report the count that actually PERSISTED, not the one read before
          // the model call. Those differ whenever a concurrent run also counted,
          // and the pre-call number is what told three separate runs that four
          // were still free.
          const persisted = rlRes && rlRes.value && rlRes.value[userKey];
          if (Number.isFinite(persisted)) runsUsed = persisted;
        } catch (err) {
          // Non-fatal: the run already succeeded and the user has their result.
          // Losing the count costs us one free run, not their answer.
          context.log.warn('[PixelAgentRun] rate-limit write failed:', err.message);
        }
      }
    }

    // Store run result for share URLs
    const creatorId = agent.creatorId || null;
    const runRecord = {
      runId,
      agentId: agent.id,
      agentName: agent.name,
      agentIcon: agent.icon,
      agentTier: agent.tier,
      creatorId,
      userId: isAuthenticated ? userId : null,
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

    // Update per-creator run attribution (revenue share tracking)
    if (creatorId) {
      try {
        let creatorStats = (await storage.getState('pixelAgentCreatorStats')) || {};
        if (!creatorStats[creatorId]) creatorStats[creatorId] = {};
        creatorStats[creatorId][agentId] = (creatorStats[creatorId][agentId] || 0) + 1;
        creatorStats[creatorId]._total = (creatorStats[creatorId]._total || 0) + 1;
        await storage.setState('pixelAgentCreatorStats', creatorStats);
      } catch { /* non-fatal */ }
    }

    // Token usage is logged inside _lib/llm, against whichever provider
    // actually answered — logging it a second time here would double-count the
    // spend, and would file a Gemini fallback under the Claude rail.
    if (llm.usage) {
      context.log('[PixelAgentRun] Tokens — input:', llm.usage.promptTokens, 'output:', llm.usage.completionTokens, 'model:', llm.modelId);
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
        remaining: unlimited ? 999 : (usingCredits ? 0 : Math.max(0, dailyLimit - runsUsed)),
        credits: isAuthenticated ? credits : null,
        tier: unlimited ? 'pro' : 'free',
        shareUrl: '/api/pixel-agent-share?run=' + runId
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
