#!/usr/bin/env node
/**
 * buildSiteManifest.js — v1.0
 * Generates data/site-manifest.json (full) and data/site-manifest.digest.json (compact)
 * for AI agent site-context injection into the heartbeat prompt.
 *
 * Deterministic. No LLM calls. Runs at build/deploy time.
 *
 * Usage:
 *   node scripts/buildSiteManifest.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_MANIFEST = path.join(ROOT, 'data', 'site-manifest.json');
const OUT_DIGEST = path.join(ROOT, 'data', 'site-manifest.digest.json');

// ── Scan config ──
const SCAN_DIRS = ['', 'modules', 'projects', 'cardforge', 'nova', 'tools', 'lab', 'pages', 'about', 'account', 'help', 'services', 'skills', 'support', 'hanson', 'playground'];
const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', 'downloads', '.github', '.vscode', '.windsurf', 'api'];

// Category assignment
function getCategory(webPath) {
  if (webPath.startsWith('/modules/company/')) return 'company';
  if (webPath.startsWith('/modules/')) return 'modules';
  if (webPath.startsWith('/cardforge/')) return 'cardforge';
  if (webPath.startsWith('/projects/')) return 'projects';
  if (webPath.startsWith('/nova/')) return 'nova';
  if (webPath.startsWith('/tools/')) return 'tools';
  if (webPath.startsWith('/hanson/')) return 'hanson';
  if (webPath.startsWith('/lab/')) return 'lab';
  return 'root';
}

// ── HTML parsing (regex, lightweight) ──
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function extractMeta(html, name) {
  // <meta name="description" content="...">
  const re = new RegExp('<meta\\s+name=["\']' + name + '["\']\\s+content=["\']([^"\']*)["\']', 'i');
  const m = html.match(re);
  if (m) return m[1].trim();
  // Also try content-first order
  const re2 = new RegExp('<meta\\s+content=["\']([^"\']*)["\']\\s+name=["\']' + name + '["\']', 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1].trim() : '';
}

function extractOgMeta(html, property) {
  // <meta property="og:title" content="...">
  const re = new RegExp('<meta\\s+property=["\']' + property + '["\']\\s+content=["\']([^"\']*)["\']', 'i');
  const m = html.match(re);
  if (m) return m[1].trim();
  const re2 = new RegExp('<meta\\s+content=["\']([^"\']*)["\']\\s+property=["\']' + property + '["\']', 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1].trim() : '';
}

// ── Recursive HTML file scanner ──
function scanDir(dir, depth) {
  depth = depth || 0;
  if (depth > 5) return [];
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return results; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.includes(entry.name)) continue;
      results.push(...scanDir(fullPath, depth + 1));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Git head (safe) ──
function getGitHead() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch (e) {
    return null;
  }
}

// ── Deploy hint ──
function getDeployHint() {
  const triggerPath = path.join(ROOT, 'deploy-trigger.txt');
  try {
    let buf = fs.readFileSync(triggerPath);
    // Handle UTF-16 LE BOM
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
      buf = buf.slice(2);
      var content = '';
      for (var i = 0; i < buf.length - 1; i += 2) {
        var code = buf[i] | (buf[i + 1] << 8);
        if (code === 0) continue;
        content += String.fromCharCode(code);
      }
      return content.trim() || null;
    }
    const text = buf.toString('utf-8').replace(/\0/g, '').trim();
    return text || null;
  } catch (e) {
    return null;
  }
}

// ── Main ──
function build() {
  console.log('[buildSiteManifest] Scanning from:', ROOT);

  // Collect all HTML files
  const allFiles = [];
  for (const scanDir_ of SCAN_DIRS) {
    const absDir = scanDir_ ? path.join(ROOT, scanDir_) : ROOT;
    if (!fs.existsSync(absDir)) continue;
    // For root dir, only scan non-recursively for HTML files (subdirs handled by SCAN_DIRS)
    if (!scanDir_) {
      try {
        const rootEntries = fs.readdirSync(absDir, { withFileTypes: true });
        for (const e of rootEntries) {
          if (e.isFile() && e.name.endsWith('.html')) {
            allFiles.push(path.join(absDir, e.name));
          }
        }
      } catch (e) { /* skip */ }
    } else {
      allFiles.push(...scanDir(absDir, 0));
    }
  }

  console.log('[buildSiteManifest] Found', allFiles.length, 'HTML files');

  // Process each file
  const pages = [];
  for (const filePath of allFiles) {
    const relPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
    const webPath = '/' + relPath;
    let html, stat;
    try {
      html = fs.readFileSync(filePath, 'utf-8');
      stat = fs.statSync(filePath);
    } catch (e) { continue; }

    const title = extractTitle(html);
    const description = extractMeta(html, 'description');
    const ogTitle = extractOgMeta(html, 'og:title');
    const ogDescription = extractOgMeta(html, 'og:description');
    const ogImage = extractOgMeta(html, 'og:image');

    pages.push({
      path: webPath,
      filePath: relPath,
      title: title || '',
      description: description || '',
      lastModified: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      category: getCategory(webPath),
      flags: {
        missingTitle: !title,
        missingDescription: !description,
        missingOgTitle: !ogTitle,
        missingOgDescription: !ogDescription,
        missingOgImage: !ogImage
      }
    });
  }

  // Sort by lastModified desc
  pages.sort((a, b) => b.lastModified.localeCompare(a.lastModified));

  // Category counts
  const categories = {};
  for (const p of pages) {
    categories[p.category] = (categories[p.category] || 0) + 1;
  }

  const generatedAt = new Date().toISOString();
  const gitHead = getGitHead();
  const deployHint = getDeployHint() || generatedAt;

  // ── Full manifest ──
  const manifest = {
    generatedAt,
    gitHead,
    lastDeployHint: deployHint,
    counts: {
      pages: pages.length,
      categories
    },
    pages
  };

  fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log('[buildSiteManifest] Wrote', OUT_MANIFEST, '(' + pages.length + ' pages)');

  // ── Digest ──
  // Attention flags: prioritize by severity, then recency
  const SEVERITY_ORDER = ['missingTitle', 'missingDescription', 'missingOgTitle', 'missingOgDescription', 'missingOgImage'];
  const attentionItems = [];
  for (const severity of SEVERITY_ORDER) {
    for (const p of pages) {
      if (p.flags[severity]) {
        // Avoid duplicates per page — only first (highest severity) issue
        if (!attentionItems.some(a => a.path === p.path)) {
          attentionItems.push({ path: p.path, issue: severity });
        }
      }
    }
  }

  const digest = {
    generatedAt,
    gitHead,
    lastDeployHint: deployHint,
    counts: {
      pages: pages.length,
      categories
    },
    attention: attentionItems.slice(0, 5),
    recentPages: pages.slice(0, 5).map(p => ({ path: p.path, title: p.title }))
  };

  fs.writeFileSync(OUT_DIGEST, JSON.stringify(digest, null, 2), 'utf-8');
  console.log('[buildSiteManifest] Wrote', OUT_DIGEST);
  console.log('[buildSiteManifest] Done.');
}

build();
