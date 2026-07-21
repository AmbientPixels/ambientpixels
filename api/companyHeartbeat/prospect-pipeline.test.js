// Run: node api/companyHeartbeat/prospect-pipeline.test.js
const assert = require('node:assert');
const PP = require('./prospect-pipeline');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

const BLOCK = {
  ownDomains: ['ambientpixels.ai', 'azurestaticapps.net'],
  domainBlocklist: ['bit.ly', 'github.com', 'bsky.app']
};

// ── extractSiteUrl ──
test('prefers candidate.links over text', () => {
  const r = PP.extractSiteUrl({ links: ['https://mysite.io/x'], text: 'see https://other.com' }, BLOCK);
  assert.strictEqual(r.siteUrl, 'https://mysite.io/x');
  assert.strictEqual(r.domain, 'mysite.io');
});

test('falls back to first http(s) URL in text, strips trailing punctuation', () => {
  const r = PP.extractSiteUrl({ links: [], text: 'just launched https://cool.dev/app!' }, BLOCK);
  assert.strictEqual(r.siteUrl, 'https://cool.dev/app');
});

test('skips blocked and own domains, takes next candidate', () => {
  const r = PP.extractSiteUrl({ links: ['https://bit.ly/x', 'https://real.site'], text: '' }, BLOCK);
  assert.strictEqual(r.domain, 'real.site');
});

test('subdomain of blocked domain is blocked', () => {
  const r = PP.extractSiteUrl({ links: ['https://foo.azurestaticapps.net'], text: '' }, BLOCK);
  assert.strictEqual(r, null);
});

test('no usable URL yields null', () => {
  assert.strictEqual(PP.extractSiteUrl({ links: [], text: 'launched my site today, so proud' }, BLOCK), null);
  assert.strictEqual(PP.extractSiteUrl({ links: ['https://github.com/me/repo'], text: '' }, BLOCK), null);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
