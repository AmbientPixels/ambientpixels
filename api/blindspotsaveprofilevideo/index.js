// Save endpoint for player profile videos (Blindspot splash hover playback).
//
// Admin-only POST. Accepts a raw video binary (max 5 MB, mp4 or webm) with
// targetUserId in query string. Validates magic bytes + size, writes the
// blob, and updates the player's profile.json with profileVideo URL +
// profileVideoUpdatedAt timestamp. Empty body + ?action=delete clears the
// stored URL (and removes the blob).
//
// Storage path: cardforge/blindspot/profiles/{targetUserId}/video.{ext}
//
// Auth model mirrors blindspotadminconfig — caller's userId must be in
// ADMIN_USER_IDS. The targetUserId is whose profile we're editing on
// behalf of (the videos are seeded by the admin during the v1 phase).

const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const STORAGE_ACCOUNT_NAME = 'cardforgeblobdata';
const CONTAINER_NAME = 'cardforge';
const ADMIN_USER_IDS = ['5bb115c5-9077-4049-8af0-ce5085a9c315'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB hard cap
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

// Magic byte signatures.
// MP4 ISO Base Media File Format: bytes 4-7 spell 'ftyp' for any well-formed
// container (MP4, MOV, M4V). Bytes 0-3 are the box size — variable, so we
// only check the 'ftyp' fingerprint. Common subtypes: isom, mp42, qt, M4V.
const MP4_FTYP = Buffer.from('ftyp', 'ascii');
// WebM is an EBML container — magic bytes 1A 45 DF A3.
const WEBM_MAGIC = Buffer.from([0x1A, 0x45, 0xDF, 0xA3]);

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, X-CF-Auth-Principal, X-User-ID'
};

async function createBlobServiceClient() {
  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    return BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
  }
  return new BlobServiceClient(
    `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
}

function extractUserInfo(req, context) {
  const swaPrincipal = req.headers['x-ms-client-principal'];
  if (swaPrincipal) {
    try {
      const cp = JSON.parse(Buffer.from(swaPrincipal, 'base64').toString('utf8'));
      const userId = cp.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      context.log.warn(`[saveprofilevideo] SWA principal parse failed: ${err.message}`);
    }
  }
  const cfPrincipal = req.headers['x-cf-auth-principal'];
  if (cfPrincipal) {
    try {
      const cp = JSON.parse(cfPrincipal);
      const userId = cp.userId || 'anonymous';
      return { userId, isAuthenticated: userId !== 'anonymous' };
    } catch (err) {
      context.log.warn(`[saveprofilevideo] X-CF principal parse failed: ${err.message}`);
    }
  }
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Production') {
    const devUserId = req.headers['x-user-id'];
    if (devUserId) return { userId: devUserId, isAuthenticated: true };
  }
  return { userId: 'anonymous', isAuthenticated: false };
}

function detectFormat(buf) {
  // WebM
  if (buf.length >= 4 && buf.subarray(0, 4).equals(WEBM_MAGIC)) {
    return 'webm';
  }
  // MP4: 'ftyp' should appear at offset 4.
  if (buf.length >= 8 && buf.subarray(4, 8).equals(MP4_FTYP)) {
    return 'mp4';
  }
  return null;
}

async function downloadJsonBlob(containerClient, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  if (!(await blobClient.exists())) return null;
  const resp = await blobClient.download(0);
  const chunks = [];
  for await (const chunk of resp.readableStreamBody) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function uploadJsonBlob(containerClient, blobName, data) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  const json = JSON.stringify(data);
  await blobClient.upload(json, Buffer.byteLength(json, 'utf8'), {
    blobHTTPHeaders: { blobContentType: 'application/json' }
  });
}

module.exports = async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS_HEADERS, body: '' };
    return;
  }

  // Auth: caller must be admin
  const { userId, isAuthenticated } = extractUserInfo(req, context);
  if (!isAuthenticated || !ADMIN_USER_IDS.includes(userId)) {
    context.log.warn(`[saveprofilevideo] forbidden caller=${userId}`);
    context.res = { status: 403, headers: CORS_HEADERS, body: JSON.stringify({ error: 'forbidden' }) };
    return;
  }

  // targetUserId — whose profile we're editing
  const targetUserId = (req.query && req.query.targetUserId) || '';
  if (!USER_ID_PATTERN.test(targetUserId)) {
    context.res = { status: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'invalid_target_user_id' }) };
    return;
  }

  const isDelete = req.query && req.query.action === 'delete';

  try {
    const blobServiceClient = await createBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);
    const profilePath = `blindspot/profiles/${targetUserId}.json`;
    const profile = await downloadJsonBlob(containerClient, profilePath);
    if (!profile) {
      context.res = { status: 404, headers: CORS_HEADERS, body: JSON.stringify({ error: 'profile_not_found' }) };
      return;
    }

    if (isDelete) {
      // Best-effort delete of any prior video blob — don't fail the
      // profile update if the blob is already gone.
      const exts = ['webm', 'mp4'];
      for (const ext of exts) {
        const path = `blindspot/profiles/${targetUserId}/video.${ext}`;
        try { await containerClient.getBlockBlobClient(path).deleteIfExists(); }
        catch (e) { context.log.warn(`[saveprofilevideo] delete ${path}: ${e.message}`); }
      }
      profile.profileVideo = '';
      profile.profileVideoUpdatedAt = new Date().toISOString();
      profile.userId = targetUserId;
      await uploadJsonBlob(containerClient, profilePath, profile);
      context.log(`[saveprofilevideo] cleared video for target=${targetUserId} by admin=${userId}`);
      context.res = {
        status: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ targetUserId, profileVideo: '', deleted: true })
      };
      return;
    }

    // Normalise body to Buffer (Azure binary delivery is usually Buffer
    // but base64 string is the documented fallback).
    let body = req.body;
    if (typeof body === 'string') {
      try { body = Buffer.from(body, 'base64'); }
      catch (decErr) { context.log.warn(`[saveprofilevideo] base64 decode failed: ${decErr.message}`); }
    }
    if (!Buffer.isBuffer(body) || body.length === 0) {
      context.res = { status: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'empty_body' }) };
      return;
    }
    if (body.length > MAX_BYTES) {
      context.res = {
        status: 413,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'too_large', maxBytes: MAX_BYTES, received: body.length })
      };
      return;
    }

    const format = detectFormat(body);
    if (!format) {
      context.res = {
        status: 415,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'unsupported_format', accepted: ['video/mp4', 'video/webm'] })
      };
      return;
    }

    // If the player previously had a video in the OTHER format, drop it
    // so the profile only carries one canonical pointer + one stored blob.
    const otherExt = format === 'webm' ? 'mp4' : 'webm';
    try {
      await containerClient
        .getBlockBlobClient(`blindspot/profiles/${targetUserId}/video.${otherExt}`)
        .deleteIfExists();
    } catch (e) {
      context.log.warn(`[saveprofilevideo] cleanup other-format failed: ${e.message}`);
    }

    const blobPath = `blindspot/profiles/${targetUserId}/video.${format}`;
    const blobClient = containerClient.getBlockBlobClient(blobPath);
    await blobClient.uploadData(body, {
      blobHTTPHeaders: {
        blobContentType: format === 'webm' ? 'video/webm' : 'video/mp4',
        blobCacheControl: 'public, max-age=86400' // 1 day — videos are stable per upload
      }
    });

    const url = `https://${STORAGE_ACCOUNT_NAME}.blob.core.windows.net/${CONTAINER_NAME}/${blobPath}`;
    profile.profileVideo = url;
    profile.profileVideoUpdatedAt = new Date().toISOString();
    profile.userId = targetUserId;
    await uploadJsonBlob(containerClient, profilePath, profile);

    context.log(`[saveprofilevideo] target=${targetUserId} format=${format} bytes=${body.length} admin=${userId}`);
    context.res = {
      status: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ targetUserId, profileVideo: url, format, bytes: body.length })
    };
  } catch (err) {
    context.log.error(`[saveprofilevideo] ${err.stack || err.message}`);
    context.res = { status: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'storage_error', details: err.message }) };
  }
};
