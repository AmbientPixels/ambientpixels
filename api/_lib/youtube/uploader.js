// youtube/uploader.js — publish one video to the AmbientPixels YouTube channel (@ambientpixels6107).
//
// Credentials: YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN (Function App settings, written by
// scripts/youtube-auth.mjs) — never logged. The refresh token is exchanged for a short-lived access token per call.
//
// Until the project passes YouTube's API audit, Google locks every API upload to PRIVATE whatever we ask for, so
// callers ask for 'private' until systemConfig.youtube.audited is true (see publish.js). Only the upload is
// required; captions and the thumbnail are best-effort (a custom thumbnail needs a phone-verified channel).
'use strict';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3';
const MAX_BYTES = 256 * 1024 * 1024;

function creds(env) {
  env = env || process.env;
  const c = { clientId: env.YOUTUBE_CLIENT_ID, clientSecret: env.YOUTUBE_CLIENT_SECRET, refreshToken: env.YOUTUBE_REFRESH_TOKEN };
  if (!c.clientId || !c.clientSecret || !c.refreshToken) throw new Error('YouTube is not connected (run scripts/youtube-auth.mjs)');
  return c;
}

async function accessToken(env, fetchImpl) {
  const f = fetchImpl || fetch;
  const c = creds(env);
  const res = await f(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: 'refresh_token' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('YouTube sign-in failed (' + (j.error || res.status) + '); re-run scripts/youtube-auth.mjs if it was revoked');
  return j.access_token;
}

const clip = (s, n) => String(s || '').replace(/[<>]/g, '').slice(0, n);

// YouTube's limits: title ≤100, description ≤5000 bytes-ish, tags total ≤500 chars, no angle brackets anywhere.
function metadata(pkg, privacyStatus) {
  const tags = [];
  let total = 0;
  for (const t of Array.isArray(pkg.tags) ? pkg.tags : []) {
    const s = clip(t, 60).trim();
    if (!s || total + s.length + 1 > 450) continue;
    tags.push(s); total += s.length + 1;
  }
  return {
    snippet: { title: clip(pkg.title, 100), description: clip(pkg.description, 4900), tags, categoryId: String(pkg.categoryId || '28'), defaultLanguage: 'en', defaultAudioLanguage: 'en' },
    status: { privacyStatus, selfDeclaredMadeForKids: false, embeddable: true },
  };
}

// Upload the video (resumable protocol, one PUT). → { videoId, url, privacyStatus, captions, thumbnail }
async function publish(pkg, files, opts) {
  opts = opts || {};
  const f = opts.fetch || fetch;
  if (!files || !Buffer.isBuffer(files.video)) throw new Error('no video bytes');
  if (files.video.length > MAX_BYTES) throw new Error('video is larger than ' + (MAX_BYTES >> 20) + ' MB');
  const privacyStatus = ['public', 'unlisted', 'private'].indexOf(opts.privacyStatus) !== -1 ? opts.privacyStatus : 'private';
  const token = await accessToken(opts.env, f);
  const auth = { Authorization: 'Bearer ' + token };

  const start = await f(UPLOAD_URL + '/videos?uploadType=resumable&part=snippet,status&notifySubscribers=' + (privacyStatus === 'public'), {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(files.video.length), 'X-Upload-Content-Type': 'video/mp4' }, auth),
    body: JSON.stringify(metadata(pkg, privacyStatus)),
  });
  if (!start.ok) throw new Error('YouTube refused the upload (' + start.status + '): ' + (await start.text()).slice(0, 300));
  const session = start.headers.get('location');
  if (!session) throw new Error('YouTube gave no upload session');
  const put = await f(session, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(files.video.length) }, body: files.video });
  const video = await put.json().catch(() => ({}));
  if (!put.ok || !video.id) throw new Error('the upload did not finish (' + put.status + '): ' + JSON.stringify(video.error || video).slice(0, 300));
  const out = { videoId: video.id, url: 'https://youtu.be/' + video.id, privacyStatus: (video.status && video.status.privacyStatus) || privacyStatus, captions: null, thumbnail: null };

  if (files.captions) {
    try {
      const boundary = 'ap' + Date.now().toString(36);
      const body = Buffer.concat([
        Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify({ snippet: { videoId: video.id, language: 'en', name: 'English', isDraft: false } }) +
          '\r\n--' + boundary + '\r\nContent-Type: ' + (files.captionsType || 'application/x-subrip') + '\r\n\r\n'),
        Buffer.isBuffer(files.captions) ? files.captions : Buffer.from(String(files.captions)),
        Buffer.from('\r\n--' + boundary + '--'),
      ]);
      const r = await f(UPLOAD_URL + '/captions?uploadType=multipart&part=snippet', { method: 'POST', headers: Object.assign({ 'Content-Type': 'multipart/related; boundary=' + boundary }, auth), body });
      out.captions = r.ok ? 'added' : 'failed (' + r.status + ')';
    } catch (e) { out.captions = 'failed (' + e.message + ')'; }
  }
  if (files.thumbnail) {
    try {
      const r = await f(UPLOAD_URL + '/thumbnails/set?uploadType=media&videoId=' + encodeURIComponent(video.id), { method: 'POST', headers: Object.assign({ 'Content-Type': files.thumbnailType || 'image/jpeg' }, auth), body: files.thumbnail });
      out.thumbnail = r.ok ? 'set' : 'failed (' + r.status + (r.status === 403 ? ': the channel may need phone verification for custom thumbnails' : '') + ')';
    } catch (e) { out.thumbnail = 'failed (' + e.message + ')'; }
  }
  return out;
}

module.exports = { publish, accessToken, metadata, MAX_BYTES };
