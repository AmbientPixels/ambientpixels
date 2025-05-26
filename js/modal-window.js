// File: /js/modal-window.js – Modal logic

function showModal() {
  const modal = document.getElementById("modal");
  if (modal) {
    modal.classList.remove("hidden");
    // Add active class for proper display
    modal.classList.add("active");
  }
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
  const modal = document.getElementById("modal");
  const closeButtons = document.querySelectorAll(".modal-close");
  const overlay = modal.querySelector(".modal-overlay");

  if (!modal || !overlay) return;

  // Close when clicking the close button
  closeButtons.forEach(button => {
    button.addEventListener("click", closeModal);
  });

  // Close when clicking the overlay
  overlay.addEventListener("click", closeModal);

  // Close when pressing Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // Close when submitting the form
  const form = modal.querySelector("#contact-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      closeModal();
    });
  }
});
