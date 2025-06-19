// Animate pipeline steps on scroll
document.addEventListener('DOMContentLoaded', function() {
  const steps = document.querySelectorAll('.pipeline-step');
  
  // Function to check if element is in viewport
  const isInViewport = (element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  };

  // Function to handle scroll events with debounce
  let isScrolling = false;
  const handleScroll = () => {
    if (isScrolling) return;
    isScrolling = true;
    
    // Use requestAnimationFrame for smoother performance
    requestAnimationFrame(() => {
      steps.forEach((step, index) => {
        if (isInViewport(step) && !step.classList.contains('visible')) {
          // Add delay based on index for staggered animation
          setTimeout(() => {
            step.classList.add('visible');
          }, index * 150);
        }
      });
      
      isScrolling = false;
    });
  };

  // Add scroll event listener
  window.addEventListener('scroll', handleScroll);
  
  // Initial check in case elements are already in view
  handleScroll();

  // Check for reduced motion preference
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    // Apply all animations immediately without delay
    steps.forEach(step => step.classList.add('visible'));
  }
});
