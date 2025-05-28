// File: /js/modal-window.js – Modal logic

function showModal(modalId = "modal") {
  // Try to find the modal
  let modal = document.getElementById(modalId);
  
  // If modal doesn't exist yet (might be loading asynchronously)
  if (!modal) {
    // Check if it's in the modal container
    const container = document.getElementById("modal-container") || document.getElementById(modalId + "-container");
    if (container && container.querySelector(`#${modalId}, .modal`)) {
      modal = container.querySelector(`#${modalId}`) || container.querySelector(".modal");
      // Fix the ID to match what we expect if needed
      if (modalId === "modal" && modal.id !== "modal") {
        modal.id = "modal";
      }
    } else {
      // Modal might still be loading, try again in a moment
      console.log(`Modal ${modalId} not found, trying again in 100ms...`);
      setTimeout(() => showModal(modalId), 100);
      return;
    }
  }
  
  // Show the modal
  modal.classList.remove("hidden");
  modal.classList.add("active");
}

function closeModal(modalId = "modal") {
  // Try to find the specified modal or the default one
  const modal = document.getElementById(modalId) || document.getElementById("modal");
  
  if (modal) {
    // Remove active class first
    modal.classList.remove("active");
    // Add hidden class after a short delay for smooth transition
    setTimeout(() => {
      modal.classList.add("hidden");
    }, 300);
  }
}

// Add event listeners for closing the modal
document.addEventListener("DOMContentLoaded", () => {
  // We'll set up the event listeners once the modal is in the DOM
  // This may happen after DOMContentLoaded if it's injected dynamically
  setupModalListeners();
  
  // For dynamically loaded modals, we need to check again after a short delay
  setTimeout(setupModalListeners, 500);
  
  // And check again after a longer delay for any modals loaded by scripts
  setTimeout(setupModalListeners, 1500);
});

function setupModalListeners() {
  // Find all modals in the document
  const modals = document.querySelectorAll(".modal");
  
  modals.forEach(modal => {
    const modalId = modal.id;
    if (!modalId) return; // Skip modals without IDs
    
    const closeButtons = modal.querySelectorAll(".modal-close");
    const overlay = modal.querySelector(".modal-backdrop, .modal-overlay");
    
    // Close when clicking the close button
    closeButtons.forEach(button => {
      button.onclick = function() {
        closeModal(modalId);
      };
    });
    
    // Close when clicking the overlay/backdrop if it exists
    if (overlay) {
      overlay.onclick = function() {
        closeModal(modalId);
      };
    }
  });
  
  // Close when pressing Escape (only add once)
  if (!window.escapeListenerAdded) {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        // Close all visible modals
        document.querySelectorAll(".modal:not(.hidden)").forEach(modal => {
          if (modal.id) closeModal(modal.id);
        });
      }
    });
    window.escapeListenerAdded = true;
  }
}
