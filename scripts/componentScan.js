// componentScan.js – Scans includes/components folder and updates Nova's awareness

const fs = require('fs');
const path = require('path');

const baseDirs = ['includes', 'components'];
const outputFile = path.join(__dirname, '../data/components-index.json');

function scanComponentFiles() {
  const index = {
    scannedAt: new Date().toISOString(),
    folders: []
  };

  for (const dirName of baseDirs) {
    const dirPath = path.join(__dirname, '..', dirName);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter(file => file.endsWith('.html'));
    index.folders.push({
      name: dirName,
      count: files.length,
      files
    });
  }

  fs.writeFileSync(outputFile, JSON.stringify(index, null, 2));
  console.log(`✅ Nova's component index updated at /data/components-index.json`);
}

scanComponentFiles();
