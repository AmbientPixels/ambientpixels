// blueskyDiscovery.js — shared library for querying the AT Protocol search endpoint.
// Used by both the /api/blueskySearch HTTP endpoint and the heartbeat's Scout discovery handler.
// CID is required in every returned item — never strip it. AT Protocol reply payloads need it.
//
// As of mid-2026, public.api.bsky.app returns 403 for unauthenticated search.
// This module now authenticates via BLUESKY_HANDLE + BLUESKY_APP_PASSWORD env vars
// using com.atproto.server.createSession, then searches with the bearer token.

var fetch = require('node-fetch');

var AUTH_URL = 'https://bsky.social/xrpc/com.atproto.server.createSession';
var SEARCH_URL = 'https://bsky.social/xrpc/app.bsky.feed.searchPosts';

var _cachedToken = null;
var _cachedTokenExp = 0;

async function _getAuthToken() {
  if (_cachedToken && Date.now() < _cachedTokenExp) return _cachedToken;

  var handle = process.env.BLUESKY_HANDLE;
  var password = process.env.BLUESKY_APP_PASSWORD;
  if (!handle || !password) {
    throw new Error('BLUESKY_HANDLE and BLUESKY_APP_PASSWORD required for search');
  }

  var resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password: password })
  });

  if (!resp.ok) {
    var body = '';
    try { body = await resp.text(); } catch (_e) {}
    throw new Error('Bluesky auth failed: ' + resp.status + ' ' + body.substring(0, 200));
  }

  var data = await resp.json();
  _cachedToken = data.accessJwt;
  _cachedTokenExp = Date.now() + 45 * 60 * 1000; // refresh after 45 min
  return _cachedToken;
}

/**
 * Search Bluesky for posts matching a query, filtered by age and minimum replies.
 * @param {string} q - search keyword
 * @param {Object} opts - { maxAgeMinutes, minReplies, limit }
 * @returns {Promise<Array>} [{ uri, cid, author, authorDid, text, indexedAt, replyCount, repostCount, likeCount }]
 */
async function searchBluesky(q, opts) {
  opts = opts || {};
  var maxAgeMinutes = opts.maxAgeMinutes || 120;
  var minReplies = opts.minReplies || 0;
  var limit = Math.min(opts.limit || 25, 100);

  if (!q || q.length < 2) return [];

  var token = await _getAuthToken();
  var url = SEARCH_URL + '?q=' + encodeURIComponent(q) + '&limit=' + limit;
  var resp = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token }
  });

  if (!resp.ok) {
    // Token might be expired — retry once
    if (resp.status === 401) {
      _cachedToken = null;
      _cachedTokenExp = 0;
      token = await _getAuthToken();
      resp = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token }
      });
    }
    if (!resp.ok) throw new Error('Bluesky search returned ' + resp.status);
  }

  var data = await resp.json();
  var posts = Array.isArray(data.posts) ? data.posts : [];
  var cutoffMs = Date.now() - maxAgeMinutes * 60 * 1000;

  return posts
    .map(function (p) {
      var indexedAt = p.indexedAt || (p.record && p.record.createdAt) || null;
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
