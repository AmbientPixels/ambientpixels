document.addEventListener('DOMContentLoaded', () => {
  const explainerContainer = document.getElementById('form-explainer-container');
  if (!explainerContainer) {
    return;
  }

  // State variables
  let overlayData = {};
  let sequence = [];
  let currentStep = -1;
  let tourTimer = null;
  let isTourActive = false;
  let userHasInteracted = false;

  // DOM element references
  const imageContainer = explainerContainer.querySelector('.form-highlight-container');
  const image = explainerContainer.querySelector('.form-highlight-img');
  const whisperPanel = explainerContainer.querySelector('.nova-whisper-panel');
  const timelineScrubber = explainerContainer.querySelector('.timeline-scrubber');
  const replayButton = explainerContainer.querySelector('.replay-tour');
  const ghostOverlay = explainerContainer.querySelector('.ghost-overlay');
  let tooltip = null;

  // --- Main Setup Function ---
  function setupExplainer() {
    createOverlays();
    createTimelineDots();
    setupEventListeners();

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !userHasInteracted) {
        startTour(true); // Start tour automatically only if user hasn't interacted
        observer.disconnect();
      }
    }, { threshold: 0.5 });

    observer.observe(explainerContainer);
  }

  // --- Core Functions ---
  async function initialize() {
    await fetchData();
    if (Object.keys(overlayData).length === 0) {
        console.error("Form explainer data not found or is empty.");
        return;
    }

    // Critical: Wait for the image to be fully loaded before setting up.
    if (image.complete) {
      setupExplainer();
    } else {
      image.addEventListener('load', setupExplainer, { once: true });
    }
  }

  async function fetchData() {
    try {
      const response = await fetch('/data/form-explainer-map.json');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const dataArray = await response.json();
      
      // Transform array into the expected object structure and create the 'coords' property
      overlayData = dataArray.reduce((acc, item) => {
        acc[item.key] = {
          tooltip: item.tooltip,
          coords: [item.left, item.top, item.width, item.height]
        };
        return acc;
      }, {});

      sequence = dataArray.map(item => item.key);
    } catch (error) {
      console.error('Error loading form explainer data:', error);
      overlayData = {};
      sequence = [];
    }
  }

  function createOverlays() {
    imageContainer.querySelectorAll('.form-overlay').forEach(o => o.remove());
    sequence.forEach(key => {
      const overlay = document.createElement('div');
      overlay.className = 'form-overlay';
      overlay.dataset.key = key;
      imageContainer.appendChild(overlay);
    });
    positionOverlays();
  }

  function positionOverlays() {
    // This function now runs only after the image is loaded.
    imageContainer.querySelectorAll('.form-overlay').forEach(overlay => {
      const key = overlay.dataset.key;
      const data = overlayData[key];
      if (data) {
        overlay.style.left = `${data.coords[0] * 100}%`;
        overlay.style.top = `${data.coords[1] * 100}%`;
        overlay.style.width = `${data.coords[2] * 100}%`;
        overlay.style.height = `${data.coords[3] * 100}%`;
      }
    });
  }

  function createTimelineDots() {
    timelineScrubber.innerHTML = '';
    sequence.forEach((_, index) => {
      const dot = document.createElement('div');
      dot.className = 'timeline-dot';
      dot.dataset.index = index;
      timelineScrubber.appendChild(dot);
    });
  }

  // --- UI Update Functions ---
  function updateUIForStep(stepIndex) {
    currentStep = stepIndex;
    imageContainer.querySelectorAll('.form-overlay').forEach(o => o.classList.remove('active'));
    if (stepIndex > -1) {
      const activeOverlay = imageContainer.querySelector(`.form-overlay[data-key='${sequence[stepIndex]}']`);
      if (activeOverlay) {
        activeOverlay.classList.add('active');
        updateGhostOverlay(activeOverlay);
      }
    }
    timelineScrubber.querySelectorAll('.timeline-dot').forEach((dot, index) => {
      dot.classList.toggle('active', index === stepIndex);
    });
    if (stepIndex > -1) {
      whisperPanel.textContent = overlayData[sequence[stepIndex]].tooltip.split('\n')[0];
      whisperPanel.classList.add('active');
    } else {
      whisperPanel.classList.remove('active');
    }
  }

  function updateGhostOverlay(targetOverlay) {
    if (!targetOverlay) {
      ghostOverlay.classList.remove('pulsing');
      return;
    }
    ghostOverlay.style.left = targetOverlay.style.left;
    ghostOverlay.style.top = targetOverlay.style.top;
    ghostOverlay.style.width = targetOverlay.style.width;
    ghostOverlay.style.height = targetOverlay.style.height;
    ghostOverlay.classList.add('pulsing');
  }

  // --- Tour/Sequence Logic ---
  function startTour(isAutoStart = false) {
    clearTimeout(tourTimer);
    userHasInteracted = !isAutoStart;
    isTourActive = true;
    replayButton.classList.remove('active');
    currentStep = -1;
    advanceTour();
  }

  function advanceTour() {
    if (!isTourActive) return;
    currentStep++;
    if (currentStep >= sequence.length) {
      endTour();
      return;
    }
    updateUIForStep(currentStep);
    tourTimer = setTimeout(advanceTour, 2500);
  }

  function endTour() {
    isTourActive = false;
    clearTimeout(tourTimer);
    updateUIForStep(-1);
    updateGhostOverlay(null);
    replayButton.classList.add('active');
  }

  function stopTour() {
    isTourActive = false;
    userHasInteracted = true;
    clearTimeout(tourTimer);
    replayButton.classList.add('active');
  }

  // --- Tooltip Logic ---
  function createTooltip() {
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'tooltip-box';
      document.body.appendChild(tooltip);
    }
  }

  function showTooltip(overlay) {
    createTooltip();
    const key = overlay.dataset.key;
    tooltip.innerHTML = overlayData[key].tooltip.replace(/\n/g, '<br>');
    const targetRect = overlay.getBoundingClientRect();
    const bodyRect = document.body.getBoundingClientRect();
    tooltip.style.left = `${targetRect.left - bodyRect.left}px`;
    tooltip.style.top = `${targetRect.top - bodyRect.top - tooltip.offsetHeight - 10}px`;
    tooltip.classList.add('active');
  }

  function hideTooltip() {
    if (tooltip) {
      tooltip.classList.remove('active');
    }
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    window.addEventListener('resize', positionOverlays);
    replayButton.addEventListener('click', () => startTour());

    imageContainer.addEventListener('mouseover', (e) => {
      if (e.target.classList.contains('form-overlay')) {
        if (isTourActive) stopTour();
        const index = sequence.indexOf(e.target.dataset.key);
        updateUIForStep(index);
        showTooltip(e.target);
      }
    });

    imageContainer.addEventListener('mouseout', (e) => {
      if (e.target.classList.contains('form-overlay')) {
        if (userHasInteracted) {
          updateUIForStep(-1);
          updateGhostOverlay(null);
          hideTooltip();
        }
      }
    });

    imageContainer.addEventListener('click', (e) => {
      if (e.target.classList.contains('form-overlay')) {
        if (isTourActive) stopTour();
        userHasInteracted = true;
        const index = sequence.indexOf(e.target.dataset.key);
        updateUIForStep(index);
      }
    });

    timelineScrubber.addEventListener('click', (e) => {
      if (e.target.classList.contains('timeline-dot')) {
        if (isTourActive) stopTour();
        userHasInteracted = true;
        const index = parseInt(e.target.dataset.index, 10);
        updateUIForStep(index);
      }
    });
  }

  // --- Initialize ---
  initialize();
});
