// locale-picker-ui.js
// UI logic for the locale picker modal in TileForge

window.TileForgeLocalesUI = (function() {
  let selectedLocales = [];
  let onApplyCallback = null;
  let currentLanguageFilter = null; // null = all languages

  function open(callback, preselect) {
    // If no preselect or it's empty, default to all locales checked
    if (Array.isArray(preselect) && preselect.length > 0) {
      selectedLocales = [...preselect];
    } else {
      selectedLocales = window.TileForgeLocales && typeof window.TileForgeLocales.getAllLocales === 'function'
        ? window.TileForgeLocales.getAllLocales()
        : [];
    }
    onApplyCallback = typeof callback === 'function' ? callback : null;
    renderLanguageFilters();
    renderList();
    document.getElementById('localePickerModal').classList.add('active');
    document.getElementById('localeSearchInput').value = '';
    document.getElementById('localeSearchInput').oninput = filterList;
  }

  function close() {
    document.getElementById('localePickerModal').classList.remove('active');
    onApplyCallback = null;
  }

  function getVisibleLocales() {
    const all = window.TileForgeLocales.getAllLocales();
    const map = window.TileForgeLocales.LOCALE_MAP;
    const q = (document.getElementById('localeSearchInput')?.value || '').trim().toLowerCase();
    return all.filter(loc => {
      const info = map[loc];
      const matchesLang = !currentLanguageFilter || info.language === currentLanguageFilter;
      if (!matchesLang) return false;
      if (!q) return true;
      return loc.toLowerCase().includes(q) ||
        (info.language && info.language.toLowerCase().includes(q)) ||
        (info.country && info.country.toLowerCase().includes(q));
    });
  }

  function renderList() {
    const map = window.TileForgeLocales.LOCALE_MAP;
    const localeList = document.getElementById('localeList');
    const visible = getVisibleLocales();
    localeList.innerHTML = visible.map(loc => {
      const info = map[loc];
      const checked = selectedLocales.includes(loc) ? 'checked' : '';
      return `<label style="display:block;margin-bottom:5px;cursor:pointer;">
        <input type="checkbox" value="${loc}" ${checked} onchange="TileForgeLocalesUI.toggleLocale(this.value, this.checked)">
        <span>${loc} - ${info.language} (${info.country})</span>
      </label>`;
    }).join('');
  }

  function filterList() {
    // Re-render using current language filter + search query
    renderList();
  }

  function renderLanguageFilters() {
    const el = document.getElementById('localeLanguageFilters');
    if (!el || !window.TileForgeLocales || !window.TileForgeLocales.LOCALE_MAP) return;
    const langs = Array.from(new Set(Object.values(window.TileForgeLocales.LOCALE_MAP).map(i => i.language))).sort();
    const buttons = [
      `<button class="pill-btn" data-lang="__ALL__" ${!currentLanguageFilter ? 'aria-pressed="true"' : ''}>All</button>`,
      ...langs.map(l => `<button class="pill-btn" data-lang="${l}">${l}</button>`)
    ];
    el.innerHTML = buttons.join('');
    el.onclick = (e) => {
      const btn = e.target.closest('button.pill-btn');
      if (!btn) return;
      const lang = btn.getAttribute('data-lang');
      currentLanguageFilter = (lang === '__ALL__') ? null : lang;
      // Active state
      el.querySelectorAll('button.pill-btn').forEach(b => b.removeAttribute('aria-pressed'));
      btn.setAttribute('aria-pressed', 'true');
      renderList();
    };
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
