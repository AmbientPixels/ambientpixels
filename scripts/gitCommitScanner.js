// File: gitCommitScanner.js
// Description: Scans git repository for recent commits and saves to JSON

const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configuration
const CONFIG = {
  MAX_COMMITS: 50,
  GITHUB_REPO: 'AmbientPixels/ambientpixels', // Added missing GITHUB_REPO
  ARCHIVE_DIR: path.join(__dirname, '../data/git-commit-archives'),
  OUTPUT_FILE: path.join(__dirname, '../data/git-commits.json'),
};

// Ensure archive directory exists
async function ensureArchiveDir() {
  try {
    await fs.mkdir(CONFIG.ARCHIVE_DIR, { recursive: true });
    console.log(`Archive directory created: ${CONFIG.ARCHIVE_DIR}`);
    return true;
  } catch (error) {
    console.log('Archive directory already exists');
    return true;
  }
}

// Fetch recent commits with branch information
async function getRecentCommits() {
  const git = simpleGit();
  try {
    console.log('Fetching git log...');
    const log = await git.raw([
      'log',
      '--since=7 days ago',
      `--max-count=${CONFIG.MAX_COMMITS}`,
      '--pretty=format:%H|%s|%ci|%an|%ae|%D', // Use | as delimiter for reliable parsing
    ]);

    const commits = log
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [hash, message, timestamp, authorName, authorEmail, refNames] = line.split('|');
        if (!hash || !message || !timestamp) {
          console.warn(`Failed to parse commit: ${line}`);
          return null;
        }

        // Parse ref names (branches and tags)
        const branchList = refNames
          ? refNames
              .split(',')
              .map(branch => branch.trim())
              .filter(branch => branch && branch !== 'HEAD')
              .map(branch => branch.replace('origin/', ''))
          : [];

        return {
          id: uuidv4(),
          hash,
          message,
          timestamp,
          author: { name: authorName, email: authorEmail },
          branches: branchList,
          url: `https://github.com/${CONFIG.GITHUB_REPO}/commit/${hash}`,
        };
      })
      .filter(Boolean); // Remove null entries

    console.log('Found commits:', commits.length);
    return commits;
  } catch (error) {
    console.error('Error fetching commits:', error);
    return [];
  }
}

// Save commits to files
async function saveCommits(commits) {
  try {
    const data = {
      commits,
      timestamp: new Date().toISOString(),
      count: commits.length,
      scanId: Date.now(),
    };

    console.log('Saving commit data:', {
      commitCount: commits.length,
      timestamp: data.timestamp,
      scanId: data.scanId,
    });

    const archiveFilename = path.join(CONFIG.ARCHIVE_DIR, `commits_${data.scanId}.json`);

    console.log('Writing to main file:', CONFIG.OUTPUT_FILE);
    console.log('Writing to archive:', archiveFilename);

    await Promise.all([
      fs.writeFile(CONFIG.OUTPUT_FILE, JSON.stringify(data, null, 2)),
      fs.writeFile(archiveFilename, JSON.stringify(data, null, 2)),
    ]);

    console.log('Files written successfully');

    // Clean up old archives (keep last 10)
    const archives = await fs.readdir(CONFIG.ARCHIVE_DIR);
    const jsonArchives = archives.filter(file => file.endsWith('.json'));
    console.log('Found archives:', jsonArchives.length);

    const sortedArchives = await Promise.all(
      jsonArchives.map(async (file) => {
        const stats = await fs.stat(path.join(CONFIG.ARCHIVE_DIR, file));
        return { file, mtime: stats.mtime };
      })
    );

    sortedArchives.sort((a, b) => b.mtime - a.mtime);

    if (sortedArchives.length > 10) {
      const filesToDelete = sortedArchives.slice(10);
      console.log('Cleaning up old archives:', filesToDelete.length);
      await Promise.all(
        filesToDelete.map(({ file }) => fs.unlink(path.join(CONFIG.ARCHIVE_DIR, file)))
      );
    }

    return data;
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
    console.log(`Saved ${commits.length} commits to ${CONFIG.OUTPUT_FILE}`);
  } catch (error) {
    console.error('Error running git commit scan:', error);
    process.exit(1);
  }
}

// Run the scan
runGitCommitScan();