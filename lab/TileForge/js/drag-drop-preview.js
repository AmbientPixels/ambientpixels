// drag-drop-preview.js
// Handles drag-and-drop for image upload directly on the preview image container in TileForge

document.addEventListener('DOMContentLoaded', function () {
  const previewTile = document.getElementById('previewTile');
  const dndMessage = document.getElementById('dndImageMessage');

  if (!previewTile || !dndMessage) return;

  // Show drop message only if no image is loaded
  function showDropMessage(show) {
    dndMessage.style.display = show ? 'flex' : 'none';
  }

  // Setup drag events
  previewTile.addEventListener('dragover', (e) => {
    e.preventDefault();
    previewTile.classList.add('drag-over');
    showDropMessage(true);
  });
  previewTile.addEventListener('dragleave', (e) => {
    e.preventDefault();
    previewTile.classList.remove('drag-over');
    showDropMessage(false);
  });
  previewTile.addEventListener('drop', (e) => {
    e.preventDefault();
    previewTile.classList.remove('drag-over');
    showDropMessage(false);
    const files = e.dataTransfer.files;
    if (files && files.length) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        // Use existing image loader logic if available
        const imgInput = document.getElementById('imgInput');
        if (imgInput) {
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          imgInput.files = dataTransfer.files;
          imgInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        alert('Please drop a valid image file (PNG, JPG, GIF).');
      }
    }
  });

  // Only show drop message if no image loaded
  // (Assume previewTile has a background-image or child <img> when loaded)
  if (!previewTile.style.backgroundImage && !previewTile.querySelector('img')) {
    showDropMessage(false);
  }
});
