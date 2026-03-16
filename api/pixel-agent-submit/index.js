// pixel-agent-submit — Submit custom agent for review + approval
// POST /api/pixel-agent-submit { agentConfig }

const fetch = require('node-fetch');
const storage = require('../_utils/companyStorage');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret'
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
    const { agentConfig } = req.body || {};

    if (!agentConfig || !agentConfig.name || !agentConfig.systemPrompt) {
      context.res = {
        status: 400,
        headers: CORS_HEADERS,
        body: { error: 'Invalid agent config' }
      };
      return;
    }

    const submissionId = 'sub-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);

    // Step 1: AI Gatekeeper Review
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

    // Step 2: Save submission record
    const submission = {
      id: submissionId,
      agentConfig,
      review: reviewResult,
      status: reviewResult.decision,
      submittedAt: new Date().toISOString()
    };

    let submissions = [];
    try {
      submissions = (await storage.getState('pixelAgentSubmissions')) || [];
    } catch { submissions = []; }

    submissions.push(submission);
    if (submissions.length > 200) submissions = submissions.slice(-200);
    await storage.setState('pixelAgentSubmissions', submissions);

    // Step 3: If approved, add to CEO approval queue
    if (reviewResult.decision === 'approved') {
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
          status: 'pending',
          createdAt: new Date().toISOString()
        });
        if (approvalQueue.length > 500) approvalQueue = approvalQueue.slice(-500);
        await storage.setState('approvalQueue', approvalQueue);
        context.log('[AgentSubmit] Approved — added to CEO queue:', agentConfig.name);
      } catch (aqErr) {
        context.log.warn('[AgentSubmit] Failed to add to approval queue:', aqErr.message);
      }
    }

    context.log('[AgentSubmit] Decision:', reviewResult.decision, 'for:', agentConfig.name);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        submissionId,
        decision: reviewResult.decision,
        scores: reviewResult.scores,
        feedback: reviewResult.feedback,
        similar_to: reviewResult.similar_to,
        improvements: reviewResult.improvements
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
