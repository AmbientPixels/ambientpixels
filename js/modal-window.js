// File: /js/modal-window.js – Modal logic

function showModal() {
  // Try to find the modal
  let modal = document.getElementById("modal");
  
  // If modal doesn't exist yet (might be loading asynchronously)
  if (!modal) {
    // Check if it's in the modal container
    const container = document.getElementById("modal-container");
    if (container && container.querySelector(".modal")) {
      modal = container.querySelector(".modal");
      // Fix the ID to match what we expect
      modal.id = "modal";
    } else {
      // Modal might still be loading, try again in a moment
      console.log("Modal not found, trying again in 100ms...");
      setTimeout(showModal, 100);
      return;
    }
  }
  
  // Show the modal
  modal.classList.remove("hidden");
  modal.classList.add("active");
}

function closeModal() {
  const modal = document.getElementById("modal");
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
});

function setupModalListeners() {
  const modal = document.getElementById("modal") || document.querySelector(".modal");
  if (!modal) return; // Modal not found, might be loaded later
  
  const closeButtons = document.querySelectorAll(".modal-close");
  const overlay = modal.querySelector(".modal-overlay") || modal.querySelector(".modal-backdrop");

  if (!overlay) return; // Overlay not found

  // Close when clicking the close button
  closeButtons.forEach(button => {
    // Remove existing listeners to prevent duplicates
    button.removeEventListener("click", closeModal);
    // Add new listener
    button.addEventListener("click", closeModal);
  });

  // Close when clicking the overlay
  overlay.removeEventListener("click", closeModal);
  overlay.addEventListener("click", closeModal);

  // Close when pressing Escape (only add once)
  if (!window.escapeListenerAdded) {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
    window.escapeListenerAdded = true;
  }

  // Close when submitting the form
  const form = modal.querySelector("#contact-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      closeModal();
    });
  }
}
