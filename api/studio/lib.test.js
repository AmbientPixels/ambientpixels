// Run with: node api/studio/lib.test.js
// The load-bearing cases: an unset key never grants access (fail closed, unlike the CEO secret's rollback
// path), and a file path can never leave its own project's folders.
const assert = require('assert');
const L = require('./lib');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
const req = (h) => ({ headers: h });

t('operator: right key passes', () => assert.strictEqual(L.isOperator(req({ 'x-studio-key': 'k1' }), { STUDIO_ACCESS_KEY: 'k1' }), true));
t('operator: wrong key fails', () => assert.strictEqual(L.isOperator(req({ 'x-studio-key': 'k2' }), { STUDIO_ACCESS_KEY: 'k1' }), false));
t('operator: unset env fails closed, even with no header', () => assert.strictEqual(L.isOperator(req({}), {}), false));
t('operator: unset env fails closed with any header', () => assert.strictEqual(L.isOperator(req({ 'x-studio-key': 'x' }), {}), false));
t('operator: empty header fails', () => assert.strictEqual(L.isOperator(req({ 'x-studio-key': '' }), { STUDIO_ACCESS_KEY: 'k1' }), false));
t('worker token is not the operator key', () => assert.strictEqual(L.isOperator(req({ 'x-studio-worker-token': 'w' }), { STUDIO_ACCESS_KEY: 'w', STUDIO_WORKER_TOKEN: 'w' }), false));
t('worker: right token passes', () => assert.strictEqual(L.isWorker(req({ 'x-studio-worker-token': 'w' }), { STUDIO_WORKER_TOKEN: 'w' }), true));
t('worker: unset env fails closed', () => assert.strictEqual(L.isWorker(req({ 'x-studio-worker-token': 'w' }), {}), false));

t('projects: unset means none', () => assert.deepStrictEqual(L.hostedProjects({}), []));
t('projects: list parses and drops junk', () => assert.deepStrictEqual(L.hostedProjects({ STUDIO_PROJECTS: 'ambientpixels, hanson-agents,../x,' }), ['ambientpixels', 'hanson-agents']));

t('path: render inside the project', () => assert.strictEqual(L.validFilePath('hanson-agents', 'renders/hanson-agents/polish/00-welcome-draft13-master.mp4'), true));
t('path: project text', () => assert.strictEqual(L.validFilePath('hanson-agents', 'projects/hanson-agents/docs/edit/01-first-morning-frame-timing.json'), true));
t('path: another project is refused', () => assert.strictEqual(L.validFilePath('hanson-agents', 'renders/xbox-gps/v4.mp4'), false));
t('path: traversal is refused', () => assert.strictEqual(L.validFilePath('hanson-agents', 'renders/hanson-agents/../xbox-gps/v4.mp4'), false));
t('path: backslash is refused', () => assert.strictEqual(L.validFilePath('hanson-agents', 'renders\\hanson-agents\\a.mp4'), false));
t('path: absolute is refused', () => assert.strictEqual(L.validFilePath('hanson-agents', '/renders/hanson-agents/a.mp4'), false));
t('path: outside the three roots is refused', () => assert.strictEqual(L.validFilePath('hanson-agents', 'tools/hanson-agents/x.py'), false));
t('path: the project folder alone is refused', () => assert.strictEqual(L.validFilePath('hanson-agents', 'renders/hanson-agents'), false));

const P = 'hanson-agents';
t('event: a note keeps video, draft, time, text', () => {
  const e = L.cleanEvent(P, { type: 'note', video: '04-agent-team', draft: 'draft10', t: 12.345, text: ' ring too tight ' });
  assert.deepStrictEqual([e.type, e.video, e.draft, e.t, e.text], ['note', '04-agent-team', 'draft10', 12.3, 'ring too tight']);
});
t('event: unknown type refused', () => assert.strictEqual(typeof L.cleanEvent(P, { type: 'exec', cmd: 'rm' }), 'string'));
t('event: note without text refused', () => assert.strictEqual(typeof L.cleanEvent(P, { type: 'note', video: 'v', t: 1 }), 'string'));
t('event: note video with a slash refused', () => assert.strictEqual(typeof L.cleanEvent(P, { type: 'note', video: '../x', t: 1, text: 'a' }), 'string'));
t('event: pick outside the project refused', () => assert.strictEqual(typeof L.cleanEvent(P, { type: 'pick', path: 'renders/xbox-gps/a.mp3' }), 'string'));
t('event: answer needs a letter or other', () => {
  assert.strictEqual(typeof L.cleanEvent(P, { type: 'answer', file: 'projects/hanson-agents/Q.md', n: 1, choice: 'zz' }), 'string');
  assert.strictEqual(L.cleanEvent(P, { type: 'answer', file: 'projects/hanson-agents/Q.md', n: 2, choice: 'b' }).choice, 'b');
  assert.strictEqual(typeof L.cleanEvent(P, { type: 'answer', file: 'projects/hanson-agents/Q.md', n: 2, choice: 'other' }), 'string');
});
t('event: decision needs approved|changes', () => {
  assert.strictEqual(typeof L.cleanEvent(P, { type: 'decision', video: 'v', draft: 'd', decision: 'release' }), 'string');
  assert.strictEqual(L.cleanEvent(P, { type: 'decision', video: 'v', draft: 'd', decision: 'approved' }).decision, 'approved');
});
t('event: extra fields are dropped', () => assert.strictEqual(L.cleanEvent(P, { type: 'note', video: 'v', t: 1, text: 'a', path: '/etc' }).path, undefined));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
