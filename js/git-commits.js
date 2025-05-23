// Configuration
const GIT_COMMITS_CONFIG = {
  maxCommits: 50,
  retryAttempts: 3,
  retryDelay: 1000,
};

// Sanitize HTML to prevent XSS
const sanitizeHTML = (str) => {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
};

async function fetchGitCommits() {
  const { retryAttempts, retryDelay } = GIT_COMMITS_CONFIG;
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const response = await fetch('/data/git-commits.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Invalid response content type');
      }
      return await response.json();
    } catch (error) {
      console.error(`Fetch attempt ${attempt} failed:`, error);
      if (attempt === retryAttempts) {
        console.error('All fetch attempts failed');
        return { commits: [], timestamp: new Date().toISOString(), count: 0 };
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
    }
  }
}

function getRelativeTime(timestamp) {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return '';
  }
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
        minute: '2-digit',
      }),
      relative: getRelativeTime(timestamp),
    };
  } catch {
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
          <li>No commits in the last 7 days</li>
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
        <div class="git-commit-header">
          <div class="git-commit-index">#${index + 1}</div>
          <div class="git-commit-message">${message.length > 80 ? `${message.substring(0, 80)}...` : message}</div>
          <div class="git-commit-timestamp">${timestamp.relative}</div>
        </div>
        <div class="git-commit-meta">
          <div class="git-commit-author">${sanitizeHTML(commit.author?.name || 'Unknown')}</div>
          ${commit.branches && commit.branches.length > 0 ? `
            <div class="git-commit-branches">${commit.branches.join(', ')}</div>
          ` : ''}
          <div class="git-commit-hash">
            <a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="View commit ${commit.hash || 'unknown'}">
              ${commit.hash?.substring(0, 7) || 'N/A'}
            </a>
          </div>
        </div>
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
  console.log('Initializing git commits display... Ascending');
initGitCommits();
}