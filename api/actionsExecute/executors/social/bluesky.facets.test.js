// Run with: node api/actionsExecute/executors/social/bluesky.facets.test.js
//
// Bluesky only treats "#thing" as a real tag if the post record carries an
// app.bsky.richtext.facet#tag facet for it. Without one it is plain text:
// not clickable, not indexed, and invisible to every tag-driven custom feed.
// Custom feeds are the entire discovery surface on Bluesky — the Following
// feed is reverse-chronological, so an unfaceted post reaches your followers
// and nobody else. 195 posts to Aug 2026 carried no tag facets at all.
//
// The offsets are the dangerous part. They are UTF-8 BYTE offsets, not string
// indices, and a facet whose range is wrong either renders over the wrong
// characters or gets the whole createRecord rejected — which would turn a
// discovery fix into a publishing outage. Every test below re-slices the raw
// UTF-8 buffer and asserts it lands exactly on the intended text.

const assert = require('assert');
const { detectFacets } = require('./bluesky');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const TAG = 'app.bsky.richtext.facet#tag';
const LINK = 'app.bsky.richtext.facet#link';
const MENTION = 'app.bsky.richtext.facet#mention';

function typeOf(f) { return f.features[0].$type; }
function tagsIn(text) { return detectFacets(text).filter(f => typeOf(f) === TAG); }
// The load-bearing assertion: re-slice the raw bytes and confirm the facet
// covers exactly the substring it claims to.
function sliceOf(text, facet) {
  return Buffer.from(text, 'utf8').slice(facet.index.byteStart, facet.index.byteEnd).toString('utf8');
}

t('a hashtag produces a tag facet whose value drops the #', function () {
  const text = 'Shipping an agent that roasts resumes. #buildinpublic';
  const tags = tagsIn(text);
  assert.strictEqual(tags.length, 1, 'expected exactly one tag facet');
  assert.strictEqual(tags[0].features[0].tag, 'buildinpublic', 'the # must not be part of the tag value');
});

t('the byte range covers the # and the tag, exactly', function () {
  const text = 'Shipping an agent that roasts resumes. #buildinpublic';
  assert.strictEqual(sliceOf(text, tagsIn(text)[0]), '#buildinpublic');
});

t('byte offsets survive multi-byte characters earlier in the post', function () {
  // "🚀" is 4 UTF-8 bytes but 2 JS string units. Using string indices here
  // shifts every facet left by two bytes and renders it over the wrong text.
  const text = '🚀 #AIagents';
  const tags = tagsIn(text);
  assert.strictEqual(tags.length, 1);
  assert.strictEqual(sliceOf(text, tags[0]), '#AIagents');
  assert.strictEqual(tags[0].index.byteStart, 5, 'emoji(4) + space(1) = byte 5');
});

t('several hashtags each get their own facet', function () {
  const text = 'New drop. #AI #resumes #jobsearch';
  const tags = tagsIn(text);
  assert.strictEqual(tags.length, 3);
  assert.deepStrictEqual(tags.map(f => f.features[0].tag), ['AI', 'resumes', 'jobsearch']);
  tags.forEach(f => assert.strictEqual(sliceOf(text, f)[0], '#'));
});

t('a URL fragment is NOT a hashtag', function () {
  // The single most likely way this change breaks a live post: every post we
  // publish carries a URL, and "#section" inside one must stay part of the link.
  const text = 'Read it here https://www.ambientpixels.ai/resume-roast/#how-it-works';
  assert.strictEqual(tagsIn(text).length, 0, 'a # inside a URL must not become a tag');
});

t('a # in the middle of a word is not a hashtag', function () {
  assert.strictEqual(tagsIn('I still write C# sometimes').length, 0);
});

t('a purely numeric tag is rejected', function () {
  // "ranked #1" is prose, not a tag. Bluesky rejects these upstream too.
  assert.strictEqual(tagsIn('We are ranked #1 today').length, 0);
  assert.strictEqual(tagsIn('#2026').length, 0);
});

t('a tag containing digits and letters is kept', function () {
  const tags = tagsIn('shipping #1stdraft today');
  assert.strictEqual(tags.length, 1);
  assert.strictEqual(tags[0].features[0].tag, '1stdraft');
});

t('trailing punctuation is not part of the tag', function () {
  const text = 'That is the whole point of #buildinpublic.';
  const tags = tagsIn(text);
  assert.strictEqual(tags.length, 1);
  assert.strictEqual(tags[0].features[0].tag, 'buildinpublic', 'the trailing period must be trimmed');
  assert.strictEqual(sliceOf(text, tags[0]), '#buildinpublic', 'and the byte range must shrink with it');
});

t('a bare # is not a tag', function () {
  assert.strictEqual(tagsIn('a # b').length, 0);
  assert.strictEqual(tagsIn('#').length, 0);
  assert.strictEqual(tagsIn('# ').length, 0);
});

t('an over-long tag is dropped rather than sent and rejected', function () {
  // The lexicon caps a tag at 64 graphemes / 640 bytes. Sending a longer one
  // fails the whole createRecord, so the post would not publish at all.
  assert.strictEqual(tagsIn('#' + 'a'.repeat(65)).length, 0);
  assert.strictEqual(tagsIn('#' + 'a'.repeat(64)).length, 1);
});

t('links and mentions still work — this must not regress publishing', function () {
  const text = 'ping @nova.bsky.social about https://www.ambientpixels.ai/resume-roast/ #AI';
  const facets = detectFacets(text);
  assert.strictEqual(facets.filter(f => typeOf(f) === LINK).length, 1, 'lost the link facet');
  assert.strictEqual(facets.filter(f => typeOf(f) === MENTION).length, 1, 'lost the mention facet');
  assert.strictEqual(facets.filter(f => typeOf(f) === TAG).length, 1, 'lost the tag facet');
  const link = facets.find(f => typeOf(f) === LINK);
  assert.strictEqual(sliceOf(text, link), 'https://www.ambientpixels.ai/resume-roast/');
});

t('no two facets overlap', function () {
  // Overlapping ranges are invalid in AT Protocol and rejected on write.
  const text = 'see https://www.ambientpixels.ai/r/#x and #AI and @nova.bsky.social';
  const fs = detectFacets(text).slice().sort((a, b) => a.index.byteStart - b.index.byteStart);
  for (let i = 1; i < fs.length; i++) {
    assert.ok(fs[i].index.byteStart >= fs[i - 1].index.byteEnd,
      'facet ' + i + ' overlaps the previous one');
  }
});

t('a post with no hashtags produces no tag facets', function () {
  assert.strictEqual(tagsIn('Just a normal post with no tags in it.').length, 0);
});

console.log('\nbluesky facet tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
