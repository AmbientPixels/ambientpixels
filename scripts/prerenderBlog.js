#!/usr/bin/env node
// prerenderBlog.js — build-time static article pages for /blog/<slug>.
//
// Why: /blog/* is a client-rendered shell, so crawlers and link unfurlers got
// "Journal — AmbientPixels" and "Loading…" for every post (verified as
// Googlebot, 2026-10-06). Server rendering on the same URL needs the Function
// App linked as the SWA backend, and that link took the whole API down on
// 2026-08-08 (it silently enables EasyAuth on the Function App). So pages are
// rendered here, at deploy time, with the same renderer api/blogpage uses, and
// served as plain static files.
//
// What it writes into the build dir (never into the repo):
//   <out>/blog/<slug>/index.html               one page per published post
//   <out>/staticwebapp.config.json             per-slug rewrite rules inserted
//                                              ahead of the /blog/* SPA rewrite,
//                                              newest posts first, within the
//                                              20KB config cap (older posts stay
//                                              on the SPA shell)
// A post published after the last deploy has no rule yet and falls through to
// the existing SPA shell, exactly as before — new posts never 404.
//
// Fail-open by design: if the API is unreachable the build continues with the
// SPA blog untouched. A blog that renders client-side is the status quo; a
// failed deploy is not.
//
// Usage: node scripts/prerenderBlog.js <buildDir>

const fs = require('fs');
const path = require('path');
const { renderArticlePage } = require('../api/blogpage/render');

const API = 'https://ambientpixels-nova-api.azurewebsites.net/api/blogPosts';
const SPA_RULE = '/blog/*';
// Azure caps staticwebapp.config.json at 20KB. Leave headroom; when rules for
// every post would not fit, the newest posts keep theirs.
const CONFIG_MAX_BYTES = 19000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,200}$/i;

function isSafeSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

// Pure: insert one exact-path rewrite per slug directly before the /blog/* SPA rewrite. Slugs are newest-first; the
// oldest are dropped if the config would exceed maxBytes. Returns
// { config, included, dropped }.
function addSlugRoutes(config, slugs, maxBytes) {
  const limit = Number.isFinite(maxBytes) ? maxBytes : CONFIG_MAX_BYTES;
  const routes = Array.isArray(config.routes) ? config.routes : [];
  const spaIdx = routes.findIndex(function (r) { return r && r.route === SPA_RULE; });
  if (spaIdx === -1) throw new Error('no "' + SPA_RULE + '" route found — refusing to guess where rules go');

  // Exact path only: every link the fleet emits is /blog/<slug> with no
  // trailing slash, and a second rule per post would halve capacity.
  const ruleFor = function (slug) {
    return [{ route: '/blog/' + slug, rewrite: '/blog/' + slug + '/index.html' }];
  };
  let keep = slugs.filter(isSafeSlug);
  const build = function (list) {
    const extra = [];
    list.forEach(function (s) { extra.push.apply(extra, ruleFor(s)); });
    return Object.assign({}, config, { routes: routes.slice(0, spaIdx).concat(extra, routes.slice(spaIdx)) });
  };
  let next = build(keep);
  while (keep.length && Buffer.byteLength(JSON.stringify(next)) > limit) {
    keep = keep.slice(0, -1);
    next = build(keep);
  }
  return { config: next, included: keep, dropped: slugs.filter(isSafeSlug).length - keep.length };
}

// Pure: drop `allowedRoles: ["anonymous"]` from routes. Anonymous already means
// everyone and is the default for a route with no roles, so the deployed copy
// behaves identically — it just frees ~2.9KB of the 20KB config budget for
// article rules. The repo copy is never modified.
function slimConfig(config) {
  const out = JSON.parse(JSON.stringify(config));
  (out.routes || []).forEach(function (r) {
    if (r && Array.isArray(r.allowedRoles) && r.allowedRoles.length === 1 && r.allowedRoles[0] === 'anonymous') delete r.allowedRoles;
  });
  return out;
}

function heroFor(post) {
  if (post && post.hero_image && post.hero_image.url) return { url: post.hero_image.url, alt: post.hero_image.alt || post.title };
  if (post && post.cover_image) return { url: post.cover_image, alt: post.title };
  return null;
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.json();
}

async function main(outDir) {
  if (!outDir) throw new Error('usage: node scripts/prerenderBlog.js <buildDir>');
  let list;
  try {
    list = await getJson(API);
  } catch (e) {
    console.log('::warning::prerenderBlog: post list unavailable (' + e.message + ') — blog stays client-rendered this deploy');
    return;
  }
  if (!Array.isArray(list)) { console.log('::warning::prerenderBlog: unexpected list shape — skipping'); return; }

  const sorted = list.slice().sort(function (a, b) { return String(b.published_at || '').localeCompare(String(a.published_at || '')); });
  const written = [];
  for (const meta of sorted) {
    if (!isSafeSlug(meta && meta.slug)) { console.log('skip unsafe slug: ' + JSON.stringify(meta && meta.slug)); continue; }
    try {
      const post = await getJson(API + '?slug=' + encodeURIComponent(meta.slug));
      if (!post || !post.content_md) { console.log('skip ' + meta.slug + ' — no content'); continue; }
      const dir = path.join(outDir, 'blog', meta.slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), renderArticlePage(post, heroFor(post)));
      written.push(meta.slug);
    } catch (e) {
      console.log('skip ' + meta.slug + ' — ' + e.message);
    }
  }

  const cfgPath = path.join(outDir, 'staticwebapp.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const r = addSlugRoutes(slimConfig(cfg), written);
  fs.writeFileSync(cfgPath, JSON.stringify(r.config));
  console.log('prerenderBlog: ' + written.length + ' pages written, ' + r.included.length + ' routed' +
    (r.dropped ? ', ' + r.dropped + ' oldest left on the SPA (config size cap)' : '') +
    ', config ' + Buffer.byteLength(JSON.stringify(r.config)) + ' bytes');
}

if (require.main === module) {
  main(process.argv[2]).catch(function (e) {
    // Fail-open: never break the deploy over the blog.
    console.log('::warning::prerenderBlog failed: ' + e.message);
  });
}

module.exports = { addSlugRoutes, slimConfig, isSafeSlug, heroFor };
