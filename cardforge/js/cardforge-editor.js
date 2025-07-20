(function(){
  // Only show confirmation modal on manual preview click
  document.addEventListener('DOMContentLoaded', () => {
    const previewBtn = document.getElementById('preview-btn');
    if (previewBtn) {
      previewBtn.addEventListener('click', e => {
        if (e.isTrusted) {
          // manual click: show confirmation modal
          showConfirmDialog(
            'Preview Card',
            'Do you want to preview this card?',
            updatePreview
          );
        } else {
          // programmatic click: bypass modal
          updatePreview();
        }
      });
    }
  });

  // Expose updatePreview globally for programmatic preview updates
  if (typeof window !== 'undefined') {
    window.updatePreview = updatePreview;
  }
})();
