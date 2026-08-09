// executors/index.js — Platform-abstracted action executor router
// Routes action execution to the appropriate platform adapter

const xAdapter = require('./social/x');
const linkedinAdapter = require('./social/linkedin');
const blueskyAdapter = require('./social/bluesky');
const redditAdapter = require('./social/reddit');
const facebookAdapter = require('./social/facebook');
const instagramAdapter = require('./social/instagram');
const contentAdapter = require('./content/publishDocument');
const videoAdapter = require('./content/generateVideo');
const storage = require('../../_utils/companyStorage');

// Map of action_type → platform → executor function
const EXECUTORS = {
  'social_post.publish': {
    'x': xAdapter.publishToX,
    'linkedin': linkedinAdapter.publishToLinkedIn,
    'bluesky': blueskyAdapter.publishToBluesky,
    'reddit': redditAdapter.publishToReddit,
    'facebook': facebookAdapter.publishToFacebook,
    'instagram': instagramAdapter.publishToInstagram
  },
  'social_post.schedule': {
    'x': xAdapter.publishToX,
    'linkedin': linkedinAdapter.publishToLinkedIn,
    'bluesky': blueskyAdapter.publishToBluesky,
    'reddit': redditAdapter.publishToReddit,
    'facebook': facebookAdapter.publishToFacebook,
    'instagram': instagramAdapter.publishToInstagram
  },
  'social_post.reply': {
    'x': null, // v3
    'linkedin': null,
    'bluesky': blueskyAdapter.publishToBluesky // reply handled via payload.reply field
  },
  'social_post.draft': {
    'x': null, // drafts don't execute externally
    'linkedin': null,
    'bluesky': null
  },
  'publish_document': {
    'site': contentAdapter.publishDocument
  },
  // 'character' occupies the platform slot the same way 'site' does for publish_document:
  // the destination is a kind of output, not an external network. Brand clips are absent on
  // purpose — they need ffmpeg to composite text, which the Function App does not have.
  'generate_video': {
    'character': videoAdapter.generateVideo
  }
};

// Supported action types for execution
const EXECUTABLE_TYPES = ['social_post.publish', 'social_post.schedule', 'social_post.reply', 'publish_document', 'generate_video'];

/**
 * Execute an action by routing to the correct platform adapter
 * @param {Object} action - Full action object (must be approved)
 * @returns {Promise<{receipt: Object}>}
 */
async function executeAction(action) {
  const actionType = action.type || action.action_type;
  const platform = action.platform;

  // Validate type is executable
  if (!EXECUTABLE_TYPES.includes(actionType)) {
    throw {
      code: 'UNSUPPORTED_TYPE',
      message: 'Action type "' + actionType + '" is not executable in v1'
    };
  }

  // Get executor for type + platform
  const typeExecutors = EXECUTORS[actionType];
  if (!typeExecutors) {
    throw {
      code: 'NO_EXECUTOR',
      message: 'No executor registered for type "' + actionType + '"'
    };
  }

  const executor = typeExecutors[platform];
  if (!executor) {
    throw {
      code: 'PLATFORM_NOT_SUPPORTED',
      message: 'Platform "' + platform + '" not supported for "' + actionType + '". Available: ' + Object.keys(typeExecutors).filter(k => typeExecutors[k]).join(', ')
    };
  }

  // Resolve {{ARTICLE_URL}} tokens in payload.text before execution
  if (action.payload && action.payload.text && /\{\{ARTICLE_URL/.test(action.payload.text)) {
    try {
      var tokens = action.tokens || {};
      var artifacts = (await storage.getState('ap_artifacts')) || [];
      action.payload.text = action.payload.text.replace(/\{\{ARTICLE_URL(?::([^}]+))?\}\}/g, function(match, explicitId) {
        var artId = null;
        if (explicitId) {
          artId = explicitId.trim();
        } else if (tokens.ARTICLE_URL && tokens.ARTICLE_URL.id) {
          artId = tokens.ARTICLE_URL.id;
        }
        if (!artId) return match;
        var art = artifacts.find(function(a) { return a.id === artId; });
        if (!art || art.status !== 'published' || !art.url) return match;
        var url = art.url;
        if (url.charAt(0) === '/' && url.indexOf('//') !== 0) {
          url = 'https://ambientpixels.ai' + url;
        }
        return url;
      });
    } catch (e) { /* non-fatal — token resolution failed, post with raw tokens */ }
  }

  // Execute
  return await executor(action);
}

/**
 * Check if a platform adapter is available for the given action
 */
function isExecutable(actionType, platform) {
  const typeExecutors = EXECUTORS[actionType];
  if (!typeExecutors) return false;
  return typeof typeExecutors[platform] === 'function';
}

module.exports = {
  executeAction,
  isExecutable,
  EXECUTABLE_TYPES
};
