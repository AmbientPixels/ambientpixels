// Run with: node js/company-store.serverbase.test.js
//
// Guards the API base resolution, which decides where every dashboard WRITE goes.
//
// Why this exists: the resolver selected the Function App only when the hostname
// contained 'ambientpixels.ai', falling back to a relative '/api' otherwise. But the
// production SWA also serves the entire dashboard on its default
// calm-sky-05cc8e110.6.azurestaticapps.net hostname (verified 200), and a POST to
// /api/* on ANY SWA host returns 405 Method Not Allowed — the SWA proxy does not
// accept POST. So on that hostname every approval and every "Post Now" 405'd, the
// server was never reached, and the action stayed at attempts:0 with nothing to see.
//
// The rule is not "is this the custom domain" — it is "does this host have its own
// backend to proxy to". Only local dev (SWA CLI) and the isolated ambientcore-demo do.

const assert = require('assert');
const CompanyStore = require('./company-store.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const FUNCTION_APP = 'https://ambientpixels-nova-api.azurewebsites.net/api';
const resolve = (h) => CompanyStore.resolveServerBase(h);

// ── Hosts that must go DIRECT to the Function App (a POST to /api here is a 405) ──

test('the custom domain resolves to the Function App', () => {
  assert.strictEqual(resolve('ambientpixels.ai'), FUNCTION_APP);
});

test('the www custom domain resolves to the Function App', () => {
  assert.strictEqual(resolve('www.ambientpixels.ai'), FUNCTION_APP);
});

test('THE REGRESSION: the prod SWA default hostname resolves to the Function App', () => {
  // This is the one that was broken. The prod SWA serves the full authenticated
  // dashboard here, so a CEO landing on this URL got a silent 405 on every write.
  assert.strictEqual(
    resolve('calm-sky-05cc8e110.6.azurestaticapps.net'),
    FUNCTION_APP,
    'prod SWA default hostname must not fall back to /api — POST there is 405'
  );
});

test('an unrecognised host defaults to the Function App, not to /api', () => {
  // Failing closed on the relative path is what made this invisible. Anything we do
  // not positively recognise as having its own backend gets the real API.
  assert.strictEqual(resolve('some-new-preview-host.azurestaticapps.net'), FUNCTION_APP);
});

// ── Hosts that legitimately proxy /api to their OWN backend ──

test('localhost keeps /api so the SWA CLI proxies to local functions', () => {
  assert.strictEqual(resolve('localhost'), '/api');
});

test('127.0.0.1 keeps /api', () => {
  assert.strictEqual(resolve('127.0.0.1'), '/api');
});

test('the isolated demo keeps /api so it never writes to the live API', () => {
  // ambientcore-demo has its own Function App carrying DEMO_MODE=true. Pointing it at
  // the production API would let demo traffic mutate real company state.
  assert.strictEqual(resolve('kind-ocean-06c6f7b10.4.azurestaticapps.net'), '/api');
});

// ── Shape ──

test('resolveServerBase is exposed as a pure function of the hostname', () => {
  assert.strictEqual(typeof CompanyStore.resolveServerBase, 'function');
  // Pure: same input, same output, no reliance on window.
  assert.strictEqual(resolve('ambientpixels.ai'), resolve('ambientpixels.ai'));
});

test('a missing hostname does not resolve to the relative path', () => {
  assert.strictEqual(resolve(''), FUNCTION_APP);
  assert.strictEqual(resolve(undefined), FUNCTION_APP);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
