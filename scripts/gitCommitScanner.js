// gitCommitScanner.js - Nova's git commit scanner

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const outputFile = path.join(__dirname, '../data/git-commits.json');

// Configuration
const MAX_COMMITS = 10;
const COMMIT_FORMAT = '%h - %s (%cr) <%an>';

function getRecentCommits() {
  try {
    const output = execSync(`git log -n ${MAX_COMMITS} --pretty=format:"${COMMIT_FORMAT}"`, { encoding: 'utf8' });
    return output.split('\n').filter(Boolean).map(commit => {
      const [hash, message, rest] = commit.split(' - ');
      const author = rest.match(/<(.+)>/)[1];
      const timestamp = rest.replace(/<.+>/, '').trim();
      return {
        hash,
        message,
        timestamp,
        author
      };
    });
  } catch (e) {
    console.error('Error fetching commits:', e);
    return [];
  }
}

function saveCommits(commits) {
  const data = {
    commits,
    timestamp: new Date().toISOString(),
    count: commits.length
  };
  
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
}

function runGitCommitScan() {
  const commits = getRecentCommits();
  saveCommits(commits);
  console.log(`Saved ${commits.length} recent commits to ${outputFile}`);
}

// Run the scan
runGitCommitScan();
