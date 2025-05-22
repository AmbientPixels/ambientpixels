// gitCommitScanner.js - Nova's git commit scanner with enhanced metadata and version control

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

// Configuration
const CONFIG = {
  MAX_COMMITS: 10,
  COMMIT_FORMAT: '%h - %s (%cr) <%an>',
  VERSION: '1.0.0',
  ARCHIVE_DIR: path.join(__dirname, '../docs/git-commit-archives'),
  OUTPUT_FILE: path.join(__dirname, '../docs/git-commits.json'),
  WEB_ROOT_FILE: path.join(__dirname, '../git-commits.json')
};

// Ensure archive directory exists
if (!fs.existsSync(CONFIG.ARCHIVE_DIR)) {
  fs.mkdirSync(CONFIG.ARCHIVE_DIR, { recursive: true });
}

// Get current version from package.json
try {
  const pkg = require('../package.json');
  CONFIG.VERSION = pkg.version;
} catch (e) {
  console.warn('Could not read package.json version, using default');
}

function getRecentCommits() {
  try {
    // Check if we're in a git repository
    const isGitRepo = execSync('git status', { encoding: 'utf8' });
    console.log('Git repository status:', isGitRepo);

    // Change to root directory and get commits
    process.chdir(__dirname + '/..');
    const output = execSync(`git log -n ${CONFIG.MAX_COMMITS} --since="1 day ago" --all --pretty=format:"${CONFIG.COMMIT_FORMAT}"`, { encoding: 'utf8' });
    
    // Split and parse commits
    const commits = output.split('\n').filter(Boolean).map(commit => {
      const [hash, message, rest] = commit.split(' - ');
      const author = rest.match(/<(.+)>/)[1];
      const timestamp = rest.replace(/<.+>/, '').trim();
      
      // Get additional commit details
      const commitDetails = execSync(`git show -s --format=%B ${hash}`, { encoding: 'utf8' }).trim();
      const branch = execSync(`git branch --contains ${hash}`, { encoding: 'utf8' }).trim();
      
      return {
        id: uuidv4(),
        hash,
        message,
        timestamp,
        author,
        details: commitDetails,
        branches: branch.split('\n').map(b => b.trim().replace('*', '').trim()),
        version: CONFIG.VERSION,
        scanTimestamp: new Date().toISOString()
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
    count: commits.length,
    version: CONFIG.VERSION,
    scanId: uuidv4(),
    systemVersion: CONFIG.VERSION
  };

  // Create archive filename
  const archiveFilename = path.join(
    CONFIG.ARCHIVE_DIR,
    `commits_${data.scanId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  try {
    // Write to data directory
    fs.writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(data, null, 2));
    
    // Also copy to web root
    fs.writeFileSync(CONFIG.WEB_ROOT_FILE, JSON.stringify(data, null, 2));
    
    // Save to archive
    fs.writeFileSync(archiveFilename, JSON.stringify(data, null, 2));
    
    // Clean up old archives (keep last 10)
    const archives = fs.readdirSync(CONFIG.ARCHIVE_DIR)
      .filter(file => file.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a));
    
    if (archives.length > 10) {
      const filesToDelete = archives.slice(10);
      for (const file of filesToDelete) {
        fs.unlinkSync(path.join(CONFIG.ARCHIVE_DIR, file));
      }
    }
  } catch (error) {
    console.error('Error saving commit data:', error);
    throw error;
  }
  

  
  // Save to archive
  fs.writeFileSync(archiveFilename, JSON.stringify(data, null, 2));
  
  // Clean up old archives (keep last 10)
  const archives = fs.readdirSync(CONFIG.ARCHIVE_DIR)
    .filter(file => file.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a));
  
  if (archives.length > 10) {
    const filesToDelete = archives.slice(10);
    for (const file of filesToDelete) {
      fs.unlinkSync(path.join(CONFIG.ARCHIVE_DIR, file));
    }
  }
}

function runGitCommitScan() {
  const commits = getRecentCommits();
  saveCommits(commits);
  console.log(`Saved ${commits.length} recent commits to ${CONFIG.OUTPUT_FILE}`);
}

// Run the scan
runGitCommitScan();