// blueskyDiscovery.js — shared library for querying the AT Protocol public search endpoint.
// Used by both the /api/blueskySearch HTTP endpoint and the heartbeat's Scout discovery handler.
// CID is required in every returned item — never strip it. AT Protocol reply payloads need it.

const SEARCH_URL = 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts';

/**
 * Search Bluesky for posts matching a query, filtered by age and minimum replies.
 * @param {string} q - search keyword
 * @param {Object} opts - { maxAgeMinutes, minReplies, limit }
 * @returns {Promise<Array>} [{ uri, cid, author, authorDid, text, indexedAt, replyCount, repostCount, likeCount }]
 */
async function searchBluesky(q, opts) {
  opts = opts || {};
  const maxAgeMinutes = opts.maxAgeMinutes || 120;
  const minReplies = opts.minReplies || 0;
  const limit = Math.min(opts.limit || 25, 100);

  if (!q || q.length < 2) return [];

  const url = SEARCH_URL + '?q=' + encodeURIComponent(q) + '&limit=' + limit;
  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  if (!resp.ok) {
    throw new Error('Bluesky search returned ' + resp.status);
  }

  const data = await resp.json();
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const cutoffMs = Date.now() - maxAgeMinutes * 60 * 1000;

  return posts
    .map(function (p) {
      const indexedAt = p.indexedAt || (p.record && p.record.createdAt) || null;
      return {
        uri: p.uri || '',
        cid: p.cid || '',
        author: (p.author && p.author.handle) || '',
        authorDid: (p.author && p.author.did) || '',
        text: (p.record && p.record.text) || '',
        indexedAt: indexedAt,
        replyCount: p.replyCount || 0,
        repostCount: p.repostCount || 0,
        likeCount: p.likeCount || 0
      };
    })
    .filter(function (p) {
      if (!p.uri || !p.cid) return false;
      if (!p.indexedAt) return false;
      if (new Date(p.indexedAt).getTime() < cutoffMs) return false;
      if (p.replyCount < minReplies) return false;
      return true;
    });
}

/**
 * Run discovery across a list of keywords. Merges results, dedups by uri,
 * sorts by engagement velocity (replies per minute since indexedAt).
 * @param {Array<string>} keywords
 * @param {Object} opts - { maxAgeMinutes, minReplies, limitPerKeyword }
 * @returns {Promise<Array>} sorted unique posts
 */
async function discoverAcrossKeywords(keywords, opts) {
  opts = opts || {};
  const results = [];
  const seenUris = {};

  for (const kw of keywords) {
    try {
      const batch = await searchBluesky(kw, {
        maxAgeMinutes: opts.maxAgeMinutes || 120,
        minReplies: opts.minReplies || 1,
        limit: opts.limitPerKeyword || 25
      });
      batch.forEach(function (p) {
        if (seenUris[p.uri]) return;
        seenUris[p.uri] = true;
        // Engagement velocity: replies per minute since posting
        const ageMin = Math.max(1, (Date.now() - new Date(p.indexedAt).getTime()) / 60000);
        p._velocity = p.replyCount / ageMin;
        p._matchedKeyword = kw;
        results.push(p);
      });
    } catch (_kwErr) {
      // non-fatal: skip this keyword, continue
    }
  }

  // Sort by velocity descending
  results.sort(function (a, b) { return b._velocity - a._velocity; });
  return results;
}

module.exports = {
  searchBluesky,
  discoverAcrossKeywords
};
