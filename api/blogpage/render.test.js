// Run with: node api/blogpage/render.test.js
// This page is what crawlers see for every article — the meta block decides
// whether a share card carries the article's title and hero image or the
// generic journal card, and the body is what search engines index.
const assert = require('assert');
const { renderArticlePage, renderMarkdownBasic } = require('./render');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message.split('\n')[0]); }
}

const POST = {
  slug: 'how-to-build-and-monetize-your-first-ai-agent',
  title: 'How to Build and Monetize Your First AI Agent',
  excerpt: 'A practical walkthrough from zero to a paying agent.',
  content_md: '# The short version\n\nBuild small. **Charge early.**\n\n- Pick one job\n- Ship it\n\n[Try Agent Forge](https://www.ambientpixels.ai/agent-forge/)',
  published_at: '2026-08-08T12:00:00.000Z'
};
const HERO = { url: 'https://www.ambientpixels.ai/images/blog/agent-hero.png', alt: 'Agent hero' };

t('the meta block carries the article, not the journal shell', function () {
  const html = renderArticlePage(POST, HERO);
  assert.ok(html.includes('<meta property="og:title" content="How to Build and Monetize Your First AI Agent'), 'og:title must be the article title');
  assert.ok(html.includes('<meta property="og:type" content="article"'), 'og:type must be article');
  assert.ok(html.includes('https://www.ambientpixels.ai/blog/' + POST.slug), 'og:url/canonical must be the article URL');
  assert.ok(html.includes('<meta property="article:published_time" content="2026-08-08T12:00:00.000Z"'), 'published_time missing');
});

t('the hero image is the card image when it exists', function () {
  const html = renderArticlePage(POST, HERO);
  assert.ok(html.includes('<meta property="og:image" content="' + HERO.url + '"'), 'og:image must be the hero');
  assert.ok(html.includes('<meta name="twitter:image" content="' + HERO.url + '"'), 'twitter:image must be the hero');
  assert.ok(html.includes('summary_large_image'));
});

t('no hero falls back to the brand card image on /images/ (the routable path)', function () {
  const html = renderArticlePage(POST, null);
  assert.ok(html.includes('https://www.ambientpixels.ai/images/og/og-blog.png'), 'fallback must be the /images/ copy — /blog/og-blog.png is swallowed by the SPA rewrite');
});

t('a relative hero URL is made absolute', function () {
  const html = renderArticlePage(POST, { url: '/images/blog/x.png', alt: '' });
  assert.ok(html.includes('content="https://www.ambientpixels.ai/images/blog/x.png"'), 'relative hero must be absolutized');
});

t('title and excerpt are HTML-escaped in meta and body', function () {
  const html = renderArticlePage(Object.assign({}, POST, {
    title: 'Agents & "brokers" <script>alert(1)</script>',
    excerpt: 'x < y & "z"'
  }), null);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script from title must never survive');
  assert.ok(html.includes('Agents &amp; &quot;brokers&quot;'), 'escaped title must appear');
});

t('the page keeps the shell containers so blog.js can hydrate over it', function () {
  const html = renderArticlePage(POST, HERO);
  for (const id of ['blog-header', 'blog-content', 'blog-loading', 'blog-error']) {
    assert.ok(html.includes('id="' + id + '"'), 'missing container #' + id);
  }
  assert.ok(html.includes('/blog/blog.js'), 'blog.js include missing — humans would get a dead page');
  assert.ok(html.includes('/blog/blog.css'), 'blog.css include missing');
});

t('markdown subset renders headings, bold, lists, and safe links', function () {
  const html = renderMarkdownBasic(POST.content_md);
  assert.ok(/<h2>The short version<\/h2>/.test(html), 'heading');
  assert.ok(/<strong>Charge early\.<\/strong>/.test(html), 'bold');
  assert.ok(/<ul>[\s\S]*<li>Pick one job<\/li>/.test(html), 'list');
  assert.ok(html.includes('<a href="https://www.ambientpixels.ai/agent-forge/"'), 'link');
});

t('markdown never emits raw HTML or javascript: links', function () {
  const html = renderMarkdownBasic('Hello <img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))');
  assert.ok(!html.includes('<img src=x'), 'raw HTML must be escaped');
  assert.ok(!html.includes('href="javascript:'), 'javascript: href must not render as a link');
});

t('fenced code blocks are preserved as code, not transformed', function () {
  const html = renderMarkdownBasic('Before\n\n```\nconst x = "**not bold**";\n```\n\nAfter');
  assert.ok(html.includes('<pre><code>'), 'code fence missing');
  assert.ok(html.includes('**not bold**') || html.includes('<code>const'), 'fence content must stay literal');
  assert.ok(!/<pre><code>[\s\S]*<strong>/.test(html), 'no bold transform inside code');
});

t('nothing in the page reads "undefined"', function () {
  const html = renderArticlePage({ slug: 's', title: 'T', content_md: '' }, null);
  assert.ok(!/undefined/.test(html), 'undefined leaked into the page');
});

console.log('\nblogpage render tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
