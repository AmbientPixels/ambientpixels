// generateCodeMap.js
// Nova Sensor: Code Awareness Sensor v1.0

const fs = require('fs');
const path = require('path');
const glob = require('glob');

const OUTPUT_FILE = path.join(__dirname, '../data/code-map.json');
const TARGET_DIRS = ['../js', '../css', '../']; // js, css, root-level HTML

function extractFunctions(jsContent) {
  const functionRegex = /function\s+(\w+)\s*\(/g;
  const arrowRegex = /const\s+(\w+)\s*=\s*\(.*?\)\s*=>/g;
  const matches = [];
  let match;
  while ((match = functionRegex.exec(jsContent))) matches.push(match[1]);
  while ((match = arrowRegex.exec(jsContent))) matches.push(match[1]);
  return matches;
}

function extractCSSClasses(cssContent) {
  const classRegex = /\.(\w[\w-]*)/g;
  const matches = new Set();
  let match;
  while ((match = classRegex.exec(cssContent))) matches.add(match[1]);
  return Array.from(matches);
}

function extractHTMLTags(htmlContent) {
  const tagRegex = /<\s*(\w+)[\s>]/g;
  const matches = new Set();
  let match;
  while ((match = tagRegex.exec(htmlContent))) matches.add(match[1].toLowerCase());
  return Array.from(matches);
}

function scanDirectory() {
  const summary = {
    totalJS: 0,
    totalCSS: 0,
    totalHTML: 0,
  };
  const functions = new Set();
  const cssClasses = new Set();
  const htmlTags = new Set();

  TARGET_DIRS.forEach(dir => {
    const pattern = path.join(__dirname, dir, '**/*.*');
    const files = glob.sync(pattern, { nodir: true });
    files.forEach(file => {
      const ext = path.extname(file);
      const content = fs.readFileSync(file, 'utf8');
      if (ext === '.js') {
        summary.totalJS++;
        extractFunctions(content).forEach(fn => functions.add(fn));
      } else if (ext === '.css') {
        summary.totalCSS++;
        extractCSSClasses(content).forEach(cls => cssClasses.add(cls));
      } else if (ext === '.html') {
        summary.totalHTML++;
        extractHTMLTags(content).forEach(tag => htmlTags.add(tag));
      }
    });
  });

  return {
    timestamp: new Date().toISOString(),
    summary,
    functions: Array.from(functions).sort(),
    cssClasses: Array.from(cssClasses).sort(),
    htmlTags: Array.from(htmlTags).sort(),
  };
}

function writeCodeMap() {
  const map = scanDirectory();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(map, null, 2));
  console.log('✅ Nova Code Awareness Sensor updated:', OUTPUT_FILE);
}

writeCodeMap();


