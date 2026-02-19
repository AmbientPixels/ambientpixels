// media.js — Shared media download + validation for social platform executors
// Centralizes: host allowlist, download, mime validation, size enforcement

const https = require('https');
const http = require('http');

// Only allow images from our own blob storage
const ALLOWED_HOSTS = [
  'cardforgeblobdata.blob.core.windows.net'
];

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
];

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB default
const DOWNLOAD_TIMEOUT_MS = 30000;

/**
 * Validate a media URL against the host allowlist.
 * @param {string} url
 * @returns {{ valid: boolean, error?: string }}
 */
function validateMediaUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'Media URL is empty or not a string' };
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { valid: false, error: 'Media URL must use http or https scheme' };
  }
  try {
    var parsed = new URL(url);
    var host = parsed.hostname.toLowerCase();
    if (ALLOWED_HOSTS.indexOf(host) === -1) {
      return { valid: false, error: 'Host "' + host + '" not in allowlist. Allowed: ' + ALLOWED_HOSTS.join(', ') };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: 'Invalid URL: ' + e.message };
  }
}

/**
 * Extract the first valid media URL from an action's payload.media array.
 * Accepts both string URLs and { url: "..." } objects.
 * @param {Array} mediaArray - action.payload.media
 * @param {number} [maxItems=1] - max items to extract
 * @returns {Array<{ url: string, alt: string, assetId: string|null }>}
 */
function extractMediaItems(mediaArray, maxItems) {
  if (!Array.isArray(mediaArray)) return [];
  var max = maxItems || 1;
  var items = [];
  for (var i = 0; i < mediaArray.length && items.length < max; i++) {
    var m = mediaArray[i];
    var url = typeof m === 'string' ? m : (m && m.url);
    if (!url) continue;
    var check = validateMediaUrl(url);
    if (!check.valid) {
      console.log('[media] extractMediaItems: dropped item %d — %s', i, check.error);
      continue;
    }
    items.push({
      url: url,
      alt: (typeof m === 'object' && m.alt) || '',
      assetId: (typeof m === 'object' && m.assetId) || null
    });
  }
  return items;
}

/**
 * Download media from a validated URL. Returns { buffer, contentType, bytes }.
 * Enforces: allowed mime types, max byte size, timeout, redirect following (1 hop).
 * @param {string} url - Must have passed validateMediaUrl first
 * @param {Object} [opts]
 * @param {number} [opts.maxBytes] - Override default max bytes
 * @param {string[]} [opts.allowedTypes] - Override default allowed mime types
 * @returns {Promise<{ buffer: Buffer, contentType: string, bytes: number }>}
 */
function downloadMedia(url, opts) {
  var maxBytes = (opts && opts.maxBytes) || DEFAULT_MAX_BYTES;
  var allowedTypes = (opts && opts.allowedTypes) || ALLOWED_MIME_TYPES;

  return new Promise(function (resolve, reject) {
    var proto = url.startsWith('https') ? https : http;

    proto.get(url, { timeout: DOWNLOAD_TIMEOUT_MS }, function (res) {
      // Follow one redirect — re-check host allowlist + block protocol downgrade
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        var redirectUrl = res.headers.location;
        if (url.startsWith('https://') && redirectUrl.startsWith('http://')) {
          res.destroy();
          return reject({ code: 'REDIRECT_BLOCKED', message: 'Protocol downgrade blocked (https → http): ' + redirectUrl });
        }
        var redirectCheck = validateMediaUrl(redirectUrl);
        if (!redirectCheck.valid) {
          res.destroy();
          return reject({ code: 'REDIRECT_BLOCKED', message: 'Redirect to disallowed host: ' + redirectUrl });
        }
        return downloadMedia(redirectUrl, opts).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject({ code: 'DOWNLOAD_ERROR', message: 'HTTP ' + res.statusCode + ' fetching media' });
      }

      // Validate content-type before consuming body
      var ct = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (ct && allowedTypes.indexOf(ct) === -1) {
        res.destroy();
        return reject({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Type "' + ct + '" not allowed. Supported: ' + allowedTypes.join(', ') });
      }

      // Check content-length header if declared
      var declaredSize = parseInt(res.headers['content-length'], 10);
      if (declaredSize && declaredSize > maxBytes) {
        res.destroy();
        return reject({ code: 'MEDIA_TOO_LARGE', message: 'Declared size ' + Math.round(declaredSize / 1024) + 'KB exceeds ' + Math.round(maxBytes / 1024) + 'KB limit' });
      }

      var chunks = [];
      var totalBytes = 0;

      res.on('data', function (chunk) {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          res.destroy();
          return reject({ code: 'MEDIA_TOO_LARGE', message: 'Download exceeded ' + Math.round(maxBytes / 1024) + 'KB limit during transfer' });
        }
        chunks.push(chunk);
      });

      res.on('end', function () {
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: ct || 'image/jpeg',
          bytes: totalBytes
        });
      });

      res.on('error', function (err) {
        reject({ code: 'DOWNLOAD_ERROR', message: err.message });
      });
    }).on('error', function (err) {
      reject({ code: 'DOWNLOAD_ERROR', message: err.message });
    });
  });
}

module.exports = {
  validateMediaUrl,
  extractMediaItems,
  downloadMedia,
  ALLOWED_HOSTS,
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES
};
