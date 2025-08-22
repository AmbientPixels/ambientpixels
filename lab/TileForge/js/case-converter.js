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
    var panel = document.createElement('div');
    panel.className = 'case-converter-panel';
    panel.id = 'caseConverterPanel';
    panel.innerHTML = `
      <div class="case-header" style="cursor:pointer;">
        <h3><i class="fas fa-text-height"></i> Case Converter <i class="fas fa-chevron-down" id="caseChevron"></i></h3>
      </div>
      <div id="casePanelBody" style="display:none;">
        <textarea id="caseInput" placeholder="Enter text here..."></textarea>
        <div class="case-converter-btns">
          <button id="toUpperBtn" class="btn btn-primary case-btn-large"><i class="fas fa-arrow-up-a-z"></i> UPPERCASE</button>
        </div>
        <div class="case-converter-btns-grid">
          <button id="toLowerBtn" class="btn btn-primary"><i class="fas fa-arrow-down-a-z"></i> lowercase</button>
          <button id="toTitleBtn" class="btn btn-primary"><i class="fas fa-text-height"></i> Title Case</button>
          <button id="toSentenceBtn" class="btn btn-primary"><i class="fas fa-font"></i> Sentence case</button>
          <button id="clearBtn" class="btn btn-primary"><i class="fas fa-eraser"></i> Clear</button>
        </div>
        <div class="output-section">
          <label for="caseOutput">Output:</label>
          <button id="copyCaseOutputBtn" type="button" class="btn btn-primary" aria-label="Copy output to clipboard" title="Copy"><i class="fas fa-copy"></i></button>
        </div>
        <textarea id="caseOutput" readonly></textarea>
      </div>
    `;
    // Insert into main content or tools area
    var target = document.querySelector('.tools-section') || document.body;
    target.parentNode.insertBefore(panel, target.nextSibling);
    // Wire up logic
    var input = panel.querySelector('#caseInput');
    var output = panel.querySelector('#caseOutput');
    var copyBtn = panel.querySelector('#copyCaseOutputBtn');
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
    panel.querySelector('#toUpperBtn').onclick = function() {
      output.value = input.value.toUpperCase();
    };
    panel.querySelector('#toLowerBtn').onclick = function() {
      output.value = input.value.toLowerCase();
    };
    panel.querySelector('#toTitleBtn').onclick = function() {
      output.value = toTitleCase(input.value);
    };
    panel.querySelector('#toSentenceBtn').onclick = function() {
      output.value = toSentenceCase(input.value);
    };
    panel.querySelector('#clearBtn').onclick = function() {
      input.value = '';
      output.value = '';
    };
    if (copyBtn) {
      copyBtn.addEventListener('click', async function() {
        try {
          const text = output.value || '';
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            // Fallback for older browsers
            const tmp = document.createElement('textarea');
            tmp.value = text;
            tmp.setAttribute('readonly', '');
            tmp.style.position = 'absolute';
            tmp.style.left = '-9999px';
            document.body.appendChild(tmp);
            tmp.select();
            document.execCommand('copy');
            document.body.removeChild(tmp);
          }
          const prev = copyBtn.innerHTML;
          copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
          copyBtn.disabled = true;
          setTimeout(() => { copyBtn.innerHTML = prev; copyBtn.disabled = false; }, 1200);
        } catch (e) {
          const prev = copyBtn.innerHTML;
          copyBtn.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Failed';
          setTimeout(() => { copyBtn.innerHTML = prev; }, 1500);
          console.warn('Copy failed:', e);
        }
      });
    }
  }
  window.showCaseConverterPanel = createCaseConverterPanel;
  // Always inject Case Converter panel on page load
  createCaseConverterPanel();
})();
