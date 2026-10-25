// Run: node _lib/youtube/uploader.test.js   (from api/)
'use strict';
const assert = require('assert');
const U = require('./uploader');

let passed = 0;
const pending = [];
function t(name, fn) {
  const fail = (err) => { console.error('FAIL', name, '\n ', err.message); process.exitCode = 1; };
  try { const r = fn(); if (r && r.then) pending.push(r.then(() => { passed++; }, fail)); else passed++; } catch (e) { fail(e); }
}
const ENV = { YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: 'csecret', YOUTUBE_REFRESH_TOKEN: 'rtok' };

// A fake Google: records every call, answers like the real endpoints.
function fakeGoogle(over) {
  over = over || {};
  const calls = [];
  const res = (status, json, headers) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json), headers: { get: (h) => (headers || {})[h.toLowerCase()] || null } });
  const f = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return over.token || res(200, { access_token: 'atok' });
    if (url.includes('/videos?uploadType=resumable')) return over.start || res(200, {}, { location: 'https://upload.example/session1' });
    if (url === 'https://upload.example/session1') return over.put || res(200, { id: 'VID123', status: { privacyStatus: 'private' } });
    if (url.includes('/captions?')) return over.captions || res(200, { id: 'cap1' });
    if (url.includes('/thumbnails/set')) return over.thumb || res(200, {});
    return res(404, {});
  };
  return { f, calls };
}

t('metadata: limits and no angle brackets', () => {
  const m = U.metadata({ title: 'A <b>title</b> ' + 'x'.repeat(200), description: 'd', tags: ['AmbientScore', 'conversion', '<x>'] }, 'public');
  assert.ok(m.snippet.title.length <= 100);
  assert.ok(!/[<>]/.test(m.snippet.title));
  assert.deepStrictEqual(m.snippet.tags, ['AmbientScore', 'conversion', 'x']);
  assert.strictEqual(m.status.privacyStatus, 'public');
  assert.strictEqual(m.status.selfDeclaredMadeForKids, false);
});

t('publish: token → resumable start → one PUT → captions → thumbnail', async () => {
  const g = fakeGoogle();
  const r = await U.publish({ title: 'Sizzle', description: 'Test', tags: ['a'] },
    { video: Buffer.from('mp4bytes'), captions: Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHi\n'), thumbnail: Buffer.from('jpg') },
    { env: ENV, fetch: g.f, privacyStatus: 'private' });
  assert.deepStrictEqual(r, { videoId: 'VID123', url: 'https://youtu.be/VID123', privacyStatus: 'private', captions: 'added', thumbnail: 'set' });
  assert.match(String(g.calls[0].init.body), /refresh_token=rtok/);
  assert.strictEqual(g.calls[1].init.headers['X-Upload-Content-Length'], '8');
  assert.strictEqual(g.calls[1].init.headers.Authorization, 'Bearer atok');
  assert.match(g.calls[1].url, /notifySubscribers=false/);
  assert.strictEqual(g.calls[2].init.method, 'PUT');
  assert.match(g.calls[3].init.body.toString(), /"videoId":"VID123"/);
});

t('an unknown privacy ask falls back to private; missing credentials say how to fix it', async () => {
  const g = fakeGoogle();
  await U.publish({ title: 'x' }, { video: Buffer.from('v') }, { env: ENV, fetch: g.f, privacyStatus: 'everyone' });
  assert.match(g.calls[1].init.body, /"privacyStatus":"private"/);
  await assert.rejects(U.publish({ title: 'x' }, { video: Buffer.from('v') }, { env: {}, fetch: g.f }), /scripts\/youtube-auth\.mjs/);
});

t('a refused upload is an error; failed captions or thumbnail are not', async () => {
  const bad = fakeGoogle({ start: { ok: false, status: 403, text: async () => 'quotaExceeded', headers: { get: () => null } } });
  await assert.rejects(U.publish({ title: 'x' }, { video: Buffer.from('v') }, { env: ENV, fetch: bad.f }), /refused the upload \(403\)/);
  const soft = fakeGoogle({ thumb: { ok: false, status: 403, json: async () => ({}), headers: { get: () => null } } });
  const r = await U.publish({ title: 'x' }, { video: Buffer.from('v'), thumbnail: Buffer.from('j') }, { env: ENV, fetch: soft.f });
  assert.strictEqual(r.videoId, 'VID123');
  assert.match(r.thumbnail, /phone verification/);
});

t('privacyOf reads a video\'s privacy, null once YouTube no longer has it', async () => {
  const res = (items) => ({ ok: true, status: 200, json: async () => ({ items }) });
  const f = (items) => async (url) => (url.startsWith('https://oauth2') ? { ok: true, json: async () => ({ access_token: 'atok' }) } : res(items));
  assert.strictEqual(await U.privacyOf('VID123', { env: ENV, fetch: f([{ id: 'VID123', status: { privacyStatus: 'public' } }]) }), 'public');
  assert.strictEqual(await U.privacyOf('VID123', { env: ENV, fetch: f([]) }), null);
});

Promise.all(pending).then(() => console.log(`youtube uploader: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`));
