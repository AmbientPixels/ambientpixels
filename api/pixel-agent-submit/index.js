// pixel-agent-submit — Submit custom agent for review + approval
// POST /api/pixel-agent-submit { agentConfig, editMode?, originalAgentId? }

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');
const { extractUserInfo } = require('../_utils/cfAuth');

const DAILY_SUBMISSION_LIMIT = 5;
const MAX_LIVE_AGENTS = 5;
const AUTO_APPROVE_THRESHOLD = 70; // all scores must be >= this to skip CEO queue

// Fields that can change without re-review
var COSMETIC_FIELDS = ['tagline', 'description', 'icon', 'portrait', 'portraitUrl', 'tier', 'generationConfig'];

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret, x-ms-client-principal'
};

function getApiBase() {
  return 'https://ambientpixels-nova-api.azurewebsites.net/api';
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    // GET: return remaining submissions for today + live agent count
    if (req.method === 'GET') {
      const today = new Date().toISOString().split('T')[0];
      let submissions = [];
      try { submissions = (await storage.getState('pixelAgentSubmissions')) || []; } catch { submissions = []; }
      const todayCount = submissions.filter(function(s) {
        return s.submittedAt && s.submittedAt.startsWith(today);
      }).length;

      let community = [];
      try { community = (await storage.getState('pixelAgentCommunity')) || []; } catch { community = []; }
      const liveCount = community.filter(function(a) { return a.active; }).length;

      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          dailyLimit: DAILY_SUBMISSION_LIMIT,
          submissionsToday: todayCount,
          remaining: Math.max(0, DAILY_SUBMISSION_LIMIT - todayCount),
          liveAgentLimit: MAX_LIVE_AGENTS,
          liveAgentCount: liveCount
        }
      };
      return;
    }

    const { agentConfig, editMode, originalAgentId } = req.body || {};

    // Attach creator identity
    var { userId, isAuthenticated } = extractUserInfo(req, context);
    if (isAuthenticated && !agentConfig.creatorId) {
      agentConfig.creatorId = userId;
    }

    if (!agentConfig || !agentConfig.name || !agentConfig.systemPrompt) {
      context.res = {
        status: 400,
        headers: CORS_HEADERS,
        body: { error: 'Invalid agent config' }
      };
      return;
    }

    // Check daily submission limit
    const today = new Date().toISOString().split('T')[0];
    let existingSubmissions = [];
    try { existingSubmissions = (await storage.getState('pixelAgentSubmissions')) || []; } catch { existingSubmissions = []; }
    const todaySubmissions = existingSubmissions.filter(function(s) {
      return s.submittedAt && s.submittedAt.startsWith(today);
    });

    if (todaySubmissions.length >= DAILY_SUBMISSION_LIMIT) {
      context.res = {
        status: 429,
        headers: CORS_HEADERS,
        body: {
          error: 'Daily submission limit reached',
          message: 'You\'ve used all ' + DAILY_SUBMISSION_LIMIT + ' submissions for today. Come back tomorrow!',
          remaining: 0,
          dailyLimit: DAILY_SUBMISSION_LIMIT
        }
      };
      return;
    }

    const submissionId = 'sub-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);

    // ── Edit mode: check if only cosmetic changes were made ──
    var cosmeticOnly = false;
    var existingAgent = null;
    if (editMode && originalAgentId) {
      let community = [];
      try { community = (await storage.getState('pixelAgentCommunity')) || []; } catch { community = []; }
      existingAgent = community.find(function(a) { return a.id === originalAgentId && a.active; });

      if (existingAgent) {
        // Check if only cosmetic fields changed
        cosmeticOnly = true;
        var keys = Object.keys(agentConfig);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (COSMETIC_FIELDS.indexOf(k) !== -1) continue;
          if (k === 'id' || k === 'name' || k === 'active' || k === 'featured' || k === 'order' || k === 'community') continue;
          if (JSON.stringify(agentConfig[k]) !== JSON.stringify(existingAgent[k])) {
            cosmeticOnly = false;
            context.log('[AgentSubmit] Non-cosmetic change detected in field:', k);
            break;
          }
        }
      }
    }

    // ── Upload portrait to blob if present ──
    if (agentConfig.portrait && agentConfig.portrait.base64) {
      try {
        var { BlobServiceClient } = require('@azure/storage-blob');
        var connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (connStr) {
          var blobClient = BlobServiceClient.fromConnectionString(connStr);
          var container = blobClient.getContainerClient('generated-images');
          await container.createIfNotExists({ access: 'blob' });
          var agentId = agentConfig.id || submissionId;
          var blobName = 'agent-portraits/' + agentId + '.png';
          var imgBuffer = Buffer.from(agentConfig.portrait.base64, 'base64');
          var blockBlob = container.getBlockBlobClient(blobName);
          await blockBlob.upload(imgBuffer, imgBuffer.length, {
            blobHTTPHeaders: { blobContentType: agentConfig.portrait.mimeType || 'image/png' },
            overwrite: true
          });
          agentConfig.portraitUrl = 'https://cardforgeblobdata.blob.core.windows.net/generated-images/' + blobName;
          delete agentConfig.portrait;
          context.log('[AgentSubmit] Portrait uploaded:', blobName);
        }
      } catch (imgErr) {
        context.log.warn('[AgentSubmit] Portrait upload failed:', imgErr.message);
      }
    }

    // ── Cosmetic-only edits: apply directly, no review needed ──
    if (cosmeticOnly && existingAgent) {
      context.log('[AgentSubmit] Cosmetic-only edit for:', agentConfig.name, '— applying directly');
      let community = (await storage.getState('pixelAgentCommunity')) || [];
      var idx = community.findIndex(function(a) { return a.id === originalAgentId; });
      if (idx !== -1) {
        // Apply only cosmetic fields
        COSMETIC_FIELDS.forEach(function(f) {
          if (agentConfig[f] !== undefined) community[idx][f] = agentConfig[f];
        });
        community[idx].lastEditedAt = new Date().toISOString();
        await storage.setState('pixelAgentCommunity', community);
      }

      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          submissionId: submissionId,
          decision: 'cosmetic_update',
          scores: { quality: 100, uniqueness: 100, safety: 100 },
          feedback: 'Cosmetic changes applied instantly — no review needed.',
          autoApproved: true,
          applied: true
        }
      };
      return;
    }

    // ── Step 1: AI Gatekeeper Review ──
    context.log('[AgentSubmit] Running AI review for:', agentConfig.name);

    let reviewResult = null;
    try {
      const reviewRes = await fetch(getApiBase() + '/pixel-agent-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentConfig })
      });
      reviewResult = await reviewRes.json();
    } catch (reviewErr) {
      context.log.warn('[AgentSubmit] Review call failed:', reviewErr.message);
      reviewResult = {
        decision: 'needs_work',
        scores: { quality: 0, uniqueness: 0, safety: 0 },
        feedback: 'Review system unavailable. Please try again later.',
        improvements: []
      };
    }

    // ── Step 2: Save submission record ──
    const submission = {
      id: submissionId,
      agentConfig,
      review: reviewResult,
      status: reviewResult.decision,
      editMode: editMode || false,
      originalAgentId: originalAgentId || null,
      submittedAt: new Date().toISOString()
    };

    let submissions = [];
    try {
      submissions = (await storage.getState('pixelAgentSubmissions')) || [];
    } catch { submissions = []; }

    submissions.push(submission);
    if (submissions.length > 200) submissions = submissions.slice(-200);
    await storage.setState('pixelAgentSubmissions', submissions);

    // ── Step 3: Auto-approve or queue ──
    var autoApproved = false;
    if (reviewResult.decision === 'approved') {
      var scores = reviewResult.scores || {};
      var allAboveThreshold = scores.quality >= AUTO_APPROVE_THRESHOLD &&
        scores.uniqueness >= AUTO_APPROVE_THRESHOLD &&
        scores.safety >= AUTO_APPROVE_THRESHOLD;

      if (allAboveThreshold) {
        // Auto-approve: go straight to live
        context.log('[AgentSubmit] Auto-approved (all scores >= ' + AUTO_APPROVE_THRESHOLD + '):', agentConfig.name);
        autoApproved = true;

        try {
          let community = (await storage.getState('pixelAgentCommunity')) || [];

          if (editMode && originalAgentId) {
            // Edit: replace existing agent
            var editIdx = community.findIndex(function(a) { return a.id === originalAgentId; });
            if (editIdx !== -1) {
              community[editIdx] = Object.assign({}, agentConfig, {
                active: true,
                community: true,
                submissionId: submissionId,
                approvedAt: new Date().toISOString(),
                lastEditedAt: new Date().toISOString(),
                order: community[editIdx].order
              });
              context.log('[AgentSubmit] Updated existing live agent:', originalAgentId);
            }
          } else {
            // New agent: check cap and add
            var liveCount = community.filter(function(a) { return a.active; }).length;
            if (liveCount < MAX_LIVE_AGENTS) {
              community.push(Object.assign({}, agentConfig, {
                active: true,
                community: true,
                submissionId: submissionId,
                approvedAt: new Date().toISOString(),
                order: 100 + community.length
              }));
              context.log('[AgentSubmit] New agent auto-published:', agentConfig.name);
            } else {
              // Over cap — fall through to CEO queue
              autoApproved = false;
              context.log('[AgentSubmit] Auto-approve blocked by live cap (' + liveCount + '/' + MAX_LIVE_AGENTS + ')');
            }
          }

          if (autoApproved) {
            await storage.setState('pixelAgentCommunity', community);
            submission.status = 'approved';
            submission.approvedAt = new Date().toISOString();
            submission.autoApproved = true;
            await storage.setState('pixelAgentSubmissions', submissions);
          }
        } catch (autoErr) {
          context.log.warn('[AgentSubmit] Auto-approve failed, falling back to CEO queue:', autoErr.message);
          autoApproved = false;
        }
      }

      // If not auto-approved, add to CEO queue
      if (!autoApproved) {
        try {
          let approvalQueue = (await storage.getState('approvalQueue')) || [];
          approvalQueue.push({
            id: 'aq-agent-' + Date.now(),
            type: 'agent_forge_submission',
            submissionId,
            agentName: agentConfig.name,
            agentTagline: agentConfig.tagline,
            agentCategory: agentConfig.category,
            aiReview: reviewResult,
            editMode: editMode || false,
            originalAgentId: originalAgentId || null,
            status: 'pending',
            createdAt: new Date().toISOString()
          });
          if (approvalQueue.length > 500) approvalQueue = approvalQueue.slice(-500);
          await storage.setState('approvalQueue', approvalQueue);
          context.log('[AgentSubmit] Added to CEO queue:', agentConfig.name);
        } catch (aqErr) {
          context.log.warn('[AgentSubmit] Failed to add to approval queue:', aqErr.message);
        }
      }
    }

    context.log('[AgentSubmit] Decision:', reviewResult.decision, 'autoApproved:', autoApproved, 'for:', agentConfig.name);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        submissionId,
        decision: reviewResult.decision,
        scores: reviewResult.scores,
        feedback: reviewResult.feedback,
        similar_to: reviewResult.similar_to,
        improvements: reviewResult.improvements,
        autoApproved: autoApproved
      }
    };

  } catch (err) {
    context.log.error('[AgentSubmit] Error:', err.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Submission failed: ' + err.message }
    };
  }
};
