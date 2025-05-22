const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

// Configuration
const CONFIG = {
  MAX_COMMITS: 50,
  VERSION: '1.0.0',
  GITHUB_REPO: 'AmbientPixels/ambientpixels',
  FILTERS: {
    branches: [], // Add specific branches to filter
    authors: []   // Add specific authors to filter
  },
  ARCHIVE_DIR: path.join(__dirname, '../data/git-commit-archives'),
  OUTPUT_FILE: path.join(__dirname, '../data/git-commits.json'),
  WEB_ROOT_FILE: path.join(__dirname, '../data/git-commits.json')
};

async function ensureArchiveDir() {
  try {
    await fs.mkdir(CONFIG.ARCHIVE_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating archive directory:', error);
    throw error;
  }
}

async function getPackageVersion() {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(__dirname, '../package.json'), 'utf8'));
    CONFIG.VERSION = pkg.version;
  } catch (error) {
    console.warn('Could not read package.json version, using default:', error);
  }
}

function getRecentCommits() {
  try {
    // Check if we're in a git repository
    try {
      const isGitRepo = execSync('git status', { encoding: 'utf8' });
      console.log('Git repository status:', isGitRepo);
    } catch (gitError) {
      console.error('Error checking git status:', gitError);
      throw new Error('Not in a git repository');
    }

    // Validate repository directory
    const repoPath = path.resolve(__dirname, '..');
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository path does not exist: ${repoPath}`);
    }

    // Build git log command with filters
    let gitCommand = `git log -n ${CONFIG.MAX_COMMITS} --since="1 day ago" --all --pretty=format:"%h - %s (%cr) %an <%ae>"`;
    
    // Add branch filters if specified
    if (CONFIG.FILTERS.branches.length > 0) {
      gitCommand += ` --branches=${CONFIG.FILTERS.branches.join(',')}`;
    }
    
    // Execute git command
    const commitList = execSync(gitCommand, { 
      encoding: 'utf8',
      cwd: repoPath
    }).trim();

    // Get commits with detailed information and apply author filters
    const commits = commitList.split('\n').filter(Boolean).map(commit => {
      try {
        // Parse commit line
        const [hash, message, authorInfo] = commit.split(' - ');
        const authorMatch = authorInfo.match(/(.+) <(.+)>/);
        if (!authorMatch) {
          console.warn(`Failed to parse author info: ${authorInfo}`);
          return null;
        }
        const [_, authorName, authorEmail] = authorMatch;
        
        // Apply author filters if specified
        if (CONFIG.FILTERS.authors.length > 0 && !CONFIG.FILTERS.authors.includes(authorName)) {
          return null;
        }

        // Get timestamp
        const timestamp = execSync(`git show -s --format=%ci ${hash}`, { 
          encoding: 'utf8',
          cwd: repoPath
        }).trim();

        // Get branches
        const branchOutput = execSync(`git branch --contains ${hash}`, { 
          encoding: 'utf8',
          cwd: repoPath
        }).trim();
        const branches = branchOutput.split('\n').map(branch => branch.trim()).filter(branch => branch);

        // Get commit details
        const commitDetails = execSync(`git show ${hash} --stat`, { 
          encoding: 'utf8',
          cwd: repoPath
        }).trim();

        // Return structured commit data
        return {
          hash,
          message,
          timestamp,
          author: { name: authorName, email: authorEmail },
          branches,
          details: commitDetails,
          version: CONFIG.VERSION,
          id: uuidv4(),
          scanTimestamp: new Date().toISOString(),
          url: `https://github.com/${CONFIG.GITHUB_REPO}/commit/${hash}`
        };
      } catch (error) {
        console.error('Error parsing commit:', error);
        return null;
      }
    });

    // Remove null entries and return
    return commits.filter(Boolean);
  } catch (error) {
    console.error('Error fetching commits:', error);
    return [];
  }
}

async function saveCommits(commits) {
  const data = {
    commits,
    timestamp: new Date().toISOString(),
    count: commits.length,
    version: CONFIG.VERSION,
    scanId: uuidv4(),
    systemVersion: CONFIG.VERSION
  };

  const archiveFilename = path.join(
    CONFIG.ARCHIVE_DIR,
    `commits_${data.scanId}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );

  try {
    await Promise.all([
      fs.writeFile(CONFIG.OUTPUT_FILE, JSON.stringify(data, null, 2)),
      fs.writeFile(CONFIG.WEB_ROOT_FILE, JSON.stringify(data, null, 2)),
      fs.writeFile(archiveFilename, JSON.stringify(data, null, 2))
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

async function runGitCommitScan() {
  try {
    await ensureArchiveDir();
    await getPackageVersion();
    const commits = await getRecentCommits();
    await saveCommits(commits);
    console.log(`Saved ${commits.length} recent commits to ${CONFIG.OUTPUT_FILE}`);
  } catch (error) {
    console.error('Error running git commit scan:', error);
  }
}

runGitCommitScan();