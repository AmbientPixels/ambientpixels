// File: /js/modal-window.js – Modal logic

function showModal() {
  const modal = document.getElementById("modal");
  if (modal) modal.classList.remove("hidden");
}

function closeModal() {
  const modal = document.getElementById("modal");
  if (modal) modal.classList.add("hidden");
}

// Optional: close modal when clicking outside or pressing Esc
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("modal");
  if (!modal) return;

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
});
