// facebook.js — Facebook platform adapter for social_post.publish / social_post.schedule
// MANUAL MODE: No Graph API calls. Approved posts are stored for CEO to copy & paste.
// When Meta approves the app, swap this for a Graph API adapter (POST /{page-id}/feed).

/**
 * Manual-post adapter — returns a receipt marking the post for manual publishing.
 * The action stays in the actions blob with execution.receipt.manual = true,
 * which the dashboard Facebook Outbox reads to surface copy-ready posts.
 */
async function publishToFacebook(action) {
  const payload = action.payload || {};
  const text = (payload.text || '').trim();

  if (!text) {
    return {
      ok: false,
      error: 'Empty post text — cannot queue for manual posting'
    };
  }

  return {
    ok: true,
    receipt: {
      manual: true,
      platform: 'facebook',
      text: text,
      created_at: new Date().toISOString(),
      message: 'Approved for manual posting to Facebook. Copy text from the dashboard outbox.'
    }
  };
}

module.exports = { publishToFacebook };
