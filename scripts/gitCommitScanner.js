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

    // Check directory contents
    try {
      const files = fs.readdirSync(repoPath);
      console.log('Directory contents:', files);
    } catch (error) {
      console.error('Error reading directory:', error);
    }

    // Check git status
    try {
      const status = execSync('git status', { cwd: repoPath, encoding: 'utf8' });
      console.log('Git status:', status);
    } catch (error) {
      console.error('Error checking git status:', error);
    }

    // Build git log command with filters
    let gitCommand = `git log -n ${CONFIG.MAX_COMMITS} --all --pretty=format:"%h|%s|%ci|%d"`;
    
    // Add time filter as optional
    try {
      // Try to get the last commit date
      const lastCommitDate = execSync('git log -1 --format=%cd', { 
        cwd: repoPath, 
        encoding: 'utf8'
      }).trim();
      console.log('Last commit date:', lastCommitDate);
      
      // If we have commits, add time filter
      if (lastCommitDate) {
        gitCommand += ` --since="7 days ago"`;
      }
    } catch (error) {
      console.log('No commits found, using all commits');
    }
    
    // Add branch filters if specified
    if (CONFIG.FILTERS.branches.length > 0) {
      gitCommand += ` --branches=${CONFIG.FILTERS.branches.join(',')}`;
    }
    
    // Execute git command
    console.log('Executing git command:', gitCommand);
    console.log('In directory:', repoPath);
    
    try {
      const commitList = execSync(gitCommand, { 
        encoding: 'utf8',
        cwd: repoPath
      }).trim();
      console.log('Git command output:', commitList);
      
      // Get commits with detailed information and apply author filters
      const rawCommits = commitList.split('\n').filter(Boolean);
      console.log('Raw commits:', rawCommits);
      
      const commits = rawCommits.map(rawCommit => {
        try {
          // Split by | to get basic commit info
          const [hash, message, timestamp, refNames] = rawCommit.split('|');
          if (!hash || !message || !timestamp) {
            console.warn(`Failed to parse commit: ${rawCommit}`);
            return null;
          }

          // Get author info using git show
          const authorInfo = execSync(`git show -s --format="%an|%ae" ${hash}`, {
            encoding: 'utf8',
            cwd: repoPath
          }).trim();
          const [authorName, authorEmail] = authorInfo.split('|');

          // Apply author filters if specified
          if (CONFIG.FILTERS.authors.length > 0 && !CONFIG.FILTERS.authors.includes(authorName)) {
            return null;
          }

          // Parse ref names (branches and tags)
          const branchList = refNames
            .split(',')
            .map(branch => branch.trim())
            .filter(branch => branch && branch !== 'HEAD')
            .map(branch => branch.replace('origin/', ''));

          // Return structured commit data
          return {
            id: uuidv4(),
            hash,
            message,
            timestamp,
            author: { name: authorName, email: authorEmail },
            branches: branchList,
            version: CONFIG.VERSION,
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
      console.error('Error executing git command:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error fetching commits:', error);
    return [];
  }
}

// Main execution
async function runGitCommitScan() {
  try {
    console.log('Starting git commit scan...');
    
    // Ensure archive directory exists
    await ensureArchiveDir();
    
    // Get package version
    await getPackageVersion();
    
    // Get recent commits
    const commits = await getRecentCommits();
    console.log('Found commits:', commits.length);
    
    // Save to files
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

      console.log('Git commit scan complete');
      console.log(`Saved ${commits.length} recent commits to ${CONFIG.OUTPUT_FILE}`);
    } catch (error) {
      console.error('Error saving commit data:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error running git commit scan:', error);
    process.exit(1);
  }
}

// Run the scan
runGitCommitScan();