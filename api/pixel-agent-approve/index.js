// pixel-agent-approve — CEO approve/reject agent submissions
// POST /api/pixel-agent-approve { submissionId, action: "approve"|"reject", reason? }
// Requires x-company-secret header

const storage = require('../_utils/companyStorage');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-company-secret'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // CEO auth check
  if (req.headers['x-company-secret'] !== 'pixelpusher') {
    context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Unauthorized' } };
    return;
  }

  try {
    const { submissionId, action, reason } = req.body || {};

    if (!submissionId || !['approve', 'reject'].includes(action)) {
      context.res = {
        status: 400,
        headers: CORS_HEADERS,
        body: { error: 'submissionId and action (approve|reject) required' }
      };
      return;
    }

    // Find submission
    let submissions = (await storage.getState('pixelAgentSubmissions')) || [];
    const submission = submissions.find(s => s.id === submissionId);

    if (!submission) {
      context.res = { status: 404, headers: CORS_HEADERS, body: { error: 'Submission not found' } };
      return;
    }

    if (action === 'approve') {
      // Move agent config to community catalog
      let community = (await storage.getState('pixelAgentCommunity')) || [];
      var isEdit = submission.editMode && submission.originalAgentId;

      if (isEdit) {
        // Edit: update existing agent in place
        var editIdx = community.findIndex(a => a.id === submission.originalAgentId);
        if (editIdx === -1) {
          context.res = {
            status: 404,
            headers: CORS_HEADERS,
            body: { error: 'Original agent not found for edit — may have been deleted' }
          };
          return;
        }
        community[editIdx] = Object.assign({}, submission.agentConfig, {
          active: true,
          community: true,
          submissionId: submissionId,
          approvedAt: new Date().toISOString(),
          lastEditedAt: new Date().toISOString(),
          order: community[editIdx].order
        });
        context.log('[AgentApprove] Updated existing agent:', submission.originalAgentId);
      } else {
        // New agent: check cap and duplicate
        const MAX_LIVE = 3;
        const liveCount = community.filter(a => a.active).length;
        if (liveCount >= MAX_LIVE) {
          context.res = {
            status: 409,
            headers: CORS_HEADERS,
            body: { error: 'Max ' + MAX_LIVE + ' live agents. Delete one from the catalog to publish a new one.', liveCount: liveCount, limit: MAX_LIVE }
          };
          return;
        }

        if (community.some(a => a.id === submission.agentConfig.id)) {
          context.res = {
            status: 409,
            headers: CORS_HEADERS,
            body: { error: 'Agent with this ID already exists in community catalog' }
          };
          return;
        }

        community.push(Object.assign({}, submission.agentConfig, {
          active: true,
          community: true,
          submissionId: submissionId,
          approvedAt: new Date().toISOString(),
          order: 100 + community.length
        }));
      }

      await storage.setState('pixelAgentCommunity', community);
      const communityAgent = submission.agentConfig;

      // Update submission status
      submission.status = 'approved';
      submission.approvedAt = new Date().toISOString();
      await storage.setState('pixelAgentSubmissions', submissions);

      // Remove from approval queue
      let approvalQueue = (await storage.getState('approvalQueue')) || [];
      approvalQueue = approvalQueue.filter(aq =>
        !(aq.type === 'agent_forge_submission' && aq.submissionId === submissionId)
      );
      await storage.setState('approvalQueue', approvalQueue);

      context.log('[AgentApprove] Approved:', submission.agentConfig.name);

      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          success: true,
          action: 'approved',
          agentId: communityAgent.id,
          agentName: communityAgent.name,
          message: communityAgent.name + ' is now live in the Pixel Agents catalog!'
        }
      };

    } else {
      // Reject — update submission status
      submission.status = 'rejected';
      submission.rejectedAt = new Date().toISOString();
      submission.rejectionReason = reason || 'Rejected by CEO';
      await storage.setState('pixelAgentSubmissions', submissions);

      // Remove from approval queue
      let approvalQueue = (await storage.getState('approvalQueue')) || [];
      approvalQueue = approvalQueue.filter(aq =>
        !(aq.type === 'agent_forge_submission' && aq.submissionId === submissionId)
      );
      await storage.setState('approvalQueue', approvalQueue);

      context.log('[AgentApprove] Rejected:', submission.agentConfig.name, reason);

      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: {
          success: true,
          action: 'rejected',
          agentName: submission.agentConfig.name,
          message: submission.agentConfig.name + ' has been rejected.'
        }
      };
    }

  } catch (err) {
    context.log.error('[AgentApprove] Error:', err.message);
    context.res = {
      status: 500,
      headers: CORS_HEADERS,
      body: { error: 'Approval failed: ' + err.message }
    };
  }
};
