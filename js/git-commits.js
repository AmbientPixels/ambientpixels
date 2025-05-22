// git-commits.js - Nova's git commit display

// Configuration
const GIT_COMMITS_CONFIG = {
  maxCommits: 50
};

// Sanitize HTML to prevent XSS
const sanitizeHTML = (str) => {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

// Styles
const gitCommitsStyles = `
.git-commits-container {
  position: relative;
  width: 100%;
  background: rgba(255, 255, 255, 0.95);
  padding: 1rem;
  border: 2px solid #4a90e2;
  border-radius: 4px;
  font-family: 'Fira Code', monospace;
  max-height: 90vh;
  overflow-y: auto;
}

.git-commit-item {
  display: flex;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid #eee;
  font-size: 0.9rem;
  line-height: 1.4;
  transition: all 0.3s ease;
}

.git-commit-item.pulse {
  animation: pulse 1s ease-in-out;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.8; }
  100% { opacity: 1; }
}

.git-commit-index {
  color: #4a90e2;
  font-weight: bold;
  margin-right: 0.5rem;
  min-width: 2rem;
}

.git-commit-hash a {
  color: #4a90e2;
  text-decoration: none;
}

.git-commit-hash a:hover {
  text-decoration: underline;
}

.git-commit-message {
  flex: 1;
  margin: 0 1rem;
}

.git-commit-meta {
  color: #666;
}

.git-commit-meta .relative-time {
  color: #999;
  font-size: 0.8rem;
}

.git-commit-branches {
  color: #999;
  font-size: 0.8rem;
}

.error-message {
  display: flex;
  align-items: center;
  padding: 1rem;
  background: #ffebee;
  border: 1px solid #ffcdd2;
  border-radius: 4px;
  color: #c62828;
}

.error-message i {
  margin-right: 0.5rem;
}

.error-message ul {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0;
}

.error-message li {
  margin: 0.25rem 0;
}
`;

// Add styles to document
const styleSheet = document.createElement('style');
styleSheet.textContent = gitCommitsStyles;
document.head.appendChild(styleSheet);

async function fetchGitCommits(retries = 3) {
  try {
    const response = await fetch('/git-commits.json');
    if (!response.ok) {
      if (response.status === 404) {
        console.log('Local git-commits.json not found, trying remote...');
        return await fetchRemoteWithRetry(retries);
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Invalid response content type');
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching local git commits:', error);
    return await fetchRemoteWithRetry(retries);
  }
}

async function fetchRemoteWithRetry(retries) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Attempting to fetch remote data (attempt ${attempt}/${retries})`);
      const response = await fetch('https://ambientpixels.ai/data/git-commits.json');
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Invalid response content type');
      }
      if (!response.ok) {
        if (response.status === 404) {
          console.log('Remote git-commits.json not found');
          return { commits: [], timestamp: new Date().toISOString(), count: 0 };
        }
        throw new Error(`Remote HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      if (attempt === retries) {
        console.error('Final attempt failed:', error);
        return { commits: [], timestamp: new Date().toISOString(), count: 0 };
      }
      console.log(`Attempt ${attempt} failed, retrying...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt + Math.random() * 100));
    }
  }
}

function getRelativeTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function validateTimestamp(timestamp) {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid timestamp');
    }
    return {
      absolute: date.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }),
      relative: getRelativeTime(timestamp)
    };
  } catch (error) {
    console.warn('Invalid timestamp:', timestamp);
    return { absolute: 'Invalid Date', relative: '' };
  }
}

function updateGitCommitsDisplay(data) {
  const container = document.getElementById('git-history-container');
  if (!container) {
    console.error('Git history container not found');
    return;
  }
  container.classList.add('git-commits-container');

  const commits = data?.commits || [];

  if (!commits.length) {
    container.innerHTML = `
      <div class="error-message">
        <i class="fas fa-exclamation-triangle"></i>
        <span>No recent commits found. Possible causes:</span>
        <ul>
          <li>Git commit scanner hasn't run</li>
          <li>No commits in the last 24 hours</li>
          <li>Network issues</li>
          <li>Invalid commit data</li>
        </ul>
        <p>Please refresh the page or check back later.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = commits.map((commit, index) => {
    const timestamp = validateTimestamp(commit.timestamp);
    const url = commit.url && /^https:\/\/github\.com\//.test(commit.url) ? commit.url : '#';
    const message = sanitizeHTML(commit.message || 'No message');
    return `
      <div class="git-commit-item">
        <span class="git-commit-index">#${index + 1}</span>
        <span class="git-commit-hash">
          <a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="View commit ${commit.hash || 'unknown'}">
            ${commit.hash?.substring(0, 7) || 'N/A'}
          </a>
        </span>
        <span class="git-commit-message">${message.length > 80 ? `${message.substring(0, 80)}...` : message}</span>
        <span class="git-commit-meta">
          ${sanitizeHTML(commit.author?.name || 'Unknown')} • 
          <span class="absolute-time">${timestamp.absolute}</span>
          <span class="relative-time">${timestamp.relative}</span>
        </span>
        <span class="git-commit-branches">${commit.branches?.join(', ') || 'N/A'}</span>
      </div>
    `;
  }).join('');
}

let isInitialized = false;

async function initGitCommits() {
  if (isInitialized) return;
  isInitialized = true;

  try {
    console.log('Starting git commits initialization...');
    const data = await fetchGitCommits();
    console.log('Received data:', data);
    updateGitCommitsDisplay(data);
  } catch (error) {
    console.error('Error initializing git commits:', error);
    const container = document.getElementById('git-history-container');
    if (container) {
      container.innerHTML = `
        <div class="error-message">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Failed to load commits. Please try again later.</span>
        </div>
      `;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing git commits display...');
    initGitCommits();
  });
} else {
  console.log('Initializing git commits display...');
  initGitCommits();
}