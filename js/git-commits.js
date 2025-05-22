// git-commits.js - Nova's git commit display

// Configuration
const GIT_COMMITS_CONFIG = {
  maxCommits: 10,
  dateFormat: 'MM/DD/YYYY HH:mm'
};

// DOM Elements
const gitCommitsContainer = document.createElement('div');
gitCommitsContainer.className = 'git-commits-container windsurf-info';

// Styles
const gitCommitsStyles = `
.git-commits-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: rgba(67, 21, 113, 0.9);
  color: #fff;
  padding: 15px;
  border-radius: 8px;
  font-family: 'Courier New', monospace;
  max-width: 300px;
  z-index: 1000;
  transition: opacity 0.3s;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.git-commit-item {
  margin: 5px 0;
  font-size: 12px;
  display: flex;
  align-items: center;
}

.git-commit-hash {
  color: #87CEEB;
  font-size: 10px;
  margin-right: 5px;
}

.git-commit-message {
  flex: 1;
  color: #fff;
}

.git-commit-meta {
  color: #FFD700;
  font-size: 10px;
  margin-left: 5px;
}
`;

// Add styles to document
const styleSheet = document.createElement('style');
styleSheet.textContent = gitCommitsStyles;
document.head.appendChild(styleSheet);

// Add container to document
document.body.appendChild(gitCommitsContainer);

async function fetchGitCommits() {
  try {
    const response = await fetch('https://ambientpixels.ai/data/git-commits.json');
    const data = await response.json();
    return data.commits;
  } catch (error) {
    console.error('Error fetching git commits:', error);
    return [];
  }
}

function updateGitCommitsDisplay(commits) {
  gitCommitsContainer.innerHTML = commits.map(commit => `
    <div class="git-commit-item">
      <span class="git-commit-hash">${commit.hash}</span>
      <span class="git-commit-message">${commit.message}</span>
      <span class="git-commit-meta">${commit.author} • ${commit.timestamp}</span>
    </div>
  `).join('');
}

// Initialize
async function initGitCommits() {
  try {
    const commits = await fetchGitCommits();
    updateGitCommitsDisplay(commits);
  } catch (error) {
    console.error('Error initializing git commits:', error);
  }
}

// Start the display
initGitCommits();
