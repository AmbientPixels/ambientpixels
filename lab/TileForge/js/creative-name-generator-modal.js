// Creative Name Generator Modal (dedicated)
// Mirrors Line Name Generator but formats Creative naming patterns
// Uses ModalSystem (js/modal.js) and csv-handler's parseCSV indirectly via FileReader
(function(){
  try {
    window.__TF_CNG_VERSION = 'CreaGen-CSV-1.0.0'; // added by Cascade
    console.info('[TileForge] Creative Name Generator loaded:', window.__TF_CNG_VERSION);
  } catch(_){}

  function CreativeNameGeneratorModal(){
    this.modalRef = null;
    this.id = 'creative-name-generator-modal';
  }

  CreativeNameGeneratorModal.prototype.buildContent = function(){
    return `
      <div class="cng-wrap">
        <div class="drop-zone" id="cngCsvDropZone" role="button" tabindex="0" aria-label="Upload CSV to generate creative names">
          <div class="drop-zone-content">
            <span class="upload-icon">📥</span>
            <h4>Drag & drop CSV to generate creative names</h4>
            <p>Auto-detects common columns (Program, Slot, Campaign/Product, Dates, Regions).</p>
            <small>Tap to select a CSV on mobile</small>
          </div>
        </div>
        <input type="file" id="cngCsvFile" accept=".csv" class="visually-hidden-input" aria-hidden="true" />
        <section aria-label="How this works" class="cng-help">
          <details>
            <summary>Most common pattern used</summary>
            <div>
              <p><strong>XBL Item (Campaign mode)</strong></p>
              <pre><code>XBL Item M{slot} | {Program} | {Campaign} | {Week?} | {Tag?} | {Dates?} | {Region}</code></pre>
              <p><strong>XBL Item (Product mode)</strong></p>
              <pre><code>XBL Item M{slot} | {Program} | {Product Title} | {CTA} | {ProductID} {(Edition?)} | {Region}</code></pre>
              <p><strong>ToH</strong></p>
              <pre><code>ToH: {Title} | {MM/DD/YY - MM/DD/YY} | {Region}</code></pre>
            </div>
          </details>
        </section>
        <div class="modal-actions-row mt-2">
          <button class="modal-btn primary" id="cngCopyBtn"><i class="fas fa-copy"></i> Copy All</button>
        </div>

        <label class="modal-form-label mt-2" for="cngOutput">Output:</label>
        <textarea id="cngOutput" rows="10" class="modal-form-textarea modal-form-input w-100" readonly placeholder="Generated creative names will appear here…"></textarea>
      </div>
    `;
  };

  CreativeNameGeneratorModal.prototype.normalizeDateRange = function(raw){
    if (!raw) return '';
    let s = String(raw).trim();
    s = s.replace(/[\u2013\u2014\u2212]/g, '-');
    s = s.replace(/\s*-\s*/g, ' - ');
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
    const pad = (n)=> (n<10? '0'+n : ''+n);
    const year = new Date().getFullYear() % 100;
    function toMDY(token){
      token = token.trim();
      const timePart = (token.match(/\b(\d{1,2}\s?(AM|PM))\b/i) || [])[0] || '';
      token = token.replace(timePart, '').trim();
      const m1 = token.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:\/(\d{2}))?$/i);
      if (m1){
        const mm = months[m1[1].toLowerCase()];
        const dd = parseInt(m1[2],10);
        const yy = m1[3] ? parseInt(m1[3],10) : year;
        return `${mm}/${pad(dd)}/${pad(yy)}${timePart ? ' ' + timePart.toUpperCase() : ''}`;
      }
      const m2 = token.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}))?$/);
      if (m2){
        const mm = parseInt(m2[1],10);
        const dd = parseInt(m2[2],10);
        const yy = m2[3] ? parseInt(m2[3],10) : year;
        return `${mm}/${pad(dd)}/${pad(yy)}${timePart ? ' ' + timePart.toUpperCase() : ''}`;
      }
      return token;
    }
    const parts = s.split(' - ');
    if (parts.length === 1) return toMDY(parts[0]);
    const start = toMDY(parts[0]);
    const end = toMDY(parts[1]);
    return `${start} - ${end}`;
  };

  // Compose Creative lines by mode
  CreativeNameGeneratorModal.prototype.composeCampaign = function({ slot, program, campaign, week, tag, dateRange, region }){
    const seg = slot ? `M${String(slot).replace(/[^23]/g,'')}` : 'M2';
    const prog = program || 'Store Spotlight';
    const parts = [
      `XBL Item ${seg}`,
      prog,
      campaign
    ];
    if (week) parts.push(week);
    if (tag) parts.push(tag);
    if (dateRange) parts.push(dateRange);
    parts.push(region || 'WW');
    return parts.filter(Boolean).join(' | ');
  };

  CreativeNameGeneratorModal.prototype.composeProduct = function({ slot, program, title, cta, productId, edition, region }){
    const seg = slot ? `M${String(slot).replace(/[^23]/g,'')}` : 'M2';
    const prog = program || 'Store Spotlight';
    const base = [`XBL Item ${seg}`, prog, title, cta, productId].filter(Boolean).join(' | ');
    const ed = edition ? ` (${edition})` : '';
    const reg = region || 'WW';
    return `${base}${ed ? ' | ' + productId + ed : ''}${!ed ? '' : ''} | ${reg}`.replace(/\s+\|\s+\|/g,' | ');
  };

  CreativeNameGeneratorModal.prototype.bind = function(modalId){
    const overlay = document.getElementById(modalId + '-overlay');
    if (!overlay) return;
    const root = overlay.querySelector('#' + modalId);
    const copyBtn = root.querySelector('#cngCopyBtn');
    const dropZone = root.querySelector('#cngCsvDropZone');
    const fileInput = root.querySelector('#cngCsvFile');

    if (copyBtn) copyBtn.addEventListener('click', async ()=>{
      const out = root.querySelector('#cngOutput');
      try { await navigator.clipboard.writeText(out.value || ''); Modal && Modal.alert && Modal.alert('Copied to clipboard.', 'success'); } catch(e){}
    });

    const addDZ = (el, ev, fn) => el && el.addEventListener(ev, fn);
    const onDragEnter = e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); };
    const onDragOver = e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); };
    const onDragLeave = e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); };

    const parseDateToken = (s) => {
      const mdy = String(s||'').match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}))?(?:\s*(AM|PM))?\b/i);
      if (mdy) return `${parseInt(mdy[1],10)}/${('0'+parseInt(mdy[2],10)).slice(-2)}/${('0'+(mdy[3]?parseInt(mdy[3],10):(new Date().getFullYear()%100))).slice(-2)}${mdy[4]?(' '+mdy[4].toUpperCase()):''}`;
      const mon = String(s||'').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:\/(\d{2}))?(?:\s*(AM|PM))?\b/i);
      if (mon) {
        const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
        const mm = months[mon[1].toLowerCase()];
        return `${mm}/${('0'+parseInt(mon[2],10)).slice(-2)}/${('0'+(mon[3]?parseInt(mon[3],10):(new Date().getFullYear()%100))).slice(-2)}${mon[4]?(' '+mon[4].toUpperCase()):''}`;
      }
      return '';
    };

    const processText = (text) => {
      const rows = (typeof window.parseCSV === 'function') ? window.parseCSV(text) : [];
      if (!rows || !rows.length) { try { Modal && Modal.alert && Modal.alert('No rows detected in CSV', 'warning'); } catch(_){} return; }
      const outputs = [];

      const buildKeyMap = (row) => {
        const map = {};
        Object.keys(row||{}).forEach(ok => { const norm = String(ok).replace(/\uFEFF/g,'').trim().toLowerCase(); if (!map[norm]) map[norm] = ok; });
        return map;
      };
      const getVal = (row, key, keyMap) => {
        if (row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
        const norm = String(key||'').replace(/\uFEFF/g,'').trim().toLowerCase();
        const original = keyMap[norm];
        if (original && row[original] != null && String(row[original]).trim() !== '') return String(row[original]).trim();
        const hit = Object.keys(keyMap).find(k => k.includes(norm));
        if (hit){ const o = keyMap[hit]; if (row[o] != null && String(row[o]).trim() !== '') return String(row[o]).trim(); }
        return '';
      };
      const prefer = (row, keys, keyMap) => {
        for (const k of keys){ const val = getVal(row, k, keyMap); if (val) return val; }
        return '';
      };

      // Common field alias lists
      const AL = {
        program: ['Program','program','Store Program','Store','Channel'],
        slot: ['Segment','Audience','Slot','Item','Placement','M2/M3'],
        campaign: ['Campaign','Campaign Name','Title','Name','title','items/0/title'],
        week: ['Week','Wave','Phase'],
        tag: ['Tag','Shortcode','Slug','Code'],
        start: ['Start Date','Start','Go Live','Go-Live','GoLive'],
        end: ['End Date','End','Go Dark','Go-Dark','GoDark'],
        region: ['Region','Markets','Market','Locale Group','Locale'],
        title: ['Product Title','Title','Game','SKU Title','title'],
        cta: ['CTA','Call to Action','Subline','Description','Subtitle','description'],
        productId: ['Product ID','Store ID','ID','ProductID'],
        edition: ['Edition','Variant','Edition Note']
      };

      // Infer a common date range across the sheet
      const inferCommonRange = () => {
        const freq = new Map();
        const normDash = (s)=> String(s||'').replace(/[\u2013\u2014\u2212]/g,'-');
        for (const r of rows) {
          const vals = Object.values(r||{}).map(v=>String(v||''));
          const joined = vals.join(' | ');
          const m = normDash(joined).match(/(\d{1,2}\/\d{1,2}(?:\/\d{2})?)\s*-\s*(\d{1,2}\/\d{1,2}(?:\/\d{2})?)/);
          if (m) {
            const a = parseDateToken(m[1]);
            const b = parseDateToken(m[2]);
            if (a && b) {
              const key = this.normalizeDateRange(`${a} - ${b}`);
              if (key) freq.set(key, (freq.get(key)||0)+1);
            }
          }
        }
        let best = '';
        let max = 0;
        for (const [k,v] of freq.entries()) { if (v>max) { max=v; best=k; } }
        return best;
      };
      const COMMON_RANGE = inferCommonRange();

      rows.forEach((row, idx) => {
        const keyMap = buildKeyMap(row);
        if (idx === 0) { console.info('[TileForge][CreaGen] headers:', Object.keys(row)); }

        let slotRaw = prefer(row, AL.slot, keyMap) || 'Both';
        let program = prefer(row, AL.program, keyMap) || 'Store Spotlight';
        let campaign = prefer(row, AL.campaign, keyMap);
        let week = prefer(row, AL.week, keyMap);
        let tag = prefer(row, AL.tag, keyMap);
        let start = prefer(row, AL.start, keyMap);
        let end = prefer(row, AL.end, keyMap);
        let region = prefer(row, AL.region, keyMap);

        let title = prefer(row, AL.title, keyMap);
        let cta = prefer(row, AL.cta, keyMap);
        let productId = prefer(row, AL.productId, keyMap);
        let edition = prefer(row, AL.edition, keyMap);

        // Detect ToH pattern rows ("ToH:" prefix present somewhere)
        const anyText = Object.values(row||{}).map(v=>String(v||'')).join(' | ');
        const isToH = /\bToH\b/i.test(anyText) || /^ToH:/i.test(String(campaign||title||''));

        // Normalize slot
        const slot = /\bM3\b/i.test(slotRaw) ? '3' : (/\bM2\b/i.test(slotRaw) ? '2' : 'Both');
        const segList = slot === 'Both' ? ['2','3'] : [slot];

        // Date range
        let dateRange = this.normalizeDateRange(start && end ? `${start} - ${end}` : (start || end));
        if (!dateRange && COMMON_RANGE) dateRange = COMMON_RANGE;

        // Normalize region tokens case
        if (region) {
          if (/^ww$/i.test(region)) region = 'WW';
          else if (/^row$/i.test(region)) region = 'ROW';
        }

        // Product-mode detection: strong if ProductID present or CTA present with Product Title
        const hasProductId = /\b9[A-Z0-9]{11}\b/.test(anyText) || /\b9[A-Z0-9]{11}\b/.test(String(productId||''));
        const productMode = hasProductId || (!!title && !!cta);

        const lines = [];
        if (isToH) {
          const t = campaign || title || '—';
          const r = region || 'WW';
          const dr = dateRange || '';
          lines.push([`ToH: ${t}`, dr, r].filter(Boolean).join(' | '));
        } else if (productMode) {
          segList.forEach(s => {
            const line = this.composeProduct({ slot: s, program, title: (title||campaign||'').trim(), cta, productId, edition, region: region || 'WW' });
            lines.push(line);
          });
        } else {
          segList.forEach(s => {
            const line = this.composeCampaign({ slot: s, program, campaign: (campaign||title||'').trim(), week, tag, dateRange, region: region || 'WW' });
            lines.push(line);
          });
        }

        outputs.push(...lines);
        if (idx < 3) console.info('[TileForge][CreaGen] row', idx, '->', lines);
      });

      const outEl = root.querySelector('#cngOutput');
      if (outEl) outEl.value = outputs.filter(Boolean).join('\n');
      console.info('[TileForge][CreaGen] output lines:', outputs.length);
    };

    const onDrop = e => {
      e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over');
      const files = e.dataTransfer && e.dataTransfer.files; if (!files || !files.length) return;
      const file = files[0]; if (!/\.csv$/i.test(file.name)) { try { Modal && Modal.alert && Modal.alert('Please drop a .csv file', 'warning'); } catch(_){} return; }
      const reader = new FileReader();
      reader.onload = ev => { try { processText(ev.target.result || ''); } catch(err){ console.warn('CSV DnD failed', err); try { Modal && Modal.alert && Modal.alert('Failed to process CSV', 'error'); } catch(_){} } };
      reader.readAsText(file);
    };

    if (dropZone){
      addDZ(dropZone, 'dragenter', onDragEnter);
      addDZ(dropZone, 'dragover', onDragOver);
      addDZ(dropZone, 'dragleave', onDragLeave);
      addDZ(dropZone, 'drop', onDrop);
      addDZ(dropZone, 'click', ()=> fileInput && fileInput.click());
      addDZ(dropZone, 'keydown', (e)=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput && fileInput.click(); } });
    }

    if (fileInput){
      addDZ(fileInput, 'change', (e)=>{
        const f = e.target.files && e.target.files[0]; if (!f) return;
        if (!/\.csv$/i.test(f.name)) { try { Modal && Modal.alert && Modal.alert('Please select a .csv file', 'warning'); } catch(_){} return; }
        const r = new FileReader();
        r.onload = ev => { try { processText(ev.target.result || ''); } catch(err){ console.warn('CSV read failed', err); } };
        r.readAsText(f);
      });
    }
  };

  CreativeNameGeneratorModal.prototype.show = function(){
    const content = this.buildContent();
    this.modalRef = Modal.createModal({
      id: this.id,
      title: 'Creative Name Generator (CSV)',
      size: 'large',
      content: content,
      buttons: [ { text: 'Close', class: 'secondary', action: 'close' } ]
    });
    this.modalRef.show();
    this.bind(this.id);
  };

  // Singleton and global open
  const instance = new CreativeNameGeneratorModal();
  window.creativeNameGeneratorModal = instance;
  window.openCreativeNameGenerator = function(){ instance.show(); };
})();
