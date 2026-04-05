// pixel-agent-creator-profile — Creator profile CRUD
// GET /api/pixel-agent-creator-profile?userId={id} — public profile view
// POST /api/pixel-agent-creator-profile — save own profile (auth required)

const { extractUserInfo } = require('../_utils/cfAuth');
const { loadCreatorProfile, saveCreatorProfile, defaultProfile, toPublicSafe } = require('../_lib/stripe/creatorProfiles');
const storage = require('../_utils/companyStorage');

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ms-client-principal, x-cf-auth-principal, x-user-id, x-company-secret'
};

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  try {
    if (req.method === 'GET') {
      // Public profile view — no auth required
      var targetUserId = req.query.userId;
      if (!targetUserId) {
        context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'userId query param required' } };
        return;
      }

      var profile = await loadCreatorProfile(targetUserId);
      var publicData = toPublicSafe(profile);

      // Add agent count and total runs
      if (publicData) {
        var community = (await storage.getState('pixelAgentCommunity').catch(function () { return []; })) || [];
        var stats = (await storage.getState('pixelAgentStats').catch(function () { return {}; })) || {};
        var userAgents = community.filter(function (a) { return a.active && a.creatorId === targetUserId; });
        publicData.agentCount = userAgents.length;
        publicData.totalRuns = userAgents.reduce(function (sum, a) { return sum + (stats[a.id] || 0); }, 0);
      }

      context.res = { status: 200, headers: CORS_HEADERS, body: publicData || { displayName: null } };
      return;
    }

    // POST — save own profile (auth required)
    var { userId, email, isAuthenticated } = extractUserInfo(req, context);

    // CEO fallback
    if (!isAuthenticated && req.headers['x-company-secret'] === 'pixelpusher') {
      userId = 'ceo';
      email = 'ceo@ambientpixels.ai';
      isAuthenticated = true;
    }

    if (!isAuthenticated) {
      context.res = { status: 401, headers: CORS_HEADERS, body: { error: 'Authentication required' } };
      return;
    }

    var body = req.body || {};

    // Validate
    if (body.displayName && body.displayName.length > 50) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Display name must be 50 chars or less' } };
      return;
    }
    if (body.bio && body.bio.length > 200) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Bio must be 200 chars or less' } };
      return;
    }
    if (body.website && body.website.length > 200) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Website URL too long' } };
      return;
    }
    if (body.twitter && body.twitter.length > 30) {
      context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Twitter handle must be 30 chars or less' } };
      return;
    }

    // Load or create profile
    var profile = await loadCreatorProfile(userId);
    if (!profile) profile = defaultProfile(userId, email);

    // Merge profile fields (don't overwrite Stripe/payout data)
    if (body.displayName !== undefined) profile.displayName = body.displayName || null;
    if (body.bio !== undefined) profile.bio = body.bio || null;
    if (body.website !== undefined) profile.website = body.website || null;
    if (body.twitter !== undefined) profile.twitter = body.twitter || null;
    if (!profile.email && email) profile.email = email;

    // Avatar upload
    if (body.avatar && body.avatar.base64) {
      try {
        var sharp = require('sharp');
        var { BlobServiceClient } = require('@azure/storage-blob');
        var connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
        if (connStr) {
          var rawBuffer = Buffer.from(body.avatar.base64, 'base64');
          // Validate size (2MB max)
          if (rawBuffer.length > 2 * 1024 * 1024) {
            context.res = { status: 400, headers: CORS_HEADERS, body: { error: 'Avatar must be 2MB or less' } };
            return;
          }
          var imgBuffer = await sharp(rawBuffer).resize(512, 512, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
          var blobClient = BlobServiceClient.fromConnectionString(connStr);
          var container = blobClient.getContainerClient('generated-images');
          await container.createIfNotExists({ access: 'blob' });
          var blobName = 'creator-avatars/' + userId + '.webp';
          var blockBlob = container.getBlockBlobClient(blobName);
          await blockBlob.upload(imgBuffer, imgBuffer.length, {
            blobHTTPHeaders: { blobContentType: 'image/webp' },
            overwrite: true
          });
          profile.avatarUrl = 'https://cardforgeblobdata.blob.core.windows.net/generated-images/' + blobName;
          context.log('[CreatorProfile] Avatar uploaded:', blobName, '(' + imgBuffer.length + ' bytes)');
        }
      } catch (imgErr) {
        context.log.warn('[CreatorProfile] Avatar upload failed:', imgErr.message);
      }
    }

    await saveCreatorProfile(userId, profile);

    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: {
        success: true,
        profile: {
          displayName: profile.displayName,
          bio: profile.bio,
          avatarUrl: profile.avatarUrl,
          website: profile.website,
          twitter: profile.twitter
        }
      }
    };

  } catch (err) {
    context.log.error('[CreatorProfile] Error:', err.message, err.stack);
    context.res = { status: 500, headers: CORS_HEADERS, body: { error: 'Failed: ' + err.message } };
  }
};
