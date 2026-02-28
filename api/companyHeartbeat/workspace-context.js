// workspace-context.js — extracted from companyHeartbeat/index.js (Phase 2 refactor)
// Scans filesystem for context files by agent role, injects into execution prompts

const fs = require('fs');
const path = require('path');
const {
  WORKSPACE_ROOT, MAX_WORKSPACE_INJECT_CHARS,
  WORKSPACE_SCAN_EXTENSIONS, WORKSPACE_SKIP_DIRS
} = require('./constants');

function _resolveWorkspaceFiles(agent, task) {
  const results = [];
  const titleLower = (task.title || '').toLowerCase();
  const descLower = (task.description || '').toLowerCase();
  const combined = titleLower + ' ' + descLower;

  // Role-based scan directories
  const roleDirs = {
    'Design & QC': ['.', 'css', 'modules'],
    'DevOps': ['api', 'scripts', '.github'],
    'Marketing': ['blog', 'modules/company'],
    'Head of Content': ['blog', 'docs'],
    'Content — Editor & Brand Voice': ['blog', 'docs'],
    'Head of Research & Intelligence': ['data', 'docs']
  };
  const scanDirs = (roleDirs[agent.role] || ['.']).slice(0);

  // Detect file paths explicitly mentioned in task description
  const pathMatches = combined.match(/[\/\w-]+\.(?:html|css|js|md|json)/gi) || [];
  for (const p of pathMatches) {
    try {
      const full = path.resolve(WORKSPACE_ROOT, p.replace(/^[\/]+/, ''));
      if (full.startsWith(WORKSPACE_ROOT) && fs.existsSync(full)) {
        const stat = fs.statSync(full);
        if (stat.isFile() && stat.size < 50000) {
          results.push({ path: p, content: fs.readFileSync(full, 'utf8') });
        }
      }
    } catch (_e) { /* skip */ }
  }

  // Keyword-based file detection
  const keywords = {
    'website': ['index.html'],
    'homepage': ['index.html'],
    'landing': ['index.html'],
    'mockup': ['index.html', 'css/base.css', 'css/theme.css'],
    'design': ['index.html', 'css/base.css', 'css/theme.css', 'css/components.css'],
    'dashboard': ['modules/company/dashboard.html'],
    'config': ['modules/company/config-overview.html'],
    'blog': ['blog/index.html'],
    'support': ['support/index.html'],
    'nav': ['css/nav.css'],
    'accessibility': ['index.html', 'css/base.css'],
    'deploy': ['staticwebapp.config.json', 'package.json'],
    'infrastructure': ['staticwebapp.config.json', 'package.json']
  };
  for (const [kw, files] of Object.entries(keywords)) {
    if (combined.indexOf(kw) !== -1) {
      for (const f of files) {
        if (results.some(r => r.path === f)) continue;
        try {
          const full = path.resolve(WORKSPACE_ROOT, f);
          if (full.startsWith(WORKSPACE_ROOT) && fs.existsSync(full)) {
            const stat = fs.statSync(full);
            if (stat.isFile() && stat.size < 50000) {
              results.push({ path: f, content: fs.readFileSync(full, 'utf8') });
            }
          }
        } catch (_e) { /* skip */ }
      }
    }
  }

  // If no matches found, fall back to role-dir scan for top-level HTML/CSS
  if (results.length === 0) {
    for (const dir of scanDirs) {
      try {
        const absDir = path.resolve(WORKSPACE_ROOT, dir);
        if (!absDir.startsWith(WORKSPACE_ROOT)) continue;
        const entries = fs.readdirSync(absDir).slice(0, 20);
        for (const entry of entries) {
          if (WORKSPACE_SKIP_DIRS.has(entry)) continue;
          const ext = path.extname(entry).toLowerCase();
          if (!WORKSPACE_SCAN_EXTENSIONS.has(ext)) continue;
          const full = path.join(absDir, entry);
          try {
            const stat = fs.statSync(full);
            if (stat.isFile() && stat.size < 50000) {
              results.push({ path: path.relative(WORKSPACE_ROOT, full).replace(/\\/g, '/'), content: fs.readFileSync(full, 'utf8') });
            }
          } catch (_e2) { /* skip */ }
          if (results.length >= 5) break;
        }
      } catch (_e3) { /* skip */ }
      if (results.length >= 5) break;
    }
  }

  // Trim to fit char budget
  let totalChars = 0;
  const trimmed = [];
  for (const r of results) {
    const maxPerFile = Math.min(2000, MAX_WORKSPACE_INJECT_CHARS - totalChars);
    if (maxPerFile <= 200) break;
    const content = r.content.length > maxPerFile
      ? r.content.substring(0, maxPerFile) + '\n... (trimmed, ' + r.content.length + ' chars total)'
      : r.content;
    totalChars += content.length;
    trimmed.push({ path: r.path, content: content });
    if (totalChars >= MAX_WORKSPACE_INJECT_CHARS) break;
  }
  return trimmed;
}

module.exports = { _resolveWorkspaceFiles };
