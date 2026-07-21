// Run: node api/_utils/blueskyDiscovery.test.js
const assert = require('node:assert');
const { _extractPostLinks } = require('./blueskyDiscovery');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '-', e.message); }
}

test('extracts link facets from record.facets', () => {
  const p = { record: { facets: [
    { features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://mysite.io/' }] },
    { features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:x' }] }
  ] } };
  assert.deepStrictEqual(_extractPostLinks(p), ['https://mysite.io/']);
});

test('extracts record.embed.external.uri', () => {
  const p = { record: { embed: { external: { uri: 'https://card.example.com' } } } };
  assert.deepStrictEqual(_extractPostLinks(p), ['https://card.example.com']);
});

test('extracts view-level embed.external.uri', () => {
  const p = { embed: { external: { uri: 'https://view.example.com' } } };
  assert.deepStrictEqual(_extractPostLinks(p), ['https://view.example.com']);
});

test('dedups and ignores garbage', () => {
  const p = {
    record: {
      facets: [{ features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://a.com' }] }],
      embed: { external: { uri: 'https://a.com' } }
    },
    embed: { external: { uri: 42 } }
  };
  assert.deepStrictEqual(_extractPostLinks(p), ['https://a.com']);
});

test('empty post yields empty array', () => {
  assert.deepStrictEqual(_extractPostLinks({}), []);
  assert.deepStrictEqual(_extractPostLinks(null), []);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
