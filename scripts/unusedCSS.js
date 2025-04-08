// unusedCSS.js – Find potentially unused CSS classes in HTML files

const fs = require('fs');
const path = require('path');

const htmlDir = path.resolve(__dirname, '..');
const cssPath = path.join(__dirname, '../css/base.css'); // or change to css/components.css
const outputFile = path.join(htmlDir, 'data', 'unused-css-report.json');

const excludeDirs = ['node_modules', 'data', 'docs', 'scripts', '.git', 'images', 'assets/js'];

function extractClassNamesFromCSS(cssText) {
  const regex = /\.([a-zA-Z0-9_-]+)\s*[{,]/g;
  const classNames = new Set();
  let match;
  while ((match = regex.exec(cssText)) !== null) {
    classNames.add(match[1]);
  }
  return Array.from(classNames);
}

function extractClassUsageFromHTML(dir) {
  let used = new Set();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!excludeDirs.includes(entry.name)) {
        const nested = extractClassUsageFromHTML(fullPath);
        nested.forEach(cls => used.add(cls));
      }
    } else if (entry.name.endsWith('.html')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const matches = content.match(/class="([^"]+)"/g) || [];
      matches.forEach(match => {
        match.replace(/class="([^"]+)"/, '$1')
             .split(/\s+/)
             .forEach(cls => used.add(cls));
      });
    }
  }
  return used;
}

const cssContent = fs.readFileSync(cssFile, 'utf8');
const definedClasses = extractClassNamesFromCSS(cssContent);
const usedClasses = extractClassUsageFromHTML(htmlDir);

const unused = definedClasses.filter(cls => !usedClasses.has(cls));

const result = {
  scannedAt: new Date().toISOString(),
  cssFile: path.relative(htmlDir, cssFile),
  totalDefined: definedClasses.length,
  totalUsed: usedClasses.size,
  unusedClasses: unused
};

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
console.log(`✅ Nova's unused CSS report written to /data/unused-css-report.json`);
