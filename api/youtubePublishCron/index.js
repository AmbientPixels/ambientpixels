// youtubePublishCron — Timer Trigger (every 5 minutes). Publishes an approved video to the AmbientPixels YouTube
// channel: a request whose "Ready for YouTube" checkpoint Chad approved WITHOUT pasting a link (direct publishing).
// Off until the YouTube API audit passes: systemConfig.youtube.audited === true (privacy: systemConfig.youtube.privacy,
// default 'public'). Streams the package's files from the studio container, uploads (_lib/youtube/uploader.js), and
// writes "[studio:youtube <url>]" on the request task; the PC worker then marks the Board's "Release it" done with the
// link, which releases the video and tags @Echo. One video per run; three failed tries stop it (Chad sees them).
'use strict';

const storage = require('../_utils/companyStorage');
const demoGuard = require('../_utils/demoGuard');
const desk = require('../studio/desk');
const { getContainer } = require('../studio/blob');
const { blobKey } = require('../studio/lib');
const uploader = require('../_lib/youtube/uploader');

const MAX_FAILURES = 3;

// A request ready to go up: publish approved with no pasted link, not on YouTube yet, not failed out.
function nextToPublish(tasks) {
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!desk.isRequestTask(t) || t._archived) continue;
    const r = desk.parseRequest(t);
    const cp = r && r.checkpoints && r.checkpoints.publish;
    if (!cp || cp.status !== 'approved' || cp.reason) continue;
    if (r.youtube.url || r.youtube.failures >= MAX_FAILURES || !r.youtubePackage || !r.project) continue;
    return { task: t, r };
  }
  return null;
}

async function readFile(project, path) {
  if (!path) return null;
  try { return await (await getContainer()).getBlockBlobClient(blobKey(project, path)).downloadToBuffer(); }
  catch (e) { if (e.statusCode === 404) return null; throw e; }
}

async function note(taskId, text) {
  await storage.mutateState('tasks', function (fresh) {
    const t = (Array.isArray(fresh) ? fresh : []).find((x) => x && x.id === taskId);
    if (!t) return undefined;
    if (!Array.isArray(t.comments)) t.comments = [];
    const at = new Date().toISOString();
    t.comments.push({ id: 'cmt-yt-' + Date.now(), author: desk.INBOX, text, type: 'comment', createdAt: at });
    t.updatedAt = at;
    return fresh;
  });
}

async function run(context, deps) {
  deps = deps || {};
  const cfg = (await storage.getState('systemConfig')) || {};
  const yt = cfg.youtube || {};
  if (yt.audited !== true) return { skipped: 'not audited' };
  const d = new Date();
  if (d.getUTCHours() % 6 === 0 && d.getUTCMinutes() < 12) return { skipped: 'heartbeat window' };
  const tasksRead = await storage.getStateWithMeta('tasks');
  if (tasksRead.failed) return { skipped: 'board unreadable' };
  const next = nextToPublish(tasksRead.value);
  if (!next) return { idle: true };
  const { task, r } = next;
  const pkg = r.youtubePackage;
  try {
    const video = await readFile(r.project, pkg.files.video);
    if (!video) throw new Error('the master is not in the studio container yet (' + pkg.files.video + ')');
    const files = {
      video,
      captions: await readFile(r.project, pkg.files.captions), captionsType: /\.vtt$/i.test(pkg.files.captions || '') ? 'text/vtt' : 'application/x-subrip',
      thumbnail: await readFile(r.project, pkg.files.thumbnail), thumbnailType: /\.png$/i.test(pkg.files.thumbnail || '') ? 'image/png' : 'image/jpeg',
    };
    const privacy = ['public', 'unlisted', 'private'].indexOf(yt.privacy) !== -1 ? yt.privacy : 'public';
    const out = await (deps.publish || uploader.publish)(pkg, files, { privacyStatus: privacy });
    await note(task.id, '[studio:youtube ' + out.url + '] On YouTube (' + out.privacyStatus + '). Captions: ' + (out.captions || 'none') + '. Thumbnail: ' + (out.thumbnail || 'none') + '.');
    if (context) context.log('[youtubePublishCron] published', task.id, out.url, out.privacyStatus);
    return { published: out.url };
  } catch (err) {
    const msg = String((err && err.message) || err).slice(0, 300);
    await note(task.id, '[studio:youtube-failed] ' + msg + (r.youtube.failures + 1 >= MAX_FAILURES ? ' (third try: stopped; send it back or paste a link after uploading by hand)' : ' (will retry in 5 minutes)'));
    if (context) context.log.error('[youtubePublishCron] failed', task.id, msg);
    return { failed: msg };
  }
}

module.exports = async function (context) {
  if (demoGuard.timerSkip(context)) return;
  try { await run(context); }
  catch (err) { context.log.error('[youtubePublishCron] failed:', (err && err.message) || err); }
};
module.exports.run = run;
module.exports.nextToPublish = nextToPublish;
