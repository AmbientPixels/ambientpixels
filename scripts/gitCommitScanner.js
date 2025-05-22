const fs = require('fs').promises;
const path = require('path');
const simpleGit = require('simple-git');
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
  ARCHIVE_DIR: path.join(__dirname, '../docs/git-commit-archives'),
  OUTPUT_FILE: path.join(__dirname, '../docs/git-commits.json'),
  WEB_ROOT_FILE: path.join(__dirname, '../git-commits.json')
};

// Initialize simple-git
const git = simpleGit(path.join(__dirname, '..'));

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

async function getRecentCommits() {
  try {
    // Check if in a git repository
    await git.status();

    // Get recent commits
    const logOptions = {
      maxCount: CONFIG.MAX_COMMITS,
      from: 'HEAD',
      '--since': '1 day ago',
      '--all': true
    };
    if (CONFIG.FILTERS.branches.length) {
      logOptions['--branches'] = CONFIG.FILTERS.branches.join(',');
    }

    const log = await git.log(logOptions);

    const commits = await Promise.all(log.all.map(async (commit) => {
      try {
        // Sanitize hash
        const hash = commit.hash.replace(/[^a-f0-9]/g, '').slice(0, 40);
        if (!hash) throw new Error('Invalid commit hash');

        // Apply author filter
        if (CONFIG.FILTERS.authors.length && !CONFIG.FILTERS.authors.includes(commit.author_name)) {
          return null;
        }

        // Get branches
        const branches = (await git.raw(['branch', '--contains', hash]))
          .split('\n')
          .map(b => b.trim().replace('*', '').trim())
          .filter(Boolean);

        // Get commit details
        const details = (await git.show([hash, '--stat'])).trim();

        return {
          id: uuidv4(),
          hash,
          message: commit.message,
          timestamp: commit.date,
          author: { name: commit.author_name, email: commit.author_email },
          branches,
          details,
          version: CONFIG.VERSION,
          scanTimestamp: new Date().toISOString(),
          url: `https://github.com/${CONFIG.GITHUB_REPO}/commit/${hash}`
        };
      } catch (error) {
        console.error(`Error parsing commit ${commit.hash}:`, error);
        return null;
      }
    }));

    const validCommits = commits.filter(Boolean);
    console.log('Found commits:', validCommits.length);
    validCommits.forEach((commit, index) => console.log(`Commit ${index + 1}:`, commit));

    return validCommits;
  } catch (error) {
    console.error('Error fetching commits:', error.message);
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