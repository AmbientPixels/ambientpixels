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

  // Random style pool for Surprise Me. Excludes 'none' (no-style
  // gives generic output, not what a random roll should produce).
  // Matches the dropdown options in play.html minus the No Style entry.
  var STYLE_ROLL_POOL = [
    'ap-fantasy-card',
    'ap-dark-fantasy',
    'ap-dark-cinematic',
    'ap-comic-book',
    'ap-anime-cel',
    'ap-oil-portrait',
    'ap-holographic',
    'ap-neon-glass',
    'ap-watercolor',
    'ap-ornate-frame',
    'ap-retro-pixel'
  ];

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

  var DEFAULT_CROP = { scale: 1, posX: 50, posY: 50 };
  var ZOOM_MIN = 1;
  var ZOOM_MAX = 3;
  var ZOOM_STEP = 0.1;

  var _cb = {};
  var _bound = false;
  var _previewUrl = '';
  var _crop = { scale: 1, posX: 50, posY: 50 };
  var _generating = false;
  var _saving = false;
  var _drag = null;

  function init(cbs) { _cb = cbs || {}; }

  function pickRandomSuggestion() {
    return SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)];
  }
  function pickRandomStyle() {
    return STYLE_ROLL_POOL[Math.floor(Math.random() * STYLE_ROLL_POOL.length)];
  }

  // Apply current crop state to the preview img via CSS variables.
  // Same vars are read by .bs-topbar__user-avatar-img on the chip,
  // .bs-topbar__user-menu-avatar-img in the dropdown header, and
  // .bs-fighter-profile__avatar-img on the Fighter Profile hero.
  function applyCropToImg(imgEl) {
    if (!imgEl) return;
    imgEl.style.setProperty('--pim-pos-x', _crop.posX + '%');
    imgEl.style.setProperty('--pim-pos-y', _crop.posY + '%');
    imgEl.style.setProperty('--pim-scale', String(_crop.scale));
  }
  function applyCrop() {
    applyCropToImg(document.getElementById('bs-pim-preview-img'));
    var slider = document.getElementById('bs-pim-zoom-slider');
    if (slider) slider.value = String(Math.round(_crop.scale * 100));
  }
  function resetCrop() {
    _crop = { scale: 1, posX: 50, posY: 50 };
    applyCrop();
  }

  function setPreview(url) {
    _previewUrl = url || '';
    var img = document.getElementById('bs-pim-preview-img');
    var empty = document.getElementById('bs-pim-preview-empty');
    var save = document.getElementById('bs-pim-save');
    var zoomCtrls = document.getElementById('bs-pim-zoom');
    var zoomHint = document.getElementById('bs-pim-zoom-hint');
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
    if (zoomCtrls) {
      if (_previewUrl) zoomCtrls.removeAttribute('hidden');
      else zoomCtrls.setAttribute('hidden', '');
    }
    if (zoomHint) {
      if (_previewUrl) zoomHint.removeAttribute('hidden');
      else zoomHint.setAttribute('hidden', '');
    }
    if (save) save.disabled = !_previewUrl;
    // New preview always starts uncropped; apply defaults to clear
    // any leftover transform from a prior generate.
    if (_previewUrl) {
      resetCrop();
    }
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

    var styleSel = document.getElementById('bs-pim-style');
    var style = styleSel ? styleSel.value : 'ap-fantasy-card';

    _generating = true;
    setError('');
    setLoading(true);
    setGenerateBusy(true);

    try {
      var body = {
        topic: 'Player profile portrait: ' + prompt,
        goal: 'Player profile avatar portrait, square composition, centered face and upper body, dark atmospheric background.',
        outputs: ['square_image'],
        skipApproval: true,
        accountId: 'blindspot-profile-image'
      };
      // 'none' means no style preset; everything else is an
      // ap-* preset name the server already understands.
      if (style && style !== 'none') body.preset = style;
      var resp = await fetch('https://ambientpixels-nova-api.azurewebsites.net/api/content-quick-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-company-secret': 'pixelpusher' },
        body: JSON.stringify(body)
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
    var transform = { scale: _crop.scale, posX: _crop.posX, posY: _crop.posY };
    var transformJson = JSON.stringify(transform);
    try {
      if (window.ArenaAPI && window.ArenaAPI.setProfileImage) {
        await window.ArenaAPI.setProfileImage(_previewUrl, transform);
      }
      // Mirror to localStorage so the topbar + Fighter Profile hero
      // pick it up immediately without waiting for next profile load.
      try {
        localStorage.setItem('bs-profile-image', _previewUrl);
        localStorage.setItem('bs-profile-image-transform', transformJson);
      } catch (e) { /* ignore quota */ }
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

    // Surprise me: rolls BOTH a random style and a random description
    // so the player gets a fresh combo each click. Either can be
    // overridden before hitting Generate.
    document.getElementById('bs-pim-surprise')?.addEventListener('click', function () {
      var input = document.getElementById('bs-pim-prompt');
      var styleSel = document.getElementById('bs-pim-style');
      if (input) {
        input.value = pickRandomSuggestion();
        input.focus();
      }
      if (styleSel) styleSel.value = pickRandomStyle();
      setError('');
    });

    // Generate
    document.getElementById('bs-pim-generate')?.addEventListener('click', generate);

    // Save
    document.getElementById('bs-pim-save')?.addEventListener('click', save);

    // Zoom slider + buttons
    var slider = document.getElementById('bs-pim-zoom-slider');
    if (slider) {
      slider.addEventListener('input', function () {
        _crop.scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number(slider.value) / 100));
        applyCrop();
      });
    }
    document.getElementById('bs-pim-zoom-out')?.addEventListener('click', function () {
      _crop.scale = Math.max(ZOOM_MIN, +(_crop.scale - ZOOM_STEP).toFixed(2));
      applyCrop();
    });
    document.getElementById('bs-pim-zoom-in')?.addEventListener('click', function () {
      _crop.scale = Math.min(ZOOM_MAX, +(_crop.scale + ZOOM_STEP).toFixed(2));
      applyCrop();
    });
    document.getElementById('bs-pim-zoom-reset')?.addEventListener('click', resetCrop);

    // Drag-to-reposition + scroll-zoom on the preview itself.
    var preview = document.getElementById('bs-pim-preview');
    if (preview) {
      var handlePointerDown = function (clientX, clientY) {
        if (!_previewUrl) return;
        _drag = {
          startX: clientX,
          startY: clientY,
          posX: _crop.posX,
          posY: _crop.posY,
          rect: preview.getBoundingClientRect()
        };
        preview.classList.add('bs-pim-preview--dragging');
      };
      var handlePointerMove = function (clientX, clientY) {
        if (!_drag) return;
        var rect = _drag.rect;
        if (!rect.width || !rect.height) return;
        // Mouse drag delta translates inversely to object-position so
        // the focal point follows the cursor.
        var dx = (clientX - _drag.startX) / rect.width * 100;
        var dy = (clientY - _drag.startY) / rect.height * 100;
        _crop.posX = Math.max(0, Math.min(100, _drag.posX - dx));
        _crop.posY = Math.max(0, Math.min(100, _drag.posY - dy));
        applyCrop();
      };
      var handlePointerUp = function () {
        if (!_drag) return;
        _drag = null;
        preview.classList.remove('bs-pim-preview--dragging');
      };

      preview.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        handlePointerDown(e.clientX, e.clientY);
      });
      document.addEventListener('mousemove', function (e) {
        if (!_drag) return;
        handlePointerMove(e.clientX, e.clientY);
      });
      document.addEventListener('mouseup', handlePointerUp);

      // Touch drag (single-finger). Pinch-zoom is a future addition.
      preview.addEventListener('touchstart', function (e) {
        if (e.touches.length !== 1) return;
        var t = e.touches[0];
        handlePointerDown(t.clientX, t.clientY);
      }, { passive: true });
      document.addEventListener('touchmove', function (e) {
        if (!_drag || e.touches.length !== 1) return;
        var t = e.touches[0];
        handlePointerMove(t.clientX, t.clientY);
      }, { passive: true });
      document.addEventListener('touchend', handlePointerUp);
      document.addEventListener('touchcancel', handlePointerUp);

      preview.addEventListener('wheel', function (e) {
        if (!_previewUrl) return;
        e.preventDefault();
        var delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
        _crop.scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(_crop.scale + delta).toFixed(2)));
        applyCrop();
      }, { passive: false });
    }
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
    var styleSel = document.getElementById('bs-pim-style');
    if (styleSel) styleSel.value = 'ap-fantasy-card';
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
