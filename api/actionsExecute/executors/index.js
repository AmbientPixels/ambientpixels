// executors/index.js — Platform-abstracted action executor router
// Routes action execution to the appropriate platform adapter

const xAdapter = require('./social/x');
const linkedinAdapter = require('./social/linkedin');
const blueskyAdapter = require('./social/bluesky');
const contentAdapter = require('./content/publishDocument');

// Map of action_type → platform → executor function
const EXECUTORS = {
  'social_post.publish': {
    'x': xAdapter.publishToX,
    'linkedin': linkedinAdapter.publishToLinkedIn,
    'bluesky': blueskyAdapter.publishToBluesky
  },
  'social_post.schedule': {
    'x': xAdapter.publishToX,
    'linkedin': linkedinAdapter.publishToLinkedIn,
    'bluesky': blueskyAdapter.publishToBluesky
  },
  'social_post.reply': {
    'x': null, // v3
    'linkedin': null,
    'bluesky': null
  },
  'social_post.draft': {
    'x': null, // drafts don't execute externally
    'linkedin': null,
    'bluesky': null
  },
  'publish_document': {
    'site': contentAdapter.publishDocument
  }
};

// Supported action types for execution
const EXECUTABLE_TYPES = ['social_post.publish', 'social_post.schedule', 'publish_document'];

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
