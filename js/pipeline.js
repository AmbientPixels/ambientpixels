/**
 * AI Pipeline Interactive Component
 * Handles the interactive elements of the AI Pipeline section
 */

console.log('pipeline.js script loaded');

document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM fully loaded, initializing pipeline...');
  
  // Check if pipeline section exists on the page
  const pipelineSection = document.querySelector('.ai-pipeline-section');
  console.log('Pipeline section found:', !!pipelineSection);
  
  if (!pipelineSection) {
    console.warn('No .ai-pipeline-section found on this page');
    return;
  }

  // Initialize the pipeline
  try {
    initPipeline();
    console.log('Pipeline initialization complete');
  } catch (error) {
    console.error('Error initializing pipeline:', error);
  }
});

function initPipeline() {
  console.log('Initializing pipeline...');
  
  const track = document.querySelector('.pipeline-track');
  const stages = document.querySelectorAll('.pipeline-stage');
  const prevBtn = document.getElementById('pipeline-prev');
  const nextBtn = document.getElementById('pipeline-next');
  const progressBar = document.querySelector('.progress-bar');
  let stageIndicators = []; // Will be populated after creating indicators
  const statusElement = document.getElementById('pipeline-status');
  
  console.log('Elements found:', {
    track,
    stages: stages.length,
    prevBtn,
    nextBtn,
    progressBar,
    stageIndicators: stageIndicators.length,
    statusElement
  });
  
  let currentStage = 0;
  const totalStages = stages.length;
  const stageElement = stages[0];
  const stageStyle = window.getComputedStyle(stageElement);
  const stageMargin = parseInt(stageStyle.marginLeft) + parseInt(stageStyle.marginRight);
  const stageWidth = stageElement.offsetWidth + stageMargin;
  const maxScroll = (totalStages - 1) * stageWidth;
  
  // Calculate dynamic scroll behavior
  const viewportWidth = window.innerWidth;
  const isMobile = viewportWidth <= 768;
  const scrollPeek = isMobile ? viewportWidth * 0.1 : viewportWidth * 0.15; // 10-15% of viewport for peeking
  const scrollCenterOffset = (viewportWidth - stageWidth) / 2; // Center the stage
  
  console.log('Stage dimensions:', { stageWidth, maxScroll });
  
  // Create stage indicators
  const indicatorsContainer = document.getElementById('stage-indicators');
  if (indicatorsContainer) {
    indicatorsContainer.innerHTML = ''; // Clear any existing indicators
    for (let i = 0; i < totalStages; i++) {
      const indicator = document.createElement('div');
      indicator.className = 'stage-indicator';
      indicator.setAttribute('data-stage', i);
      indicator.setAttribute('aria-label', `Go to stage ${i + 1}`);
      indicator.setAttribute('role', 'button');
      indicator.setAttribute('tabindex', '0');
      indicatorsContainer.appendChild(indicator);
    }
  }
  
  // Get references to the newly created indicators
  stageIndicators = document.querySelectorAll('.stage-indicator');
  
  // Set initial active state
  updateActiveStage(0);
  
  // Navigation buttons event listeners
  if (prevBtn && nextBtn) {
    console.log('Adding event listeners to navigation buttons');
    
    prevBtn.addEventListener('click', (e) => {
      console.log('Previous button clicked');
      e.preventDefault();
      navigate(-1);
    });
    
    nextBtn.addEventListener('click', (e) => {
      console.log('Next button clicked');
      e.preventDefault();
      navigate(1);
    });
    
    // Disable prev button initially
    prevBtn.disabled = true;
  } else {
    console.error('Navigation buttons not found:', { prevBtn, nextBtn });
  }
  
  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') {
      navigate(-1);
    } else if (e.key === 'ArrowRight') {
      navigate(1);
    }
  });
  
  // Stage indicators click events
  stageIndicators.forEach((indicator, index) => {
    indicator.addEventListener('click', () => {
      goToStage(index);
    });
  });
  
  // Stage click events for mobile tap
  stages.forEach((stage, index) => {
    stage.addEventListener('click', () => {
      // On mobile, clicking a stage centers it
      if (window.innerWidth <= 768) {
        goToStage(index);
      }
    });
  });
  
  // Handle swipe events for touch devices
  let touchStartX = 0;
  let touchEndX = 0;
  
  track.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });
  
  track.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }, { passive: true });
  
  // Handle window resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Recalculate stage width and adjust scroll position
      const newStageWidth = stages[0].offsetWidth + 24;
      const newScrollPosition = currentStage * newStageWidth;
      track.style.transform = `translateX(-${newScrollPosition}px)`;
    }, 250);
  });
  
  // Navigation functions
  function navigate(direction) {
    console.log('Navigating:', { direction, currentStage, totalStages });
    const newStage = currentStage + direction;
    if (newStage >= 0 && newStage < totalStages) {
      console.log('Going to stage:', newStage);
      goToStage(newStage);
    } else {
      console.log('Navigation out of bounds:', newStage);
    }
  }
  
  function goToStage(stageIndex) {
    // Don't do anything if already on this stage
    if (stageIndex === currentStage) {
      console.log('Already on stage:', stageIndex);
      return;
    }
    
    const direction = stageIndex > currentStage ? 1 : -1;
    console.log(`Going to stage: ${stageIndex} (${direction > 0 ? 'next' : 'previous'})`);
    
    // Update current stage
    currentStage = stageIndex;
    
    // Calculate base scroll position
    let scrollPosition = stageIndex * stageWidth;
    
    // Adjust scroll behavior based on position in pipeline
    if (stageIndex === 0) {
      // First stage - align to start
      scrollPosition = 0;
    } else if (stageIndex === totalStages - 1) {
      // Last stage - align to end
      scrollPosition = maxScroll;
    } else if (direction > 0) {
      // Moving right - show a bit of the next stage
      scrollPosition = Math.max(0, scrollPosition - scrollPeek);
    } else {
      // Moving left - center the stage
      scrollPosition = Math.max(0, scrollPosition - scrollCenterOffset);
    }
    
    // Ensure we don't scroll past the last stage
    const maxPosition = Math.max(0, (totalStages * stageWidth) - viewportWidth);
    scrollPosition = Math.min(scrollPosition, maxPosition);
    
    console.log('Scrolling to position:', scrollPosition, 'of max', maxPosition);
    
    // Animate to the new position with smooth easing
    track.style.transition = 'transform 0.5s cubic-bezier(0.25, 0.8, 0.25, 1)';
    track.style.transform = `translateX(-${scrollPosition}px)`;
    
    console.log('Transform applied:', track.style.transform);
    
    // Update active states and progress
    updateActiveStage(stageIndex);
    
    // Update URL hash
    history.pushState(null, null, `#stage-${stageIndex + 1}`);
  }
  
  function updateActiveStage(stageIndex) {
    // Update active class on stages
    stages.forEach((stage, index) => {
      if (index === stageIndex) {
        stage.classList.add('active');
        // Add animation class for active state
        stage.classList.add('pulse-once');
        // Remove animation class after it completes
        setTimeout(() => {
          stage.classList.remove('pulse-once');
        }, 500);
      } else {
        stage.classList.remove('active');
      }
    });
    
    // Update progress bar
    const progress = ((stageIndex + 1) / totalStages) * 100;
    progressBar.style.width = `${progress}%`;
    
    // Update stage indicators
    stageIndicators.forEach((indicator, index) => {
      if (index <= stageIndex) {
        indicator.classList.add('active');
      } else {
        indicator.classList.remove('active');
      }
    });
    
    // Update navigation buttons
    if (prevBtn && nextBtn) {
      prevBtn.disabled = stageIndex === 0;
      nextBtn.disabled = stageIndex === totalStages - 1;
    }
    
    // Update status text
    if (statusElement) {
      statusElement.textContent = `Stage ${stageIndex + 1} of ${totalStages}`;
    }
  }
  
  function handleSwipe() {
    const swipeThreshold = 50; // Minimum distance for a swipe
    const swipeDistance = touchEndX - touchStartX;
    
    if (Math.abs(swipeDistance) > swipeThreshold) {
      if (swipeDistance > 0 && currentStage > 0) {
        // Swipe right - go to previous stage
        navigate(-1);
      } else if (swipeDistance < 0 && currentStage < totalStages - 1) {
        // Swipe left - go to next stage
        navigate(1);
      }
    }
  }
  
  // Check URL hash on load
  function checkInitialStage() {
    const hash = window.location.hash;
    if (hash) {
      const match = hash.match(/stage-(\d+)/);
      if (match) {
        const stageNum = parseInt(match[1], 10) - 1;
        if (stageNum >= 0 && stageNum < totalStages) {
          goToStage(stageNum);
        }
      }
    }
  }
  
  // Initialize
  checkInitialStage();
  
  // Add animation class after a short delay to trigger the entrance animation
  setTimeout(() => {
    track.style.opacity = '1';
  }, 100);
}
