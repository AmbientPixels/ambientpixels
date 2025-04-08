// jsFunctionMap.js – Extracts top-level function names from all .js files in /scripts

const fs = require('fs');
const path = require('path');

const scriptsDir = path.join(__dirname);
const outputFile = path.join(__dirname, '../data/js-function-map.json');

function extractFunctionsFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const functionRegex = /function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*\(.*?\)\s*=>/g;

  const matches = [];
  let match;
  while ((match = functionRegex.exec(content)) !== null) {
    matches.push(match[1] || match[2]);
  }

  return matches;
}

function buildFunctionMap() {
  const map = {};
  const files = fs.readdirSync(scriptsDir).filter(file => file.endsWith('.js'));

  files.forEach(file => {
    const fullPath = path.join(scriptsDir, file);
    const functions = extractFunctionsFromFile(fullPath);
    map[file] = functions;
  });

  fs.writeFileSync(outputFile, JSON.stringify({
    scannedAt: new Date().toISOString(),
    scripts: map
  }, null, 2));

  console.log(`✅ Nova JS function map written to: ${outputFile}`);
}

buildFunctionMap();
