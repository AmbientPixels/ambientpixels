// locale-picker-ui.js
// UI logic for the locale picker modal in TileForge

window.TileForgeLocalesUI = (function() {
  let selectedLocales = [];
  let onApplyCallback = null;

  function open(callback, preselect) {
    selectedLocales = preselect && Array.isArray(preselect) ? [...preselect] : [];
    onApplyCallback = typeof callback === 'function' ? callback : null;
    renderList();
    document.getElementById('localePickerModal').classList.add('active');
    document.getElementById('localeSearchInput').value = '';
    document.getElementById('localeSearchInput').oninput = filterList;
  }

  function close() {
    document.getElementById('localePickerModal').classList.remove('active');
    onApplyCallback = null;
  }

  function renderList() {
    const all = window.TileForgeLocales.getAllLocales();
    const map = window.TileForgeLocales.LOCALE_MAP;
    const localeList = document.getElementById('localeList');
    localeList.innerHTML = all.map(loc => {
      const info = map[loc];
      const checked = selectedLocales.includes(loc) ? 'checked' : '';
      return `<label style="display:block;margin-bottom:5px;cursor:pointer;">
        <input type="checkbox" value="${loc}" ${checked} onchange="TileForgeLocalesUI.toggleLocale(this.value, this.checked)">
        <span>${loc} - ${info.language} (${info.country})</span>
      </label>`;
    }).join('');
  }

  function filterList() {
    const q = document.getElementById('localeSearchInput').value.trim().toLowerCase();
    const all = window.TileForgeLocales.getAllLocales();
    const map = window.TileForgeLocales.LOCALE_MAP;
    const localeList = document.getElementById('localeList');
    localeList.innerHTML = all.filter(loc => {
      const info = map[loc];
      return loc.toLowerCase().includes(q) ||
        (info.language && info.language.toLowerCase().includes(q)) ||
        (info.country && info.country.toLowerCase().includes(q));
    }).map(loc => {
      const info = map[loc];
      const checked = selectedLocales.includes(loc) ? 'checked' : '';
      return `<label style="display:block;margin-bottom:5px;cursor:pointer;">
        <input type="checkbox" value="${loc}" ${checked} onchange="TileForgeLocalesUI.toggleLocale(this.value, this.checked)">
        <span>${loc} - ${info.language} (${info.country})</span>
      </label>`;
    }).join('');
  }

  function toggleLocale(loc, checked) {
    if (checked) {
      if (!selectedLocales.includes(loc)) selectedLocales.push(loc);
    } else {
      selectedLocales = selectedLocales.filter(l => l !== loc);
    }
  }

  function selectAll() {
    selectedLocales = window.TileForgeLocales.getAllLocales();
    renderList();
  }
  function clearAll() {
    selectedLocales = [];
    renderList();
  }
  function loadDefault(type) {
    selectedLocales = window.TileForgeLocales.getDefaultSet(type);
    renderList();
  }
  function apply() {
    if (onApplyCallback) onApplyCallback(selectedLocales);
    close();
  }

  // Expose API
  return {
    open, close, toggleLocale, selectAll, clearAll, loadDefault, apply
  };
})();
