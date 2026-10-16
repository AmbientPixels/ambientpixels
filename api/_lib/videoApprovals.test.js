// Run: node _lib/videoApprovals.test.js   (from api/)
'use strict';
const assert = require('assert');
const V = require('./videoApprovals');
const desk = require('../studio/desk');

let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (err) { console.error('FAIL', name, '\n ', err.message); process.exitCode = 1; } }
const NOW = '2026-10-16T12:00:00.000Z';
const LATER = '2026-10-16T13:00:00.000Z';

const r0 = desk.cleanRequest({
  trigger: { type: 'manual', ref: 'ceo-test' }, product: 'AmbientScore', format: 'walkthrough', mood: 'ambient', seconds: 76,
  title: 'What a free scan shows you', goal: 'Run a free scan on their own site',
  claims: [{ claim: 'Free scan, no login', source: 'product-facts:AmbientScore' }],
}, 'ceo');
function reqTask(over) {
  return Object.assign({ id: 'task-1792000000000-ab12', created_by: 'ceo', createdAt: NOW, comments: [] }, desk.requestTask(r0), over || {});
}
const studio = (text) => ({ author: 'studio', text, createdAt: NOW });
const ceo = (text) => ({ author: 'ceo', text, createdAt: NOW });
const marked = (stage, extra) => [studio(desk.studioMark(stage, '01-scan', 'ambientpixels') + ' On the Board.')].concat(extra || []);

t('a waiting request gets one pending item, with Pixel\'s recommendation, and no duplicate on the next sync', () => {
  const task = reqTask({ comments: [{ author: 'pixel', text: 'RECOMMEND: accept. Fits the goal.', createdAt: NOW }] });
  const q = [];
  assert.strictEqual(V.syncQueue(q, [task], NOW).changed, true);
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].id, V.requestItemId(task.id));
  assert.strictEqual(q[0].type, 'video_request');
  assert.strictEqual(q[0].status, 'pending');
  assert.match(q[0].recommendation, /^RECOMMEND: accept/);
  assert.match(q[0].summary, /AmbientScore · walkthrough · ~76 s · goal: Run a free scan/);
  assert.strictEqual(V.syncQueue(q, [task], LATER).changed, false);
  assert.strictEqual(q.length, 1);
});

t('a request decided on the board resolves its item (accepted → approved, canceled → rejected)', () => {
  const q = [];
  V.syncQueue(q, [reqTask()], NOW);
  V.syncQueue(q, [reqTask({ status: 'in-progress' })], LATER);
  assert.strictEqual(q[0].status, 'approved');
  assert.strictEqual(q[0].resolvedBy, 'board');
  const q2 = [];
  V.syncQueue(q2, [reqTask()], NOW);
  V.syncQueue(q2, [reqTask({ status: 'canceled', comments: [ceo('Not now')] })], LATER);
  assert.strictEqual(q2[0].status, 'rejected');
});

t('an item dropped by a queue cap comes back; a gone task closes its item', () => {
  const q = [];
  V.syncQueue(q, [reqTask()], NOW);
  q.length = 0; // a 100-entry splice elsewhere
  V.syncQueue(q, [reqTask()], LATER);
  assert.strictEqual(q.length, 1);
  V.syncQueue(q, [], LATER);
  assert.strictEqual(q[0].status, 'resolved');
});

t('decide on a request: approve → in-progress; decline needs a reason and leaves it as Chad\'s comment', () => {
  const q = []; const tasks = [reqTask()];
  V.syncQueue(q, tasks, NOW);
  assert.strictEqual(V.decide(q[0], 'rejected', '  ', tasks, LATER).code, 400);
  const ok = V.decide(q[0], 'approved', '', tasks, LATER);
  assert.ok(ok.ok);
  assert.strictEqual(tasks[0].status, 'in-progress');
  assert.strictEqual(V.decide(q[0], 'approved', '', tasks, LATER).code, 409); // already decided
  const t2 = [reqTask()];
  assert.ok(V.decide(q[0], 'rejected', 'No release worth a video yet', t2, LATER).ok);
  assert.strictEqual(t2[0].status, 'canceled');
  assert.strictEqual(desk.parseRequest(t2[0]).reason, 'No release worth a video yet');
});

t('a script checkpoint opens an item with a Studio link; approving it marks the task; a new round opens a new item', () => {
  const task = reqTask({ status: 'in-progress', comments: marked('scripting', [studio(desk.checkpointMark('script') + ' 168 words, 3 claims checked.')]) });
  const q = [];
  V.syncQueue(q, [task], NOW);
  const it = q.find((x) => x.type === 'video_checkpoint');
  assert.ok(it, 'checkpoint item');
  assert.strictEqual(it.id, V.checkpointItemId(task.id, 'script', 1));
  assert.strictEqual(it.link, 'https://www.ambientpixels.ai/studio/#/p/ambientpixels/v/01-scan/script');
  assert.match(it.title, /^Script ready: /);
  assert.match(it.summary, /168 words/);
  assert.strictEqual(V.decide(it, 'rejected', '', [task], LATER).code, 400);
  assert.ok(V.decide(it, 'rejected', 'Cut the second claim', [task], LATER).ok);
  const cp = desk.parseRequest(task).checkpoints.script;
  assert.strictEqual(cp.status, 'sent_back');
  assert.strictEqual(cp.reason, 'Cut the second claim');
  it.status = 'rejected'; // proposalDecide flips the item itself
  task.comments.push(studio(desk.checkpointMark('script') + ' Second claim cut.'));
  V.syncQueue(q, [task], LATER);
  const next = q.find((x) => x.id === V.checkpointItemId(task.id, 'script', 2));
  assert.ok(next && next.status === 'pending', 'round 2 item');
  assert.strictEqual(V.decide(it, 'approved', '', [task], LATER).code, 409); // round 1 is closed
  assert.ok(V.decide(next, 'approved', '', [task], LATER).ok);
  assert.strictEqual(desk.parseRequest(task).checkpoints.script.status, 'approved');
});

t('checkpoint items close when the request ends or the decision was made on the task', () => {
  const task = reqTask({ status: 'in-progress', comments: marked('in_production', [studio(desk.checkpointMark('cut'))]) });
  const q = [];
  V.syncQueue(q, [task], NOW);
  task.comments.push(ceo(desk.ceoMark('approved', 'cut')));
  V.syncQueue(q, [task], LATER);
  assert.strictEqual(q.find((x) => x.type === 'video_checkpoint').status, 'approved');
  const t2 = reqTask({ id: 'task-1792000000001-cd34', status: 'in-progress', comments: marked('review', [studio(desk.checkpointMark('cut'))]) });
  const q2 = [];
  V.syncQueue(q2, [t2], NOW);
  t2.status = 'done';
  V.syncQueue(q2, [t2], LATER);
  assert.strictEqual(q2.find((x) => x.type === 'video_checkpoint').status, 'resolved');
});

t('a fake checkpoint or decision from anyone else is ignored', () => {
  const task = reqTask({ status: 'in-progress', comments: marked('scripting', [{ author: 'echo', text: desk.checkpointMark('script'), createdAt: NOW }]) });
  const q = [];
  V.syncQueue(q, [task], NOW);
  assert.strictEqual(q.filter((x) => x.type === 'video_checkpoint').length, 0);
});

t('onlyTaskId leaves other requests and their items alone', () => {
  const a = reqTask(), b = reqTask({ id: 'task-1792000000002-ef56' });
  const q = [];
  V.syncQueue(q, [a], NOW, { onlyTaskId: a.id });
  assert.strictEqual(q.length, 1);
  V.syncQueue(q, [b], NOW, { onlyTaskId: b.id });
  assert.strictEqual(q.length, 2);
  assert.ok(q.every((x) => x.status === 'pending'));
});

t('Ready for YouTube: the package shows; approve needs a YouTube link until the audit switch is on', () => {
  const pkg = desk.cleanPackage({ title: 'What a free scan shows you', description: 'Run a free scan.\nMore.', tags: ['AmbientScore'],
    files: { video: 'renders/ambientpixels/01/01-scan-d4-master.mp4', captions: 'renders/ambientpixels/01/01-scan-d4.srt', thumbnail: 'renders/ambientpixels/01/01-scan-d4-poster.png' } }, 'ambientpixels');
  assert.strictEqual(typeof pkg, 'object', pkg);
  const task = reqTask({ status: 'in-progress', youtubePackage: pkg, comments: marked('review', [studio(desk.checkpointMark('publish'))]) });
  const q = [];
  V.syncQueue(q, [task], NOW);
  const it = q.find((x) => x.checkpoint === 'publish');
  assert.match(it.title, /^Ready for YouTube: /);
  assert.match(it.summary, /"What a free scan shows you" · Run a free scan\. · captions · thumbnail/);
  assert.strictEqual(it.autoPublish, false);
  assert.strictEqual(V.decide(it, 'approved', '', [task], LATER).code, 400); // no link, no audit
  assert.strictEqual(V.decide(it, 'approved', 'https://example.com/x', [task], LATER).code, 400);
  assert.ok(V.decide(it, 'approved', 'https://youtu.be/KFTzJqT7c9k', [task], LATER).ok);
  assert.strictEqual(desk.parseRequest(task).checkpoints.publish.reason, 'https://youtu.be/KFTzJqT7c9k');
  // After the audit: the item offers Publish now, and approving without a link is allowed.
  const t2 = reqTask({ id: 'task-1792000000003-gh78', status: 'in-progress', youtubePackage: pkg, comments: marked('review', [studio(desk.checkpointMark('publish'))]) });
  const q2 = [];
  V.syncQueue(q2, [t2], NOW, { autoPublish: true });
  const it2 = q2.find((x) => x.checkpoint === 'publish');
  assert.strictEqual(it2.autoPublish, true);
  assert.ok(V.decide(it2, 'approved', '', [t2], LATER, { autoPublish: true }).ok);
});

t('the package check refuses paths outside the project\'s renders and a missing title', () => {
  assert.match(desk.cleanPackage({ title: 'Long enough', files: { video: '../secrets.mp4' } }, 'ambientpixels'), /files\.video/);
  assert.match(desk.cleanPackage({ title: 'Long enough', files: { video: 'renders/hanson-agents/x.mp4' } }, 'ambientpixels'), /files\.video/);
  assert.match(desk.cleanPackage({ title: 'x', files: { video: 'renders/ambientpixels/x.mp4' } }, 'ambientpixels'), /title/);
  const p = desk.cleanPackage({ title: 'A good title', files: { video: 'renders/ambientpixels/a/x-master.mp4', captions: 'C:/x.srt' } }, 'ambientpixels');
  assert.strictEqual(p.files.captions, null);
});

t('the publish timer picks an approved, link-less, not-yet-uploaded request; the YouTube marker closes it', () => {
  const C = require('../youtubePublishCron/index.js');
  const pkg = desk.cleanPackage({ title: 'A good title', files: { video: 'renders/ambientpixels/a/x-master.mp4' } }, 'ambientpixels');
  const base = marked('review', [studio(desk.checkpointMark('publish'))]);
  const ready = reqTask({ status: 'in-progress', youtubePackage: pkg, comments: base.concat([ceo(desk.ceoMark('approved', 'publish'))]) });
  assert.strictEqual(C.nextToPublish([ready]).task.id, ready.id);
  const manual = reqTask({ status: 'in-progress', youtubePackage: pkg, comments: base.concat([ceo(desk.ceoMark('approved', 'publish') + ' https://youtu.be/KFTzJqT7c9k')]) });
  assert.strictEqual(C.nextToPublish([manual]), null);
  ready.comments.push(studio('[studio:youtube https://youtu.be/KFTzJqT7c9k] On YouTube (public).'));
  assert.strictEqual(C.nextToPublish([ready]), null);
  assert.strictEqual(desk.parseRequest(ready).youtube.url, 'https://youtu.be/KFTzJqT7c9k');
  const failing = reqTask({ status: 'in-progress', youtubePackage: pkg, comments: base.concat([ceo(desk.ceoMark('approved', 'publish')),
    studio('[studio:youtube-failed] a'), studio('[studio:youtube-failed] b'), studio('[studio:youtube-failed] c')]) });
  assert.strictEqual(C.nextToPublish([failing]), null);
});

console.log(`videoApprovals: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
