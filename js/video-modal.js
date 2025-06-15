/**
 * Video Modal Module
 * Handles the display and interaction of video modals
 */

// Video mapping - in a real app, this would be more dynamic
const videoMap = {
  'ninja-theory-help-center': {
    title: 'Ninja Theory Help Center',
    description: 'Animated showcase of the Ninja Theory Help Center',
    videoId: 'zhcM5tEaSfM',
    duration: '1:45',
    durationLabel: '1 min 45 sec'
  },
  'copilot-playground': {
    title: 'Copilot Playground',
    description: 'AI-driven support prompt chains for gaming help',
    videoId: 'dQw4w9WgXcQ',
    duration: '2:30',
    durationLabel: '2 min 30 sec'
  }
};

/**
 * Show video modal with the specified video ID
 * @param {string} videoId - The ID of the video to display
 */
function showVideoModal(videoId) {
  const videoData = videoMap[videoId] || {
    title: 'Video Player',
    description: 'Watch the video',
    videoId: 'dQw4w9WgXcQ' // Default/placeholder
  };

  // Create modal HTML
  const modalHTML = `
    <div class="modal" id="video-modal">
      <div class="modal-overlay" onclick="closeVideoModal()"></div>
      <div class="modal-content glass-panel" style="max-width: 900px; padding: 2.5rem; position: relative;">
        <button class="modal-close" onclick="closeVideoModal()" aria-label="Close modal">
          <i class="fas fa-times"></i>
        </button>
        <div class="modal-header" style="margin-bottom: 1.5rem; padding-right: 2rem; display: flex; justify-content: space-between; align-items: flex-start;">
          <h2 style="margin: 0; color: #fff; font-size: 1.8rem; font-weight: 600; letter-spacing: 0.02em; display: flex; align-items: center;">
            <i class="fas fa-video" style="margin-right: 0.5rem; color: #5ae4ff;"></i>${videoData.title}
          </h2>
          ${videoData.duration ? `<span class="video-duration" style="background: rgba(0,0,0,0.3); color: #fff; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.85rem; font-weight: 500; display: inline-flex; align-items: center; gap: 0.25rem;">
            <i class="far fa-clock" style="font-size: 0.8em;"></i> ${videoData.duration}
          </span>` : ''}
        </div>
        <div class="video-container" style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);">
          <iframe 
            width="100%" 
            height="100%" 
            src="https://www.youtube.com/embed/${videoData.videoId}?autoplay=1" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen
            style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none;"
            title="${videoData.description}">
          </iframe>
        </div>
        <p style="margin-top: 1.5rem; color: #e0e0e0; font-size: 1.1rem; line-height: 1.6; letter-spacing: 0.02em;">
          <i class="fas fa-info-circle" style="color: #5ae4ff; margin-right: 0.5rem;"></i>
          ${videoData.description}
        </p>
      </div>
    </div>
  `;

  // Create a container for the modal if it doesn't exist
  let modalContainer = document.getElementById('video-modal-container');
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'video-modal-container';
    document.body.appendChild(modalContainer);
  }
  
  // Add modal to the page using insertAdjacentHTML to preserve existing content
  modalContainer.insertAdjacentHTML('beforeend', modalHTML);
  
  // Get the newly added modal
  const modal = document.getElementById('video-modal');
  
  // Add close handler to the close button
  const closeBtn = modal.querySelector('.modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeVideoModal);
  }
  
  // Add click handler to the overlay
  const overlay = modal.querySelector('.modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', closeVideoModal);
  }
  
  // Show the modal
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden'; // Prevent scrolling
  
  // Close on Escape key
  document.addEventListener('keydown', handleEscapeKey);
}

/**
 * Close the video modal
 */
function closeVideoModal() {
  const modal = document.getElementById('video-modal');
  if (modal) {
    // Add fade out animation
    modal.style.opacity = '0';
    modal.style.transition = 'opacity 0.2s ease-out';
    
    // Remove the modal after the animation completes
    setTimeout(() => {
      if (modal && modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
      document.body.style.overflow = ''; // Re-enable scrolling
      document.removeEventListener('keydown', handleEscapeKey);
    }, 200);
  }
}

/**
 * Handle Escape key press to close modal
 */
function handleEscapeKey(event) {
  if (event.key === 'Escape') {
    closeVideoModal();
  }
}

// Make functions available globally
window.showVideoModal = showVideoModal;
window.closeVideoModal = closeVideoModal;
