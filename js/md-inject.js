// File: /js/md-inject.js – Ambient Pixels Markdown Injector

function injectMarkdown(targetId, mdPath, options = {}) {
  const target = document.getElementById(targetId);
  if (!target) return;

  const {
    loadingMessage = "Loading log...",
    errorMessage = "Error loading markdown file."
  } = options;

  target.innerHTML = `<p>${loadingMessage}</p>`;

  fetch(mdPath)
    .then(res => res.text())
    .then(md => {
      target.innerHTML = marked.parse(md);
    })
    .catch(err => {
      target.innerHTML = `<p>${errorMessage}</p>`;
      console.error(`[md-inject] Failed to load ${mdPath}`, err);
    });
}
