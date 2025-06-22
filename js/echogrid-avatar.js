/**
 * EchoGrid Avatar Component
 * Interactive flip card component for team member showcases
 * Created for AmbientPixels EchoGrid project
 */

class EchoGridAvatar {
  /**
   * Initialize the EchoGrid Avatar component
   * @param {Object} options - Configuration options
   * @param {string} options.containerSelector - CSS selector for the avatar container
   * @param {string} options.dataUrl - URL to the JSON data file
   * @param {boolean} options.clearOnLoad - Whether to clear the container before loading avatars
   */
  constructor(options = {}) {
    this.containerSelector = options.containerSelector || '[data-echogrid-avatar-container]';
    this.dataUrl = options.dataUrl || null;
    this.clearOnLoad = options.clearOnLoad !== undefined ? options.clearOnLoad : false;
    this.container = null;
    this.teamData = null;
    
    this.init();
  }
  
  /**
   * Initialize the component
   */
  init() {
    // Find the container
    this.container = document.querySelector(this.containerSelector);
    
    if (!this.container) {
      console.error('EchoGrid Avatar: Container not found');
      return;
    }
    
    // Get data URL from container if not provided in options
    if (!this.dataUrl) {
      this.dataUrl = this.container.getAttribute('data-data-url');
    }
    
    // Check if we should clear the container on load
    if (this.container.hasAttribute('data-clear-on-load')) {
      this.clearOnLoad = this.container.getAttribute('data-clear-on-load') === 'true';
    }
    
    // If we have existing avatars in the DOM, initialize them
    this.initExistingAvatars();
    
    // If we have a data URL, load the data and create avatars
    if (this.dataUrl) {
      this.loadData();
    }
  }
  
  /**
   * Initialize any existing avatars in the DOM
   */
  initExistingAvatars() {
    const avatars = this.container.querySelectorAll('.echogrid-avatar');
    
    avatars.forEach(avatar => {
      this.initAvatar(avatar);
    });
  }
  
  /**
   * Initialize a single avatar
   * @param {HTMLElement} avatar - The avatar element
   */
  initAvatar(avatar) {
    // Skip if already initialized
    if (avatar.dataset.initialized === 'true') {
      return;
    }
    
    // Add click handler for flip
    avatar.addEventListener('click', () => {
      this.toggleFlip(avatar);
    });
    
    // Add keyboard handler for accessibility
    avatar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggleFlip(avatar);
      }
    });
    
    // Set tabindex for keyboard navigation
    avatar.setAttribute('tabindex', '0');
    
    // Set aria attributes for accessibility
    avatar.setAttribute('role', 'button');
    avatar.setAttribute('aria-label', `Team member card: ${this.getAvatarName(avatar)}. Press Enter to flip.`);
    
    // Mark as initialized
    avatar.dataset.initialized = 'true';
  }
  
  /**
   * Toggle the flip state of an avatar
   * @param {HTMLElement} avatar - The avatar element
   */
  toggleFlip(avatar) {
    avatar.classList.toggle('flipped');
    
    // Update aria-pressed attribute
    const isFlipped = avatar.classList.contains('flipped');
    avatar.setAttribute('aria-pressed', isFlipped);
    
    // Update aria-label
    const name = this.getAvatarName(avatar);
    avatar.setAttribute('aria-label', `Team member card: ${name}. ${isFlipped ? 'Showing details. Press Enter to flip back.' : 'Press Enter to flip for details.'}`);
  }
  
  /**
   * Get the name of an avatar
   * @param {HTMLElement} avatar - The avatar element
   * @returns {string} - The name of the avatar
   */
  getAvatarName(avatar) {
    const nameEl = avatar.querySelector('.echogrid-avatar-name');
    return nameEl ? nameEl.textContent : 'Team member';
  }
  
  /**
   * Load data from the JSON file
   */
  loadData() {
    fetch(this.dataUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        this.teamData = data;
        this.renderTeam();
      })
      .catch(error => {
        console.error('Error loading EchoGrid Avatar data:', error);
      });
  }
  
  /**
   * Render the team data
   */
  renderTeam() {
    if (!this.teamData || !this.teamData.members) {
      console.error('EchoGrid Avatar: Invalid team data');
      return;
    }
    
    // Clear the container if needed
    if (this.clearOnLoad) {
      this.container.innerHTML = '';
    }
    
    // Create team header if provided
    if (this.teamData.team) {
      this.renderTeamHeader();
    }
    
    // Create avatars for each team member
    this.teamData.members.forEach(member => {
      const avatar = this.createAvatar(member);
      this.container.appendChild(avatar);
      this.initAvatar(avatar);
    });
  }
  
  /**
   * Render the team header
   */
  renderTeamHeader() {
    // Optional: Create a team header with name, description, etc.
    // This is not implemented by default but can be added if needed
  }
  
  /**
   * Create an avatar element
   * @param {Object} member - The team member data
   * @returns {HTMLElement} - The avatar element
   */
  createAvatar(member) {
    const avatar = document.createElement('div');
    avatar.className = 'echogrid-avatar';
    avatar.dataset.role = member.role.toLowerCase();
    
    // Create inner structure
    avatar.innerHTML = `
      <div class="echogrid-avatar-inner">
        <div class="echogrid-avatar-front">
          <div class="echogrid-avatar-image">
            <img src="${member.image || '/images/placeholder-avatar.jpg'}" alt="${member.name}">
          </div>
          <div class="echogrid-avatar-content">
            <h3 class="echogrid-avatar-name">${member.name}</h3>
            <p class="echogrid-avatar-role">${member.role}</p>
            <p class="echogrid-avatar-specialty">${member.specialty}</p>
            <div class="echogrid-avatar-stats">
              ${this.renderStats(member.stats)}
            </div>
          </div>
          ${member.rarity ? `<div class="echogrid-avatar-rarity ${member.rarity.toLowerCase()}">${member.rarity}</div>` : ''}
          <div class="echogrid-avatar-flip">
            <i class="fas fa-redo"></i>
          </div>
        </div>
        <div class="echogrid-avatar-back">
          <h3 class="echogrid-avatar-name">${member.name}</h3>
          <p class="echogrid-avatar-bio">${member.bio}</p>
          ${member.quote ? `<div class="echogrid-avatar-quote">"${member.quote}"</div>` : ''}
          <div class="echogrid-avatar-back-footer">
            <span class="echogrid-avatar-role">${member.role}</span>
            <div class="echogrid-avatar-flip">
              <i class="fas fa-undo"></i>
            </div>
          </div>
        </div>
      </div>
      ${member.tooltip ? `<div class="echogrid-avatar-tooltip">${member.tooltip}</div>` : ''}
    `;
    
    return avatar;
  }
  
  /**
   * Render stats for a team member
   * @param {Object} stats - The team member stats
   * @returns {string} - HTML for the stats
   */
  renderStats(stats) {
    if (!stats) return '';
    
    return Object.entries(stats).map(([key, value]) => `
      <div class="echogrid-avatar-stat">
        <span class="echogrid-avatar-stat-value">${value}</span>
        <span class="echogrid-avatar-stat-label">${key}</span>
      </div>
    `).join('');
  }
}

// Auto-initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', function() {
  // Find all containers with data-echogrid-avatar-container attribute
  const containers = document.querySelectorAll('[data-echogrid-avatar-container]');
  
  // Initialize each container
  containers.forEach(container => {
    const dataUrl = container.getAttribute('data-data-url');
    const clearOnLoad = container.getAttribute('data-clear-on-load') === 'true';
    
    new EchoGridAvatar({
      containerSelector: `#${container.id}`,
      dataUrl: dataUrl,
      clearOnLoad: clearOnLoad
    });
  });
});
