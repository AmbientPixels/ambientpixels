// TileForge Modal System
// Provides reusable modal functionality with multiple modal types

class ModalSystem {
  constructor() {
    this.activeModals = [];
    this.modalCounter = 0;
    this.init();
  }

  init() {
    // Create modal container if it doesn't exist
    if (!document.getElementById('modal-container')) {
      const container = document.createElement('div');
      container.id = 'modal-container';
      document.body.appendChild(container);
    }

    // Handle ESC key to close modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModals.length > 0) {
        this.closeTopModal();
      }
    });
  }

  // Create a basic modal
  createModal(options = {}) {
    const defaults = {
      id: `modal-${++this.modalCounter}`,
      title: 'Modal',
      content: '',
      size: 'medium', // small, medium, large, fullscreen
      type: 'default', // default, confirmation, alert-info, alert-warning, alert-error, alert-success
      closable: true,
      backdrop: true, // Close on backdrop click
      buttons: [],
      onShow: null,
      onHide: null,
      onConfirm: null,
      onCancel: null
    };

    const config = { ...defaults, ...options };
    
    // Create modal HTML
    const modalHTML = this.buildModalHTML(config);
    
    // Insert into container
    const container = document.getElementById('modal-container');
    container.insertAdjacentHTML('beforeend', modalHTML);
    
    // Get modal elements
    const overlay = document.getElementById(`${config.id}-overlay`);
    const modal = document.getElementById(config.id);
    const closeBtn = modal.querySelector('.modal-close');
    
    // Set up event listeners
    this.setupModalEvents(overlay, modal, closeBtn, config);
    
    return {
      id: config.id,
      show: () => this.showModal(config.id),
      hide: () => this.hideModal(config.id),
      destroy: () => this.destroyModal(config.id),
      updateContent: (content) => this.updateModalContent(config.id, content),
      updateTitle: (title) => this.updateModalTitle(config.id, title)
    };
  }

  buildModalHTML(config) {
    const sizeClass = config.size ? `${config.size}` : '';
    const typeClass = config.type !== 'default' ? `${config.type}` : '';
    const closeBtnHTML = config.closable ? `<button class="modal-close" type="button">✕</button>` : '';
    
    let buttonsHTML = '';
    if (config.buttons.length > 0) {
      buttonsHTML = `
        <div class="modal-footer">
          ${config.buttons.map(btn => `
            <button class="modal-btn ${btn.class || 'secondary'}" 
                    data-action="${btn.action || 'close'}"
                    ${btn.disabled ? 'disabled' : ''}>
              ${btn.text}
            </button>
          `).join('')}
        </div>
      `;
    }

    return `
      <div class="modal-overlay" id="${config.id}-overlay">
        <div class="modal ${sizeClass} ${typeClass}" id="${config.id}">
          <div class="modal-header">
            <h3 class="modal-title">${config.title}</h3>
            ${closeBtnHTML}
          </div>
          <div class="modal-body">
            ${config.content}
          </div>
          ${buttonsHTML}
        </div>
      </div>
    `;
  }

  setupModalEvents(overlay, modal, closeBtn, config) {
    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hideModal(config.id));
    }

    // Backdrop click
    if (config.backdrop) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.hideModal(config.id);
        }
      });
    }

    // Button actions
    const buttons = modal.querySelectorAll('.modal-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        
        switch (action) {
          case 'confirm':
            console.log('[Modal] Confirm button clicked for modal:', config.id);
            try {
              if (config.onConfirm) config.onConfirm();
            } catch (err) {
              console.error('[Modal] Error in onConfirm callback:', err);
            }
            console.log('[Modal] About to call hideModal for:', config.id);
            this.hideModal(config.id);
            console.log('[Modal] hideModal call returned for:', config.id);
            break;
          case 'cancel':
            if (config.onCancel) config.onCancel();
            this.hideModal(config.id);
            break;
          case 'close':
          default:
            this.hideModal(config.id);
            break;
        }
      });
    });
  }

  showModal(modalId) {
    const overlay = document.getElementById(`${modalId}-overlay`);
    if (overlay) {
      overlay.classList.add('active');
      this.activeModals.push(modalId);
      
      // Disable body scroll
      document.body.style.overflow = 'hidden';
      
      // Focus management
      const modal = document.getElementById(modalId);
      const focusableElements = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    }
  }

  hideModal(modalId) {
    const overlay = document.getElementById(`${modalId}-overlay`);
    console.log('[Modal] hideModal called for:', modalId, 'overlay:', overlay);
    if (overlay) {
      overlay.classList.remove('active');
      
      // Remove from active modals
      this.activeModals = this.activeModals.filter(id => id !== modalId);
      
      // Re-enable body scroll if no modals are active
      if (this.activeModals.length === 0) {
        document.body.style.overflow = '';
      }
      
      // Auto-destroy after animation
      setTimeout(() => {
        if (!overlay.classList.contains('active')) {
          console.log('[Modal] Destroying modal:', modalId);
          this.destroyModal(modalId);
        }
      }, 300);
    } else {
      console.warn('[Modal] hideModal: overlay not found for', modalId);
    }
  }

  destroyModal(modalId) {
    const overlay = document.getElementById(`${modalId}-overlay`);
    if (overlay) {
      overlay.remove();
    }
  }

  closeTopModal() {
    if (this.activeModals.length > 0) {
      const topModalId = this.activeModals[this.activeModals.length - 1];
      this.hideModal(topModalId);
    }
  }

  updateModalContent(modalId, content) {
    const modal = document.getElementById(modalId);
    if (modal) {
      const body = modal.querySelector('.modal-body');
      if (body) {
        body.innerHTML = content;
      }
    }
  }

  updateModalTitle(modalId, title) {
    const modal = document.getElementById(modalId);
    if (modal) {
      const titleElement = modal.querySelector('.modal-title');
      if (titleElement) {
        titleElement.textContent = title;
      }
    }
  }

  // Tabbed Modal System
  createTabbedModal(options = {}) {
    const defaults = {
      id: `modal-${++this.modalCounter}`,
      title: 'Tabbed Modal',
      size: 'large',
      closable: true,
      backdrop: true,
      tabs: [],
      activeTab: 0,
      onShow: null,
      onHide: null
    };

    const config = { ...defaults, ...options };
    
    // Build tabbed modal HTML
    const modalHTML = this.buildTabbedModalHTML(config);
    
    // Insert into container
    const container = document.getElementById('modal-container');
    container.insertAdjacentHTML('beforeend', modalHTML);
    
    // Get modal elements
    const overlay = document.getElementById(`${config.id}-overlay`);
    const modal = document.getElementById(config.id);
    const closeBtn = modal.querySelector('.modal-close');
    
    // Set up event listeners
    this.setupModalEvents(overlay, modal, closeBtn, config);
    this.setupTabEvents(modal, config);
    
    return {
      id: config.id,
      show: () => this.showModal(config.id),
      hide: () => this.hideModal(config.id),
      destroy: () => this.destroyModal(config.id),
      switchTab: (tabIndex) => this.switchTab(config.id, tabIndex),
      updateTabContent: (tabIndex, content) => this.updateTabContent(config.id, tabIndex, content)
    };
  }

  buildTabbedModalHTML(config) {
    const sizeClass = config.size ? `${config.size}` : '';
    const closeBtnHTML = config.closable ? `<button class="modal-close" type="button">✕</button>` : '';
    
    // Build tabs navigation
    const tabsHTML = config.tabs.map((tab, index) => 
      `<button class="modal-tab ${index === config.activeTab ? 'active' : ''}" 
              data-tab="${index}">
        ${tab.icon || ''} ${tab.title}
      </button>`
    ).join('');
    
    // Build tab content panels
    const contentHTML = config.tabs.map((tab, index) => 
      `<div class="modal-tab-content ${index === config.activeTab ? 'active' : ''}" 
           data-tab-content="${index}">
        ${tab.content}
      </div>`
    ).join('');

    return `
      <div class="modal-overlay" id="${config.id}-overlay">
        <div class="modal ${sizeClass} tabbed" id="${config.id}">
          <div class="modal-header">
            <h3 class="modal-title">${config.title}</h3>
            ${closeBtnHTML}
          </div>
          <div class="modal-tabs">
            ${tabsHTML}
          </div>
          <div class="modal-body">
            ${contentHTML}
          </div>
        </div>
      </div>
    `;
  }

  setupTabEvents(modal, config) {
    const tabs = modal.querySelectorAll('.modal-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabIndex = parseInt(tab.dataset.tab);
        this.switchTab(config.id, tabIndex);
      });
    });
  }

  switchTab(modalId, tabIndex) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    // Update tab buttons
    const tabs = modal.querySelectorAll('.modal-tab');
    tabs.forEach((tab, index) => {
      tab.classList.toggle('active', index === tabIndex);
    });

    // Update tab content
    const contents = modal.querySelectorAll('.modal-tab-content');
    contents.forEach((content, index) => {
      content.classList.toggle('active', index === tabIndex);
    });
  }

  updateTabContent(modalId, tabIndex, content) {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    const tabContent = modal.querySelector(`[data-tab-content="${tabIndex}"]`);
    if (tabContent) {
      tabContent.innerHTML = content;
    }
  }

  // Convenience methods for common modal types
  confirm(options = {}) {
    // Heuristic: if no explicit type is provided but confirmText indicates a Clear action,
    // default to the amber/yellow clear-confirmation variant. /* updated by Cascade */
    const hasExplicitType = !!options.type;
    const confirmLabel = (options.confirmText || '').toString();
    const looksLikeClear = /\bclear\b/i.test(confirmLabel);
    if (!hasExplicitType && looksLikeClear) {
      options.type = 'clear-confirmation';
    }

    const isDestructive = options.type === 'destructive';
    const isClear = options.type === 'clear-confirmation';
    // Choose defaults based on type
    const defaults = {
      // updated by Cascade: use plain titles (no emoji); icons are rendered in body
      title: isDestructive
        ? 'Confirm Destructive Action'
        : (isClear ? 'Confirm Clear' : 'Confirm Action'),
      content: 'Are you sure you want to proceed?',
      type: isDestructive ? 'destructive' : (options.type || 'confirmation'),
      size: 'small',
      buttons: [
        { text: options.cancelText || 'Cancel', class: 'secondary', action: 'cancel' },
        { text: options.confirmText || (isDestructive ? 'Delete' : (isClear ? 'Clear' : 'Confirm')), class: (options.buttons && options.buttons[1] && options.buttons[1].class) ? options.buttons[1].class : (isDestructive ? 'danger' : (isClear ? 'warning' : 'primary')), action: 'confirm' }
      ]
    };

    // If content is a plain string, prepend a Font Awesome icon for visual clarity
    let computedContent = options.content;
    if (typeof computedContent === 'string') {
      // Choose FA icon by type (fallback: question-circle)
      // updated by Cascade: Font Awesome icons instead of emoji
      const iconClass = isDestructive
        ? 'fas fa-trash-alt'
        : (isClear ? 'fas fa-exclamation-triangle' : 'fas fa-question-circle');
      // Only add icon markup if caller didn't already include one
      if (!/modal-icon/.test(computedContent)) {
        computedContent = `
          <div class="modal-icon"><i class="${iconClass}" aria-hidden="true"></i></div>
          <p class="modal-message">${computedContent}</p>
        `;
      }
    }

    // Compose final config, preserving provided callbacks and flags
    const finalConfig = {
      ...defaults,
      ...options,
      content: computedContent !== undefined ? computedContent : defaults.content
    };

    return this.createModal(finalConfig);
  }

  alert(message, type = 'info', title = null) {
    // updated by Cascade: use Font Awesome icons and plain titles (no emoji)
    const iconMap = {
      info: 'fas fa-info-circle',
      warning: 'fas fa-exclamation-triangle',
      error: 'fas fa-times-circle',
      success: 'fas fa-check-circle'
    };

    const titles = {
      info: 'Information',
      warning: 'Warning',
      error: 'Error',
      success: 'Success'
    };

    // Map alert types to button classes for consistent visual language
    const btnClass = type === 'success' ? 'success' : type === 'error' ? 'danger' : type === 'warning' ? 'warning' : 'primary';

    const iconClass = iconMap[type] || iconMap.info;
    const modal = this.createModal({
      title: title || `${titles[type]}`,
      content: `<div class="modal-icon"><i class="${iconClass}" aria-hidden="true"></i></div><p class="modal-message">${message}</p>`,
      type: `alert-${type}`,
      size: 'small',
      buttons: [
        { text: 'OK', class: btnClass, action: 'close' }
      ]
    });

    modal.show();
    return modal;
  }

  prompt(options = {}) {
    const defaults = {
      title: '📝 Input Required',
      message: 'Please enter a value:',
      placeholder: '',
      defaultValue: '',
      inputType: 'text',
      required: false
    };

    const config = { ...defaults, ...options };
    
    const content = `
      <p class="modal-message">${config.message}</p>
      <div class="modal-form-group">
        <input type="${config.inputType}" 
               class="modal-form-input" 
               id="modal-prompt-input"
               placeholder="${config.placeholder}"
               value="${config.defaultValue}"
               ${config.required ? 'required' : ''}>
      </div>
    `;

    return this.createModal({
      title: config.title,
      content: content,
      size: 'small',
      buttons: [
        { text: 'Cancel', class: 'secondary', action: 'cancel' },
        { text: 'OK', class: 'primary', action: 'confirm' }
      ],
      onConfirm: () => {
        const input = document.getElementById('modal-prompt-input');
        if (config.onConfirm && input) {
          config.onConfirm(input.value);
        }
      },
      onCancel: config.onCancel
    });
  }

  loading(message = 'Loading...') {
    const content = `
      <div style="text-align: center; padding: 20px;">
        <div style="font-size: 32px; margin-bottom: 16px;">⏳</div>
        <p>${message}</p>
      </div>
    `;

    return this.createModal({
      title: 'Please Wait',
      content: content,
      size: 'small',
      closable: false,
      backdrop: false
    });
  }
}

// Create global modal instance
const Modal = new ModalSystem();
// Ensure global access for modules that check window.Modal
if (typeof window !== 'undefined') {
  window.Modal = Modal; // updated by Cascade: expose Modal on window
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModalSystem;
}

// Provide a global showModal confirmation API for all modules
window.showModal = function(message, options = {}) {
  const modal = Modal.confirm({
    content: message,
    ...options
  });
  modal.show();
};
// updated by Cascade
