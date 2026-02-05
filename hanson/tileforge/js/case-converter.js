// TileForge Native Case Converter Tool
(function() {
  function toTitleCase(str) {
    return str.replace(/\w\S*/g, function(txt){
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
  }
  function toSentenceCase(str) {
    return str.replace(/(^\s*[a-z])|([\.!?]\s*[a-z])/g, function(txt) {
      return txt.toUpperCase();
    });
  }
  function createCaseConverterPanel() {
    if (document.getElementById('caseConverterPanel')) return; // Only one instance
    // Create wrapper to match Projects padding/inset
    var wrapper = document.createElement('div');
    wrapper.className = 'controls-section';

    var panel = document.createElement('div');
    panel.className = 'case-converter-panel';
    panel.id = 'caseConverterPanel';
    panel.innerHTML = `
      <div class="case-header" style="cursor:pointer;">
        <h3><i class="fas fa-text-height"></i> String Forge <i class="fas fa-chevron-down" id="caseChevron"></i></h3>
      </div>
      <div id="casePanelBody" style="display:none;">
        <textarea id="caseInput" placeholder="Enter text here..."></textarea>
        <div class="case-advanced-row">
          <span>Advanced: Auto-fill from Live Editor Title</span>
          <label class="switch" aria-label="Auto-fill from Live Editor Title">
            <input type="checkbox" id="caseAutoFromTitle" />
            <span class="slider"></span>
          </label>
        </div>
        <div class="affix-input">
          <label for="caseAffixValue" class="affix-label">BIG ID:</label>
          <input type="text" id="caseAffixValue" class="affix-field" placeholder="e.g., 12345" />
          <div class="affix-select-wrap">
            <select id="caseAffixMode" class="affix-select" aria-label="Affix mode">
              <option value="append">Append</option>
              <option value="prepend">Prepend</option>
              <option value="lowerAppend">Lower+Append</option>
            </select>
          </div>
        </div>
        <div class="affix-meta">
          <span class="affix-hint">Selecting a mode applies immediately</span>
          <span class="affix-applied" id="affixApplied" aria-live="polite">Applied</span>
        </div>
        <div class="case-converter-btns-grid">
          <button id="toUpperBtn" class="btn btn-primary"><i class="fas fa-arrow-up-a-z"></i> UPPERCASE</button>
          <button id="toLowerBtn" class="btn btn-primary"><i class="fas fa-arrow-down-a-z"></i> lowercase</button>
          <button id="toTitleBtn" class="btn btn-primary"><i class="fas fa-text-height"></i> Title Case</button>
          <button id="toSentenceBtn" class="btn btn-primary"><i class="fas fa-font"></i> Sentence case</button>
          <button id="stripSpacesBtn" class="btn btn-primary" title="Remove all space characters"><i class="fas fa-scissors"></i> Strip Spaces</button>
          <button id="removePunctBtn" class="btn btn-primary" title="Remove punctuation characters"><i class="fas fa-ban"></i> Remove Punctuation</button>
          <button id="clearBtn" class="btn btn-secondary"><i class="fas fa-eraser"></i> Clear</button>
        </div>
        <div class="output-section">
          <label for="caseOutput">Output (click to copy)</label>
        </div>
        <textarea id="caseOutput" readonly></textarea>
      </div>
    `;
    // Insert into Tools section under Transform Data and Headline Mapper
    wrapper.appendChild(panel);
    var toolsSection = document.getElementById('toolsSection');
    if (toolsSection) {
      var anchor = toolsSection.querySelector('.tool-group');
      if (anchor && anchor.parentNode === toolsSection) {
        anchor.insertAdjacentElement('afterend', wrapper);
      } else {
        toolsSection.appendChild(wrapper);
      }
    } else {
      document.body.appendChild(wrapper);
    }
    // Wire up logic
    var input = panel.querySelector('#caseInput');
    var output = panel.querySelector('#caseOutput');
    var autoFromTitleToggle = panel.querySelector('#caseAutoFromTitle');
    var affixInput = panel.querySelector('#caseAffixValue');
    var affixMode = panel.querySelector('#caseAffixMode');
    var affixApplied = panel.querySelector('#affixApplied');
    // copy button removed; we use click-to-copy on the textarea
    var header = panel.querySelector('.case-header');
    var chevron = panel.querySelector('#caseChevron');
    var body = panel.querySelector('#casePanelBody');
    header.addEventListener('click', function() {
      if (body.style.display === 'none') {
        body.style.display = 'block';
        chevron.classList.remove('fa-chevron-down');
        chevron.classList.add('fa-chevron-up');
      } else {
        body.style.display = 'none';
        chevron.classList.remove('fa-chevron-up');
        chevron.classList.add('fa-chevron-down');
      }
    });
    // All transforms should chain: operate on current output if present; otherwise use input
    function getSourceText() {
      return (output && output.value && output.value.length ? output.value : input.value) || '';
    }
    function removePunctuation(text) {
      const t = text || '';
      // Prefer Unicode property escapes when available
      try {
        return t.replace(/[^\p{L}\p{N}\s]/gu, '');
      } catch (_) {
        // Fallback: strip common ASCII punctuation
        return t.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '');
      }
    }
    panel.querySelector('#toUpperBtn').onclick = function() {
      const src = getSourceText();
      output.value = src.toUpperCase();
    };
    panel.querySelector('#toLowerBtn').onclick = function() {
      const src = getSourceText();
      output.value = src.toLowerCase();
    };
    panel.querySelector('#toTitleBtn').onclick = function() {
      const src = getSourceText();
      output.value = toTitleCase(src);
    };
    panel.querySelector('#toSentenceBtn').onclick = function() {
      const src = getSourceText();
      output.value = toSentenceCase(src);
    };
    panel.querySelector('#stripSpacesBtn').onclick = function() {
      // Remove standard space characters only; keep tabs/newlines intact
      const src = getSourceText();
      output.value = src.replace(/ /g, '');
    };
    panel.querySelector('#removePunctBtn').onclick = function() {
      const src = getSourceText();
      output.value = removePunctuation(src);
    };
    function applyAffix() {
      const id = (affixInput && affixInput.value || '').trim();
      if (!id) return;
      const mode = (affixMode && affixMode.value) || 'append';
      const sep = ',';
      let src = getSourceText();
      if (mode === 'lowerAppend') src = src.toLowerCase();
      src = src.trim();
      if (mode === 'prepend') {
        output.value = src ? (id + sep + src) : id;
      } else {
        output.value = src ? (src + sep + id) : id;
      }
      if (affixApplied) {
        affixApplied.classList.add('show');
        setTimeout(() => affixApplied.classList.remove('show'), 900);
      }
    }
    if (affixMode) {
      affixMode.addEventListener('change', applyAffix);
    }
    if (affixInput) {
      affixInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyAffix();
        }
      });
    }
    panel.querySelector('#clearBtn').onclick = function() {
      input.value = '';
      output.value = '';
    };

    // Advanced: Auto-fill from Live Editor Title
    var boundSyncFn = null;
    var titleInputEl = null;
    function ensureTitleInput() {
      if (titleInputEl && document.body.contains(titleInputEl)) return titleInputEl;
      titleInputEl = document.getElementById('titleInput');
      return titleInputEl;
    }
    function syncFromTitle() {
      try {
        if (!input) return;
        var src = ensureTitleInput();
        if (src) {
          input.value = src.value || '';
        }
      } catch (_) {}
    }
    function enableAutoSync() {
      var src = ensureTitleInput();
      if (!src) {
        // Graceful notice using existing modal system if available
        var msg = 'Live Editor Title input not found. Open the Live Editor or load data, then try again.';
        if (window.Modal && typeof Modal.alert === 'function') { Modal.alert(msg, 'warning'); } else { alert(msg); }
        if (autoFromTitleToggle) autoFromTitleToggle.checked = false;
        return;
      }
      // Immediate sync once
      syncFromTitle();
      // Bind listener once
      if (!boundSyncFn) {
        boundSyncFn = function() { syncFromTitle(); };
      }
      src.addEventListener('input', boundSyncFn);
    }
    function disableAutoSync() {
      var src = ensureTitleInput();
      if (src && boundSyncFn) {
        src.removeEventListener('input', boundSyncFn);
      }
    }
    if (autoFromTitleToggle) {
      autoFromTitleToggle.addEventListener('change', function() {
        if (this.checked) {
          enableAutoSync();
        } else {
          disableAutoSync();
        }
      });
    }

    // Initialize from Settings default
    try {
      var defaultAuto = !!(window.currentSettings && window.currentSettings.caseAutoFillFromTitleDefault);
      if (autoFromTitleToggle) {
        autoFromTitleToggle.checked = defaultAuto;
        autoFromTitleToggle.setAttribute('aria-checked', String(defaultAuto));
        if (defaultAuto) enableAutoSync();
      }
    } catch (_) {}

    if (output) {
      output.addEventListener('click', async function() {
        try {
          const text = output.value || '';
          if (!text.trim()) return;
          output.select();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            document.execCommand && document.execCommand('copy');
          }
          if (window.Modal && typeof Modal.alert === 'function') {
            Modal.alert('Copied to clipboard.', 'success');
          }
        } catch (e) {
          console.warn('Auto-copy failed:', e);
        }
      });
    }
  }
  window.showCaseConverterPanel = createCaseConverterPanel;
  // Always inject Case Converter panel on page load
  createCaseConverterPanel();
})();
