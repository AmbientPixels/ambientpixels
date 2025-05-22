// File: /js/git-info.js - Dynamic Git Information Display

// Configuration
const GIT_INFO_CONFIG = {
  updateInterval: 30000,  // Update every 30 seconds
  maxCommits: 5,         // Maximum number of commits to show
  showAuthor: true,      // Show commit author
  showTimestamp: true,   // Show commit timestamp
  dateFormat: 'MM/DD/YYYY HH:mm', // Date format
};

// DOM Elements
const gitInfoContainer = document.createElement('div');
gitInfoContainer.className = 'git-info-container windsurf-info';

// Styles
const gitInfoStyles = `
.git-info-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: rgba(67, 21, 113, 0.9);
  color: #fff;
  padding: 10px;
  border-radius: 8px;
  font-family: 'Courier New', monospace;
  max-width: 300px;
  z-index: 1000;
  transition: opacity 0.3s;
}

.git-info-item {
  margin: 5px 0;
  font-size: 12px;
}

.git-info-message {
  color: #87CEEB;
}

.git-info-author {
  color: #FFD700;
  font-size: 10px;
}

.git-info-timestamp {
  color: #90EE90;
  font-size: 10px;
}
`;

// Add styles to document
const styleSheet = document.createElement('style');
styleSheet.textContent = gitInfoStyles;
document.head.appendChild(styleSheet);

// Add container to document
document.body.appendChild(gitInfoContainer);

async function fetchGitCommits() {
  try {
    // Use git command to get recent commits
    const { stdout } = await new Promise((resolve, reject) => {
      require('child_process').exec(
        'git log -n ' + GIT_INFO_CONFIG.maxCommits + ' --pretty=format:"%h - %s (%cr) <%an>"',
        { cwd: process.cwd() },
        (error, stdout) => error ? reject(error) : resolve({ stdout })
      );
    });

    // Parse and format the commits
    const commits = stdout.split('\n').map(commit => {
      const parts = commit.match(/^(\w+) - (.+) \((\d+ \w+ ago)\) <(.+)>$/);
      return parts ? {
        hash: parts[1],
        message: parts[2],
        relativeTime: parts[3],
        author: parts[4]
      } : null;
    }).filter(Boolean);

    return commits;
  } catch (error) {
    console.error('Error fetching git commits:', error);
    return [];
  }
}

function updateGitInfoDisplay(commits) {
  gitInfoContainer.innerHTML = commits.map(commit => `
    <div class="git-info-item">
      <span class="git-info-message">${commit.message}</span>
      ${GIT_INFO_CONFIG.showAuthor ? `<span class="git-info-author">${commit.author}</span>` : ''}
      ${GIT_INFO_CONFIG.showTimestamp ? `<span class="git-info-timestamp">${commit.relativeTime}</span>` : ''}
    </div>
  `).join('');
}

// Initialize
async function initGitInfo() {
  try {
    const commits = await fetchGitCommits();
    updateGitInfoDisplay(commits);
    
    // Start periodic updates
    setInterval(async () => {
      const newCommits = await fetchGitCommits();
      updateGitInfoDisplay(newCommits);
    }, GIT_INFO_CONFIG.updateInterval);
  } catch (error) {
    console.error('Failed to initialize git info:', error);
  }
}

// Start the git info display
initGitInfo();
