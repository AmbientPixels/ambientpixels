// changelogSnapshot.js – Capture latest commit summaries for Nova

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outputFile = path.join(__dirname, '../data/changelog.json');

function getRecentCommits(limit = 5) {
  try {
    const log = execSync(`git log -n ${limit} --pretty=format:"%h|%ad|%s" --date=iso`).toString();
    const entries = log.split('\n').map(line => {
      const [hash, date, ...msgParts] = line.split('|');
      return {
        hash: hash.trim(),
        date: date.trim(),
        message: msgParts.join('|').trim()
      };
    });
    return entries;
  } catch (err) {
    console.error("❌ Failed to read Git history", err);
    return [];
  }
}

function writeChangelog(commits) {
  const data = {
    updated: new Date().toISOString(),
    entries: commits
  };
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
  console.log(`✅ Nova's changelog updated: /data/changelog.json`);
}

writeChangelog(getRecentCommits(10));
