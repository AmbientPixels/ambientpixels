// File: gitCommitScanner.js
// Description: Scans git repository for recent commits and saves to JSON

const simpleGit = require('simple-git/promise');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configuration
const CONFIG = {
  MAX_COMMITS: 50,
  VERSION: '1.0.0',
  GITHUB_REPO: 'AmbientPixels/ambientpixels',
  ARCHIVE_DIR: path.join(__dirname, '../data/git-commit-archives'),
  OUTPUT_FILE: path.join(__dirname, '../data/git-commits.json'),
};

// Ensure archive directory exists
async function ensureArchiveDir() {
  try {
    await fs.mkdir(CONFIG.ARCHIVE_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating archive directory:', error);
    throw error;
  }
}

// Fetch recent commits with branch information
async function getRecentCommits() {
  const git = simpleGit();
  try {
    // Get commit log
    const log = await git.log({
      maxCount: CONFIG.MAX_COMMITS,
      since: '7 days ago',
      format: 'json'
    });

    // Get list of all branches
    const branches = await git.branch();
    const branchMap = new Map();
    
    // Create map of branch names to commits
    for (const branch of branches.all) {
      if (branch !== 'HEAD') {
        const branchCommits = await git.log({
          maxCount: CONFIG.MAX_COMMITS,
          since: '7 days ago',
          branch: branch
        });
        
        for (const commit of branchCommits.all) {
          const existing = branchMap.get(commit.hash) || [];
          branchMap.set(commit.hash, [...existing, branch]);
        }
      }
    }

    // Process commits
    const commits = await Promise.all(
      log.all.map(async (commit) => {
        const commitBranches = branchMap.get(commit.hash) || [];
        return {
          id: uuidv4(),
          hash: commit.hash,
          message: commit.message,
          timestamp: commit.date,
          author: { 
            name: commit.author_name, 
            email: commit.author_email 
          },
          branches: commitBranches
            .filter(branch => branch !== 'HEAD' && !branch.startsWith('origin/'))
            .map(branch => branch.replace('origin/', '')),
          url: `https://github.com/${CONFIG.GITHUB_REPO}/commit/${commit.hash}`
        };
      })
    );

    return commits;
  } catch (error) {
    console.error('Error fetching commits:', error);
    throw error;
  }
}

// Save commits to files
async function saveCommits(commits) {
  const data = {
    commits,
    timestamp: new Date().toISOString(),
    count: commits.length,
    version: CONFIG.VERSION,
    scanId: uuidv4(),
  };

  const archiveFilename = path.join(
    CONFIG.ARCHIVE_DIR,
    `commits_${data.scanId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  try {
    await Promise.all([
      fs.writeFile(CONFIG.OUTPUT_FILE, JSON.stringify(data, null, 2)),
      fs.writeFile(archiveFilename, JSON.stringify(data, null, 2)),
    ]);

    // Clean up old archives (keep last 10)
    const archives = await fs.readdir(CONFIG.ARCHIVE_DIR);
    const jsonArchives = archives.filter(file => file.endsWith('.json'));
    const sortedArchives = await Promise.all(
      jsonArchives.map(async (file) => {
        const stats = await fs.stat(path.join(CONFIG.ARCHIVE_DIR, file));
        return { file, mtime: stats.mtime };
      })
    );

    sortedArchives.sort((a, b) => b.mtime - a.mtime);

    if (sortedArchives.length > 10) {
      const filesToDelete = sortedArchives.slice(10);
      await Promise.all(
        filesToDelete.map(({ file }) => fs.unlink(path.join(CONFIG.ARCHIVE_DIR, file)))
      );
    }
  } catch (error) {
    console.error('Error saving commit data:', error);
    throw error;
  }
}

// Main execution
async function runGitCommitScan() {
  try {
    console.log('Starting git commit scan...');
    await ensureArchiveDir();
    const commits = await getRecentCommits();
    await saveCommits(commits);
    console.log(`Saved ${commits.length} recent commits to ${CONFIG.OUTPUT_FILE}`);
  } catch (error) {
    console.error('Error running git commit scan:', error);
    process.exit(1);
  }
}

// Run the scan
runGitCommitScan();