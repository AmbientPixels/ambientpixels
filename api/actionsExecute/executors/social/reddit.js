// reddit.js — Reddit platform adapter for social_post.publish / social_post.schedule
// MANUAL MODE: No Reddit API calls. Approved posts are stored for CEO to copy & paste.
// When Reddit API credentials are configured, swap this for the OAuth adapter below.
// Env vars (for future API mode): REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD, REDDIT_DEFAULT_SUBREDDIT

const MAX_TITLE_CHARS = 300;

/**
 * Parse Reddit title + body from action payload.
 * Supports:
 *   - payload.title + payload.text (explicit split)
 *   - payload.text starting with "TITLE: ..." on first line
 *   - Fallback: first line = title, rest = body
 */
function parseTitleAndBody(payload) {
  // Explicit title field takes priority
  if (payload.title && payload.text) {
    var title = String(payload.title).trim().substring(0, MAX_TITLE_CHARS);
    return { title, body: String(payload.text).trim() };
  }

  var raw = String(payload.text || '').trim();

  // Check for "TITLE: ..." convention on first line
  var titleMatch = raw.match(/^TITLE:\s*(.+?)(?:\n|$)([\s\S]*)/i);
  if (titleMatch) {
    var title = titleMatch[1].trim().substring(0, MAX_TITLE_CHARS);
    var body = (titleMatch[2] || '').trim();
    return { title, body };
  }

  // Fallback: first line = title, rest = body
  var newline = raw.indexOf('\n');
  if (newline > 0) {
    var title = raw.substring(0, newline).trim().substring(0, MAX_TITLE_CHARS);
    var body = raw.substring(newline + 1).trim();
    return { title, body };
  }

  // Single-line post: use full text as title with empty body
  return { title: raw.substring(0, MAX_TITLE_CHARS), body: '' };
}

/**
 * Resolve target subreddit from payload or env
 */
function resolveSubreddit(payload) {
  var sr = (payload && payload.subreddit) ? String(payload.subreddit).replace(/^r\//, '').trim() : '';
  return sr || process.env.REDDIT_DEFAULT_SUBREDDIT || 'AmbientPixels';
}

/**
 * Manual-post adapter — returns a receipt marking the post for manual publishing.
 * The action stays in the actions blob with execution.receipt.manual = true,
 * which the dashboard Reddit Outbox reads to surface copy-ready posts.
 */
async function publishToReddit(action) {
  const payload = action.payload || {};
  const text = (payload.text || '').trim();

  if (!text && !payload.title) {
    return {
      ok: false,
      error: 'Empty post text — cannot queue for manual posting'
    };
  }

  const { title, body } = parseTitleAndBody(payload);
  const subreddit = resolveSubreddit(payload);

  return {
    ok: true,
    receipt: {
      manual: true,
      platform: 'reddit',
      subreddit: 'r/' + subreddit,
      title: title,
      body: body,
      text: text,
      created_at: new Date().toISOString(),
      message: 'Approved for manual posting to Reddit (r/' + subreddit + '). Copy title and body from the dashboard outbox.'
    }
  };
}

module.exports = {
  publishToReddit,
  parseTitleAndBody,
  resolveSubreddit
};
