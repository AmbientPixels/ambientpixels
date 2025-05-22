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
    // Check if we're in a git repository
    const isGitRepo = execSync('git status', { encoding: 'utf8' });
    console.log('Git repository status:', isGitRepo);

    // Change to root directory and get commits
    process.chdir(__dirname + '/..');
    const output = execSync(`git log -n ${MAX_COMMITS} --since="1 day ago" --all --pretty=format:"${COMMIT_FORMAT}"`, { encoding: 'utf8' });
    
    // Split and parse commits
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
    
    // Log detailed commit info
    console.log('Found commits:', commits.length);
    commits.forEach((commit, index) => {
      console.log(`Commit ${index + 1}:`, commit);
    });
    
    return commits;
  } catch (e) {
    console.error('Error fetching commits:', e);
    console.error('Error details:', e.message);
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
