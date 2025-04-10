// scanSiteStructure.js – Nova auto-scans site structure daily
// Reads folders + HTML files, builds site-structure.json

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'data', 'site-structure.json');
const excludeDirs = ['.git', 'node_modules', 'scripts', 'data', 'docs', 'assets'];

function scanDirectory(dirPath, base = '') {
  let structure = [];
  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    const relPath = path.join(base, item.name);

    if (item.isDirectory()) {
      if (!excludeDirs.includes(item.name)) {
        const children = scanDirectory(fullPath, relPath);
        structure.push({ type: 'folder', name: item.name, path: relPath, children });
      }
    } else if (item.isFile() && item.name.endsWith('.html')) {
      structure.push({ type: 'page', name: item.name, path: relPath });
    }
  }
  return structure;
}

function buildStructure() {
  const structure = {
    version: 'v2.3',
    updated: new Date().toISOString(),
    root: scanDirectory(projectRoot)
  };

  fs.writeFileSync(outputPath, JSON.stringify(structure, null, 2));
  console.log(`✅ Nova's site structure updated at /data/site-structure.json`);
}

buildStructure();


