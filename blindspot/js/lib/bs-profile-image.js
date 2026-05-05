/* ============================================================
   bs-profile-image.js
   Profile image generator modal.
   IIFE on window.BsProfileImage.

   Opens when the pencil button on the Fighter Profile hero is
   clicked. Player types or rolls a description, generates via
   content-quick-generate (same path Quick Build uses for card
   avatars), previews, and saves. Save persists to the server
   profile via ArenaAPI.setProfileImage and fans out to:
     - localStorage[bs-profile-image]
     - BsAuthUI.refreshAvatar() (topbar chip + dropdown header)
     - re-render of the Fighter Profile hero (via callback)

   Public API:
     init({ refreshHero })   sets the callback used after save
     open()                  reveals the modal, focuses the textarea
     close()                 hides the modal
   ============================================================ */
(function () {
  'use strict';

  // Curated seed prompts. Surprise Me picks one and writes it into
  // the textarea. The player can edit before generating.
  var SUGGESTIONS = [
    'scarred mercenary in dim torchlight',
    'neon street rogue with cybernetic eye',
    'ash-cloaked monk meditating in ruins',
    'armored knight, half-helm, weary eyes',
    'rain-soaked detective in a noir alley',
    'cyberpunk hacker, holographic visor',
    'sun-darkened desert ranger',
    'spectral monk with glowing prayer beads',
    'young mage with a star-touched scar',
    'veteran gladiator, broken horn',
    'neon priestess of the data shrine',
    'wandering swordsman in red kasaya',
    'obsidian-armored revenant',
    'tactical scout with shadowed eyes',
    'celestial archer drawn in chalk',
    'battle-tested medic with prosthetic arm',
    'feral hunter painted with ash',
    'underworld diplomat in plague mask',
    'forge-blackened smith with mended bones',
    'twilight oracle reading bone runes'
  ];

  var _cb = {};
  var _bound = false;
  var _previewUrl = '';
  var _generating = false;
  var _saving = false;

  function init(cbs) { _cb = cbs || {}; }

  function pickRandomSuggestion() {
    return SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)];
  }

  function setPreview(url) {
    _previewUrl = url || '';
    var img = document.getElementById('bs-pim-preview-img');
    var empty = document.getElementById('bs-pim-preview-empty');
    var save = document.getElementById('bs-pim-save');
    if (img) {
      if (_previewUrl) {
        img.src = _previewUrl;
        img.removeAttribute('hidden');
      } else {
        img.removeAttribute('src');
        img.setAttribute('hidden', '');
      }
    }
    if (empty) {
      if (_previewUrl) empty.setAttribute('hidden', '');
      else empty.removeAttribute('hidden');
    }
    if (save) save.disabled = !_previewUrl;
  }

  function setLoading(on) {
    var loading = document.getElementById('bs-pim-preview-loading');
    var img = document.getElementById('bs-pim-preview-img');
    var empty = document.getElementById('bs-pim-preview-empty');
    if (!loading) return;
    if (on) {
      loading.removeAttribute('hidden');
      if (img) img.setAttribute('hidden', '');
      if (empty) empty.setAttribute('hidden', '');
    } else {
      loading.setAttribute('hidden', '');
    }
  }

  function setError(msg) {
    var el = document.getElementById('bs-pim-error');
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.removeAttribute('hidden');
    } else {
      el.textContent = '';
      el.setAttribute('hidden', '');
    }
  }

  function setGenerateBusy(busy) {
    var btn = document.getElementById('bs-pim-generate');
    if (!btn) return;
    btn.disabled = !!busy;
    btn.innerHTML = busy
      ? '<span class="bs-spinner" role="status"></span><span>Channeling&hellip;</span>'
      : '<i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i><span>Generate</span>';
  }

  function setSaveBusy(busy) {
    var btn = document.getElementById('bs-pim-save');
    if (!btn) return;
    btn.disabled = !!busy || !_previewUrl;
    btn.textContent = busy ? 'Saving…' : 'Save';
  }

  async function generate() {
    if (_generating) return;
    var input = document.getElementById('bs-pim-prompt');
    var prompt = input ? String(input.value || '').trim() : '';
    if (!prompt) {
      setError('Add a description first, or hit Surprise me.');
      return;
    }
    if (prompt.length > 240) prompt = prompt.slice(0, 240);

    _generating = true;
    setError('');
    setLoading(true);
    setGenerateBusy(true);

    try {
      var resp = await fetch('https://ambientpixels-nova-api.azurewebsites.net/api/content-quick-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company-secret': 'pixelpusher' },
        body: JSON.stringify({
          topic: 'Player profile portrait: ' + prompt,
          goal: 'Player profile avatar portrait, square composition, centered face and upper body, dark atmospheric background, painterly fantasy or cyberpunk style.',
          outputs: ['square_image'],
          skipApproval: true,
          accountId: 'blindspot-profile-image'
        })
      });
      var json = await resp.json();
      var imageUrl = '';
      if (json && json.ok && json.outputs) {
        var firstKey = Object.keys(json.outputs).find(function (k) { return json.outputs[k].status === 'success'; });
        if (firstKey) imageUrl = json.outputs[firstKey].imageUrl || json.outputs[firstKey].thumbUrl || '';
      }
      if (!imageUrl) {
        setError('Generation failed. Try again or rephrase.');
        setLoading(false);
        return;
      }
      setLoading(false);
      setPreview(imageUrl);
    } catch (err) {
      console.warn('[BsProfileImage] generate error:', err);
      setLoading(false);
      setError('Network error. Try again.');
    } finally {
      _generating = false;
      setGenerateBusy(false);
    }
  }

  async function save() {
    if (_saving || !_previewUrl) return;
    _saving = true;
    setError('');
    setSaveBusy(true);
    try {
      if (window.ArenaAPI && window.ArenaAPI.setProfileImage) {
        await window.ArenaAPI.setProfileImage(_previewUrl);
      }
      // Mirror to localStorage so the topbar + Fighter Profile hero
      // pick it up immediately without waiting for next profile load.
      try { localStorage.setItem('bs-profile-image', _previewUrl); }
      catch (e) { /* ignore quota */ }
      // Refresh consumers.
      if (window.BsAuthUI && window.BsAuthUI.refreshAvatar) {
        try { window.BsAuthUI.refreshAvatar(); } catch (e) { /* silent */ }
      }
      if (_cb.refreshHero) {
        try { _cb.refreshHero(); } catch (e) { /* silent */ }
      }
      close();
    } catch (err) {
      console.warn('[BsProfileImage] save error:', err);
      setError('Could not save. Try again.');
    } finally {
      _saving = false;
      setSaveBusy(false);
    }
  }

  function bind() {
    if (_bound) return;
    var modal = document.getElementById('bs-profile-image-modal');
    if (!modal) return;
    _bound = true;

    // Close handlers
    document.getElementById('bs-pim-close')?.addEventListener('click', close);
    document.getElementById('bs-pim-cancel')?.addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (modal.classList.contains('bs-modal-backdrop--hidden')) return;
      close();
    });

    // Surprise me
    document.getElementById('bs-pim-surprise')?.addEventListener('click', function () {
      var input = document.getElementById('bs-pim-prompt');
      if (input) {
        input.value = pickRandomSuggestion();
        input.focus();
      }
      setError('');
    });

    // Generate
    document.getElementById('bs-pim-generate')?.addEventListener('click', generate);

    // Save
    document.getElementById('bs-pim-save')?.addEventListener('click', save);
  }

  function open() {
    bind();
    var modal = document.getElementById('bs-profile-image-modal');
    if (!modal) return;
    setError('');
    setPreview('');
    setLoading(false);
    setGenerateBusy(false);
    setSaveBusy(false);
    var input = document.getElementById('bs-pim-prompt');
    if (input) input.value = '';
    modal.classList.remove('bs-modal-backdrop--hidden');
    if (input) setTimeout(function () { input.focus(); }, 50);
  }

  function close() {
    var modal = document.getElementById('bs-profile-image-modal');
    if (!modal) return;
    modal.classList.add('bs-modal-backdrop--hidden');
  }

  window.BsProfileImage = {
    init: init,
    open: open,
    close: close
  };
})();
