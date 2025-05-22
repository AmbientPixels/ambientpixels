// gitCommitScanner.js - Nova's git commit scanner

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const outputFile = path.join(__dirname, '../docs/git-commits.json');

// Configuration
const MAX_COMMITS = 10;
const COMMIT_FORMAT = '%h - %s (%cr) <%an>';

function getRecentCommits() {
  try {
    const output = execSync(`git log -n ${MAX_COMMITS} --since="1 day ago" --pretty=format:"${COMMIT_FORMAT}"`, { encoding: 'utf8' });
    const commits = output.split('\n').filter(Boolean).map(commit => {
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
    
    // Log the commits for debugging
    console.log('Found commits:', commits);
    return commits;
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
  
  // Write to data directory
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
  
  // Also copy to web root
  const webRootFile = path.join(__dirname, '../git-commits.json');
  fs.writeFileSync(webRootFile, JSON.stringify(data, null, 2));
}

function runGitCommitScan() {
  const commits = getRecentCommits();
  saveCommits(commits);
  console.log(`Saved ${commits.length} recent commits to ${outputFile}`);
}

// Run the scan
runGitCommitScan();
