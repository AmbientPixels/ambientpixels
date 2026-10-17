const test = require('node:test');
const assert = require('node:assert');
const { classify, revisionText } = require('./revision-feedback');

test('image-only feedback goes to Design alone — the article is not rewritten', () => {
  for (const note of [
    'We need a hero imge to go with this blog article.',
    'Wrong picture, make it less corporate.',
    'The hero image is too dark',
    'Add an illustration please'
  ]) assert.strictEqual(classify(note).imageOnly, true, note);
});

test('feedback that asks for text changes still goes to the writer', () => {
  for (const note of [
    'Tighten the intro and cut the jargon.',
    'New hero image, and fix the typo in paragraph two.',
    'Swap the image and rewrite the ending.',
    'The headline needs work'
  ]) {
    const c = classify(note);
    assert.strictEqual(c.imageOnly, false, note);
    assert.strictEqual(c.text, true, note);
  }
});

test('the CEO\'s explicit pick wins over the wording', () => {
  assert.deepStrictEqual(classify('Tighten the intro', 'image'), { image: true, text: false, imageOnly: true });
  assert.deepStrictEqual(classify('We need a hero image', 'text'), { image: false, text: true, imageOnly: false });
  assert.deepStrictEqual(classify('Make it pop', 'both'), { image: true, text: true, imageOnly: false });
  assert.strictEqual(classify('We need a hero image', 'nonsense').imageOnly, true, 'an unknown scope falls back to wording');
});

test('empty feedback is a text revision, never image-only', () => {
  assert.deepStrictEqual(classify(''), { image: false, text: true, imageOnly: false });
  assert.strictEqual(classify(null).imageOnly, false);
});

const body = 'when you are building a project on your own, making video feels like a trap. '.repeat(3);
const task = (text) => ({ assignee: 'scribe', comments: [{ type: 'deliverable', author: 'scribe', text }] });

test('an invented site-relative image is stripped; a real hosted one is kept', () => {
  const r = revisionText(task('# Title\n\n![hero](/images/blog/x-hero.png)\n\n' + body + '\n\n![ok](https://cdn.example.com/a.png)'));
  assert.ok(r.text, JSON.stringify(r));
  assert.ok(r.text.indexOf('/images/blog/x-hero.png') === -1);
  assert.ok(r.text.indexOf('https://cdn.example.com/a.png') !== -1);
});

test('no deliverable, placeholders and too-short text are blocked with a reason', () => {
  assert.strictEqual(revisionText({ assignee: 'scribe', comments: [] }).blocked, 'no-deliverable');
  assert.strictEqual(revisionText(task(body + ' [insert link here]')).blocked, 'placeholders');
  assert.strictEqual(revisionText(task('Short text that is just over fifty characters long, ok.')).blocked, 'too-short');
});
