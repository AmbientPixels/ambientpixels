// Refer to docs/logs/project-card-forge.md → 7/4/2025 – launch of V2 for details.
// CardForge Editor logic – MVP preview only
// Updated 2025-07-05: Now using shared validation utilities

(function(){
  const nameInput = document.getElementById('card-name');
  const classInput = document.getElementById('card-class');
  const quoteInput = document.getElementById('card-quote');
  const avatarInput = document.getElementById('card-avatar');
  // Card preview functionality for CardForge editor
  // Updated 2025-07-05: Added XSS protection with sanitization

  window.addEventListener('DOMContentLoaded', () => {
  const inputs = [
    document.getElementById('card-name'),
    document.getElementById('card-class'),
    document.getElementById('card-quote'),
    document.getElementById('card-avatar'),
    document.getElementById('card-achievement'),
    document.getElementById('card-rarity'),
    document.getElementById('card-bio'),
    document.getElementById('card-superpower'),
    document.getElementById('card-alignment'),
    document.getElementById('card-origin'),
    document.getElementById('card-faction'),
    document.getElementById('card-badge'),
    document.getElementById('card-stats'),
    document.getElementById('card-theme')
  ].filter(Boolean);

  // Live preview on input/change
  inputs.forEach(input => {
    input.addEventListener('input', updatePreview);
    input.addEventListener('change', updatePreview);
  });

  // Initial preview on load
  updatePreview();
  // Fallback: listen on form for any input/change to catch all fields
  const formEl = document.getElementById('card-editor-form');
  if (formEl) {
    formEl.addEventListener('input', updatePreview);
    formEl.addEventListener('change', updatePreview);
  }
  updatePreview();
});

  // We now use the shared ValidationUtils.sanitizeString method instead of a local sanitizeHtml function

  /**
   * Creates a DOM element with sanitized content
   * @param {string} tag - HTML tag name
   * @param {object} attributes - Element attributes
   * @param {string|HTMLElement|Array} children - Child content or elements
   * @returns {HTMLElement} - Created DOM element
   */
  function createElement(tag, attributes = {}, children = null) {
    const element = document.createElement(tag);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        element.setAttribute(key, value);
      }
    });
    
    // Add children
    if (children !== null) {
      if (typeof children === 'string') {
        element.textContent = children;
      } else if (children instanceof HTMLElement) {
        element.appendChild(children);
      } else if (Array.isArray(children)) {
        children.forEach(child => {
          if (child instanceof HTMLElement) {
            element.appendChild(child);
          } else if (child) {
            element.appendChild(document.createTextNode(String(child)));
          }
        });
      }
    }
    
    return element;
  }

  function updatePreview() {
    console.debug('updatePreview triggered', {
      name: nameInput?.value,
      class: classInput?.value,
      quote: quoteInput?.value,
      avatar: avatarInput?.value,
      achievement: document.getElementById('card-achievement')?.value,
      rarity: document.getElementById('card-rarity')?.value,
      bio: document.getElementById('card-bio')?.value,
      superpower: document.getElementById('card-superpower')?.value,
      alignment: document.getElementById('card-alignment')?.value,
      origin: document.getElementById('card-origin')?.value,
      faction: document.getElementById('card-faction')?.value,
      badge: document.getElementById('card-badge')?.value,
      stats: document.getElementById('card-stats')?.value,
      theme: document.getElementById('card-theme')?.value
    });
    // Gather fields
    const name = nameInput?.value || '';
    const cardClass = classInput?.value || '';
    const quote = quoteInput?.value || '';
    const avatar = avatarInput?.value || '';
    
    
    
    
    const achievement = document.getElementById('card-achievement').value;
    const rarity = document.getElementById('card-rarity').value;
    const bio = document.getElementById('card-bio').value;
    const superpower = document.getElementById('card-superpower').value;
    const alignment = document.getElementById('card-alignment').value;
    const origin = document.getElementById('card-origin').value;
    const faction = document.getElementById('card-faction').value;
    const badge = document.getElementById('card-badge').value;
    let statsObj = {};
    try { statsObj = JSON.parse(document.getElementById('card-stats').value || '{}'); } catch(e) { console.warn('Invalid stats JSON'); }

    // Front face
    const variant = document.getElementById('card-template-type')?.value || 'default';
    const theme = document.getElementById('card-theme')?.value || '';
    const front = document.getElementById('card-preview');
    // Apply theme class
    if (front) front.className = `card-preview-canvas card-front theme-${theme.toLowerCase()} variant-${variant}`;
    if (front) {
      front.innerHTML = '';
      const previewContent = createElement('div', { class: 'card-preview-content' });
      // Avatar & name
      const header = createElement('div', { class: 'card-header' });
      if (avatar && ValidationUtils.isValidImageUrl(avatar)) {
        header.appendChild(createElement('img', { src: avatar, class: 'card-avatar', alt: name }));
      }
      header.appendChild(createElement('h3', {}, name || 'Card Name'));
      previewContent.appendChild(header);
      // Class & rarity
      if (cardClass) previewContent.appendChild(createElement('div', { class: 'card-badge' }, cardClass));
      if (rarity) previewContent.appendChild(createElement('div', { class: 'card-rarity' }, rarity));
      // Quote
      if (quote) previewContent.appendChild(createElement('blockquote', { class: 'card-quote' }, quote));
      // Achievement
      if (achievement) previewContent.appendChild(createElement('div', { class: 'card-achievement' }, achievement));
      // Stat bars
      Object.entries(statsObj).forEach(([key, val]) => {
        const barContainer = createElement('div', { class: 'stat-bar' });
        barContainer.appendChild(createElement('span', { class: 'stat-label' }, key));
        const progress = createElement('div', { class: 'stat-progress' });
        progress.style.width = val + '%';
        barContainer.appendChild(progress);
        previewContent.appendChild(barContainer);
      });
      front.appendChild(previewContent);
    }
    // Back face
    const back = document.getElementById('card-back');
    // Apply theme and variant classes to back face
    if (back) back.className = `card-preview-canvas card-back theme-${theme.toLowerCase()} variant-${variant}`;
    if (back) {
      back.innerHTML = '';
      const backContent = createElement('div', { class: 'card-back-content' });
      if (bio) backContent.appendChild(createElement('p', {}, bio));
      if (superpower) backContent.appendChild(createElement('p', {}, 'Superpower: ' + superpower));
      if (alignment) backContent.appendChild(createElement('p', {}, 'Alignment: ' + alignment));
      if (origin) backContent.appendChild(createElement('p', {}, 'Origin: ' + origin));
      if (faction) backContent.appendChild(createElement('p', {}, 'Faction: ' + faction));
      if (badge) backContent.appendChild(createElement('p', {}, 'Badge: ' + badge));
      back.appendChild(backContent);
    }
  }
  // Flip card view handler
  const flipBtn = document.getElementById('flip-btn');
  const cardInner = document.querySelector('.card-inner');
  if (flipBtn && cardInner) {
    flipBtn.addEventListener('click', () => {
      cardInner.classList.toggle('flipped');
    });
  }
})();
