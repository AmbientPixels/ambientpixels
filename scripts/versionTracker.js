// versionTracker.js – Generate version.json from Git and timestamp

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, '../data/version.json');

function getVersionInfo() {
  let commitHash = 'unknown';
  try {
    commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  } catch (err) {
    console.warn('⚠️ Could not retrieve commit hash');
  }

  const version = {
    version: 'v2.3',
    build: commitHash,
    updated: new Date().toISOString()
  };

  fs.writeFileSync(outputFile, JSON.stringify(version, null, 2));
  console.log(`✅ Nova's version updated in /data/version.json`);
}

getVersionInfo();


