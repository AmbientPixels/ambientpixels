// TEMPORARY — patch creatorName on existing agents. DELETE AFTER USE.
const storage = require('../_utils/companyStorage');
module.exports = async function (context, req) {
  if (req.headers['x-company-secret'] !== 'pixelpusher') {
    context.res = { status: 403, body: { error: 'CEO only' } };
    return;
  }
  var community = (await storage.getState('pixelAgentCommunity')) || [];
  community.forEach(function (a) {
    if (a.creatorId === 'ceo' && !a.creatorName) a.creatorName = 'AmbientPixels';
    if (a.creatorId === '112102411910668145312' && !a.creatorName) a.creatorName = 'Chad Martin';
  });
  await storage.setState('pixelAgentCommunity', community);
  context.res = { status: 200, headers: { 'Content-Type': 'application/json' },
    body: { patched: true, agents: community.map(a => ({ id: a.id, creatorName: a.creatorName })) }
  };
};
