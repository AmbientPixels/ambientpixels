// TEMPORARY — one-time patch to fix missing creatorIds on community agents
// DELETE THIS ENDPOINT AFTER USE

const storage = require('../_utils/companyStorage');

module.exports = async function (context, req) {
  if (req.headers['x-company-secret'] !== 'pixelpusher') {
    context.res = { status: 403, body: { error: 'CEO only' } };
    return;
  }

  try {
    var community = (await storage.getState('pixelAgentCommunity')) || [];

    var before = community.map(a => ({ id: a.id, creatorId: a.creatorId }));

    // Patch: Salary Fairness Scout → Google account, others → ceo
    community.forEach(function (a) {
      if (a.id === 'salary-fairness-scout') {
        a.creatorId = '112102411910668145312'; // Google account userId
      } else if (!a.creatorId) {
        a.creatorId = 'ceo';
      }
    });

    await storage.setState('pixelAgentCommunity', community);

    var after = community.map(a => ({ id: a.id, creatorId: a.creatorId }));

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { patched: true, before, after }
    };
  } catch (err) {
    context.res = { status: 500, body: { error: err.message } };
  }
};
