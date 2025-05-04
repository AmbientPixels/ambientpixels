document.addEventListener('DOMContentLoaded', () => {
    const layoutNav = document.querySelector('.layout-nav');
    const navLinks = document.querySelectorAll('.layout-nav a[href^="#"]');
    const sections = Array.from(document.querySelectorAll('section[id]'));
  
    // Inject toggle button (used only on mobile via media query)
    if (layoutNav) {
      const toggleButton = document.createElement('button');
      toggleButton.className = 'layout-nav-toggle';
      toggleButton.setAttribute('aria-expanded', 'false');
      toggleButton.setAttribute('aria-label', 'Toggle Navigation');
      toggleButton.innerHTML = '<i class="fas fa-bars"></i>';
      layoutNav.prepend(toggleButton);
  
      toggleButton.addEventListener('click', () => {
        layoutNav.classList.toggle('open');
        const isOpen = layoutNav.classList.contains('open');
        toggleButton.setAttribute('aria-expanded', isOpen);
        toggleButton.innerHTML = isOpen
          ? '<i class="fas fa-times"></i>'
          : '<i class="fas fa-bars"></i>';
      });
    }
  
    // Smooth scroll on nav link click
    navLinks.forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        const targetId = link.getAttribute('href').substring(1);
        const target = document.getElementById(targetId);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth' });
        }
  
        // Close mobile menu after click
        layoutNav?.classList.remove('open');
        const toggle = layoutNav?.querySelector('.layout-nav-toggle');
        if (toggle) {
          toggle.setAttribute('aria-expanded', 'false');
          toggle.innerHTML = '<i class="fas fa-bars"></i>';
        }
      });
    });
  
    // ScrollSpy behavior
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const link = document.querySelector(`.layout-nav a[href="#${entry.target.id}"]`);
        if (entry.isIntersecting) {
          document.querySelectorAll('.layout-nav a').forEach(l => l.classList.remove('active'));
          if (link) link.classList.add('active');
        }
      });
    }, {
      rootMargin: '-30% 0px -60% 0px',
      threshold: 0.1
    });
  
    sections.forEach(section => {
      observer.observe(section);
    });
  });
  