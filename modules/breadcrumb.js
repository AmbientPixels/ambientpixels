/**
 * Dynamic Breadcrumb Navigation
 * Automatically generates breadcrumb navigation based on the current URL path
 */

document.addEventListener('DOMContentLoaded', function() {
  const breadcrumbContainer = document.querySelector('.breadcrumb-container');
  if (!breadcrumbContainer) return;
  
  // Create and insert the breadcrumb HTML structure
  breadcrumbContainer.innerHTML = `
    <nav class="breadcrumb-nav" aria-label="Breadcrumb">
      <ol class="breadcrumb-list" id="breadcrumbList"></ol>
    </nav>
  `;
  
  const breadcrumbList = document.getElementById('breadcrumbList');
  if (!breadcrumbList) return;

  // Get current path and clean it up
  let path = window.location.pathname;
  const isIndex = path.endsWith('index.html') || path.endsWith('/');
  
  // Remove trailing slash and .html if present
  path = path.replace(/\/$/, '').replace(/\.html$/, '');
  
  // Skip breadcrumb on homepage
  if (path === '') return;
  
  // Split into segments and filter out empty ones
  const segments = path.split('/').filter(segment => segment && segment !== 'index.html');
  
  // Create Home link
  const homeItem = document.createElement('li');
  homeItem.className = 'breadcrumb-item';
  homeItem.innerHTML = `
    <a href="/" class="breadcrumb-link">
      <i class="fas fa-home" aria-hidden="true"></i>
      <span>Home</span>
    </a>`;
  breadcrumbList.appendChild(homeItem);
  
  // Build breadcrumb items
  let currentPath = '';
  
  segments.forEach((segment, index) => {
    // Add separator
    const separator = document.createElement('li');
    separator.className = 'breadcrumb-separator';
    separator.setAttribute('aria-hidden', 'true');
    breadcrumbList.appendChild(separator);
    
    // Build path for this segment
    currentPath += `/${segment}`;
    const isLast = index === segments.length - 1;
    
    // Format display text
    let displayText;
    
    // If this is the last segment and it's an index page, use the page title
    if (isLast && (segment === 'index' || segment === '')) {
      // Get the page title and clean it up
      const pageTitle = document.querySelector('h1')?.textContent || 
                      document.title.replace(/\s*\|.*$/, '').trim();
      displayText = pageTitle;
    } else {
      // Format segment (replace hyphens with spaces, capitalize words)
      displayText = segment
        .replace(/-/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      
      // Special case for 'video' to make it plural
      if (segment === 'video') {
        displayText = 'Videos';
      }
    }
    
    // Create list item
    const listItem = document.createElement('li');
    listItem.className = 'breadcrumb-item';
    
    if (isLast) {
      // Current page (not a link)
      const span = document.createElement('span');
      span.className = 'breadcrumb-current';
      span.setAttribute('aria-current', 'page');
      span.textContent = displayText;
      listItem.appendChild(span);
    } else {
      // Link to parent page
      const link = document.createElement('a');
      link.href = currentPath + '/';
      link.className = 'breadcrumb-link';
      link.textContent = displayText;
      listItem.appendChild(link);
    }
    
    breadcrumbList.appendChild(listItem);
  });
});
