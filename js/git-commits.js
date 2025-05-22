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
  max-width: 400px;
  z-index: 1000;
  transition: opacity 0.3s;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.git-commit-item {
  margin: 5px 0;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
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
}

.git-commit-branches {
  color: #90EE90;
  font-size: 10px;
  font-family: 'Inter', sans-serif;
}

.error-message {
  color: #FF0000;
  background: rgba(255, 0, 0, 0.1);
  padding: 10px;
  border-radius: 4px;
  margin: 10px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.error-message i {
  color: #FF0000;
  font-size: 18px;
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
    // First try local file
    const response = await fetch('/git-commits.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.commits;
  } catch (error) {
    console.error('Error fetching local git commits:', error);
    try {
      // Fallback to remote if local fails
      const response = await fetch('https://ambientpixels.ai/data/git-commits.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data.commits;
    } catch (error) {
      console.error('Error fetching remote git commits:', error);
      return [];
    }
  }
}

function updateGitCommitsDisplay(commits) {
  gitCommitsContainer.innerHTML = commits.map(commit => {
    // Format timestamp
    const timestamp = new Date(commit.timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Format branches
    const branches = commit.branches ? commit.branches.join(', ') : 'N/A';

    return `
    <div class="git-commit-item">
      <span class="git-commit-hash">${commit.hash}</span>
      <span class="git-commit-message">${commit.message}</span>
      <span class="git-commit-meta">${commit.author} • ${timestamp}</span>
      <span class="git-commit-branches">${branches}</span>
    </div>
  `;
  }).join('');
}

// Initialize
async function initGitCommits() {
  try {
    console.log('Starting git commits initialization...');
    const response = await fetch('https://ambientpixels.ai/data/git-commits.json');
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Received data:', data);
    updateGitCommitsDisplay(data.commits);
  } catch (error) {
    console.error('Error initializing git commits:', error);
    // Show error message in UI
    gitCommitsContainer.innerHTML = `
      <div class="error-message">
        <i class="fas fa-exclamation-triangle"></i>
        <span>Failed to load commit history. Please try again later.</span>
      </div>
    `;
  }
}

// Start the display
console.log('Initializing git commits display...');
initGitCommits();
