document.addEventListener('DOMContentLoaded', function() {
  const handle = document.getElementById('transformation-handle');
  const before = document.querySelector('.transformation-before');
  let isDragging = false;
  
  // Prevent default drag behavior on handle
  handle.addEventListener('dragstart', (e) => e.preventDefault());
  
  // Handle mouse events
  handle.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', stopDrag);
  
  // Handle touch events
  handle.addEventListener('touchstart', startDrag);
  document.addEventListener('touchmove', drag, { passive: false });
  document.addEventListener('touchend', stopDrag);
  
  function startDrag(e) {
    isDragging = true;
    document.body.style.cursor = 'ew-resize';
    e.preventDefault();
    e.stopPropagation();
  }
  
  function stopDrag() {
    isDragging = false;
    document.body.style.cursor = '';
  }
  
  function drag(e) {
    if (!isDragging) return;
    
    // Prevent default to avoid page scroll on touch devices
    e.preventDefault();
    e.stopPropagation();
    
    // Get x position (handle both mouse and touch events)
    let x = e.clientX || (e.touches && e.touches[0].clientX);
    if (x === undefined) return;
    
    // Calculate position relative to container
    const container = before.parentElement.getBoundingClientRect();
    let pos = ((x - container.left) / container.width) * 100;
    
    // Limit position between 5% and 95%
    pos = Math.max(5, Math.min(95, pos));
    
    // Update width
    before.style.width = `${pos}%`;
    
    // Prevent text selection while dragging
    window.getSelection().removeAllRanges();
  }
  
  // Prevent image drag
  const images = document.querySelectorAll('.transformation-viewer img');
  images.forEach(img => {
    img.addEventListener('dragstart', (e) => e.preventDefault());
  });
});
