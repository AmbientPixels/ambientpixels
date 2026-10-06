// Run with: node scripts/prerenderBlog.test.js
const assert = require('assert');
const { addSlugRoutes, slimConfig, isSafeSlug, heroFor } = require('./prerenderBlog');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok    ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}

const BASE = {
  routes: [
    { route: '/blog/*.css' },
    { route: '/blog', rewrite: '/blog/index.html' },
    { route: '/blog/*', rewrite: '/blog/index.html' },
    { route: '/log/*', rewrite: '/log/index.html' },
    { route: '/x/*', allowedRoles: ['anonymous'] },
    { route: '/modules/company/*', allowedRoles: ['authenticated'] }
  ]
};

t('article rules land immediately before the /blog/* SPA rewrite, newest first', function () {
  const r = addSlugRoutes(BASE, ['new-post', 'old-post'], 100000);
  const routes = r.config.routes.map(function (x) { return x.route; });
  assert.deepStrictEqual(routes.slice(0, 5), ['/blog/*.css', '/blog', '/blog/new-post', '/blog/old-post', '/blog/*']);
  assert.strictEqual(r.config.routes[2].rewrite, '/blog/new-post/index.html');
  assert.strictEqual(r.dropped, 0);
});

t('over the size cap, the OLDEST posts are dropped and stay on the SPA', function () {
  const baseBytes = Buffer.byteLength(JSON.stringify(BASE));
  const r = addSlugRoutes(BASE, ['newest', 'middle', 'oldest'], baseBytes + 130);
  assert.deepStrictEqual(r.included, ['newest', 'middle']);
  assert.strictEqual(r.dropped, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(r.config)) <= baseBytes + 130);
});

t('unsafe slugs never become routes or paths', function () {
  assert.strictEqual(isSafeSlug('../../etc/passwd'), false);
  assert.strictEqual(isSafeSlug('a/b'), false);
  assert.strictEqual(isSafeSlug(''), false);
  assert.strictEqual(isSafeSlug('5-common-resume-mistakes'), true);
  const r = addSlugRoutes(BASE, ['ok-slug', '../evil'], 100000);
  assert.deepStrictEqual(r.included, ['ok-slug']);
});

t('refuses to guess when the SPA rule is missing', function () {
  assert.throws(function () { addSlugRoutes({ routes: [{ route: '/x' }] }, ['a'], 100000); }, /refusing to guess/);
});

t('slimConfig drops only anonymous-only roles and leaves the input untouched', function () {
  const s = slimConfig(BASE);
  assert.strictEqual(s.routes[4].allowedRoles, undefined);
  assert.deepStrictEqual(s.routes[5].allowedRoles, ['authenticated']);
  assert.deepStrictEqual(BASE.routes[4].allowedRoles, ['anonymous']);
});

t('heroFor prefers the resolved hero, falls back to cover_image, else null', function () {
  assert.deepStrictEqual(heroFor({ title: 'T', hero_image: { url: 'h.png', alt: 'A' }, cover_image: 'c.png' }), { url: 'h.png', alt: 'A' });
  assert.deepStrictEqual(heroFor({ title: 'T', cover_image: 'c.png' }), { url: 'c.png', alt: 'T' });
  assert.strictEqual(heroFor({ title: 'T' }), null);
});

console.log('\nprerenderBlog tests: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
