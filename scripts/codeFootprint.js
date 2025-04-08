// codeFootprint.js – Track total codebase lines and file counts for Nova

const fs = require('fs');
const path = require('path');

const fileTypes = ['.html', '.css', '.js'];
const baseDir = path.resolve(__dirname, '..');
const excludeDirs = ['.git', 'node_modules', 'data', 'docs', 'images', 'scripts', '.github'];
const outputFile = path.join(baseDir, 'data', 'code-footprint.json');

let totalLines = 0;
let totalFiles = 0;
const summary = {};

function scanDir(dir) {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      if (!excludeDirs.includes(file.name)) scanDir(fullPath);
    } else {
      const ext = path.extname(file.name);
      if (fileTypes.includes(ext)) {
        totalFiles++;
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n').length;
        totalLines += lines;
        if (!summary[ext]) summary[ext] = { files: 0, lines: 0 };
        summary[ext].files++;
        summary[ext].lines += lines;
      }
    }
  }
}

scanDir(baseDir);

const result = {
  scannedAt: new Date().toISOString(),
  totalFiles,
  totalLines,
  summary
};

fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
console.log(`✅ Nova's code footprint updated at /data/code-footprint.json`);
