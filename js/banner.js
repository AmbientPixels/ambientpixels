// File: /js/banner.js – Modular Nova-Themed Banner System

function showBanner(message, type = 'info', duration = 6000) {
  const container = document.getElementById('banner-container');
  if (!container) return;

  let existing = container.querySelector('.banner');
  if (!existing) {
    existing = document.createElement('div');
    existing.className = `banner ${type}`;
    existing.innerHTML = `
      <span class="banner-icon">${getBannerIcon(type)}</span>
      <span class="banner-message">${message}</span>
      <button class="banner-close" aria-label="Close Banner">×</button>
    `;
    container.appendChild(existing);
  } else {
    existing.className = `banner ${type}`;
    existing.querySelector('.banner-icon').textContent = getBannerIcon(type);
    existing.querySelector('.banner-message').textContent = message;
  }

  requestAnimationFrame(() => {
    existing.classList.remove('hidden');
    existing.classList.add('show');
  });

  const closeBtn = existing.querySelector('.banner-close');
  closeBtn.onclick = () => hideBanner(existing);

  setTimeout(() => hideBanner(existing), duration);
}

function hideBanner(el) {
  if (!el) return;
  el.classList.remove('show');
  el.classList.add('hidden');
}

function getBannerIcon(type) {
  return {
    info: 'ℹ️',
    warn: '⚠️',
    critical: '❌'
  }[type] || 'ℹ️';
}

document.addEventListener('DOMContentLoaded', () => {
  // Init close button on page load
  const closeBtn = document.querySelector('.banner-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const banner = closeBtn.closest('.banner');
      if (banner) hideBanner(banner);
    });
  }

  // ✅ Show an initial banner when page loads
  showBanner("Nova system status: Synced and fully operational.", "info", 8000);
});
