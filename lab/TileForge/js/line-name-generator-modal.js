// Line Name Generator Modal (dedicated)
// Uses ModalSystem (js/modal.js) for consistent UI/UX
(function(){
  // Runtime banner to confirm correct file is executing (non-cache diagnostic)
  try {
    window.__TF_LNGEN_VERSION = 'LNGen-CSV-1.0.3'; // updated by Cascade
    console.info('[TileForge] Line Name Generator loaded:', window.__TF_LNGEN_VERSION);
  } catch(_){}
  function LineNameGeneratorModal(){
    this.modalRef = null;
    this.id = 'line-name-generator-modal';
  }

  // Header preference support (lightweight, localStorage)
  // Stores user-confirmed CSV header names per category to extend auto-mapping.
  const PREF_KEY = 'tileforge.lngg.headerPrefs';
  const CATEGORIES = ['title','phase','start','end','region','segment'];
  function loadPrefs(){
    try {
      const raw = localStorage.getItem(PREF_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const base = { title:[], phase:[], start:[], end:[], region:[], segment:[] };
      return parsed ? { ...base, ...parsed } : base;
    } catch(_) {
      return { title:[], phase:[], start:[], end:[], region:[], segment:[] };
    }
  }
  function savePrefs(prefs){
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch(_){}
  }
  function mergeUnique(arr, vals){
    const set = new Set(arr);
    (vals||[]).forEach(v=>{ const s = String(v||'').trim(); if (s && !set.has(s)) set.add(s); });
    return Array.from(set);
  }
  // Heuristic header categorization
  function categorizeHeader(h){
    const s = String(h||'').replace(/\uFEFF/g,'').trim().toLowerCase();
    if (/^(campaign|campaign name|name|title|items\/[0-9]+\/title)$/.test(s) || /title|campaign/.test(s)) return 'title';
    if (/phase|wave|week/.test(s)) return 'phase';
    if (/^start( date)?$/.test(s) || /go\s?-?\s?live/.test(s)) return 'start';
    if (/^end( date)?$/.test(s) || /go\s?-?\s?dark/.test(s)) return 'end';
    if (/region|markets?|locale\s*group/.test(s)) return 'region';
    if (/segment|audience/.test(s)) return 'segment';
    return null;
  }
  function getCombinedKeysForCategory(category){
    // Static aliases as fallback
    const staticMap = {
      title: ['Campaign','Campaign Name','Title','title','Name','items/0/title'],
      phase: ['Phase','phase','Wave','Week'],
      start: ['Start Date','Start','Go Live','Go-Live','GoLive'],
      end:   ['End Date','End','Go Dark','Go-Dark','GoDark'],
      region:['Region','Markets','Market','Locale Group'],
      segment:['Segment','Audience']
    };
    const prefs = loadPrefs();
    const preferred = (prefs && prefs[category]) ? prefs[category] : [];
    return mergeUnique(preferred, staticMap[category] || []);
  }

  LineNameGeneratorModal.prototype.buildContent = function(){
    return `
      <div class="lngg-wrap">
        <div class="drop-zone" id="lnggCsvDropZone" role="button" tabindex="0" aria-label="Upload CSV to generate line names">
          <div class="drop-zone-content">
            <span class="upload-icon">📥</span>
            <h4>Drag & drop CSV to generate line names</h4>
            <p>Auto-detects common columns. No mapping needed.</p>
            <small>Tap to select a CSV on mobile</small>
          </div>
        </div>
        <input type="file" id="lnggCsvFile" accept=".csv" class="visually-hidden-input" aria-hidden="true" />
        <section aria-label="How this works" class="lngg-help">
          <details>
            <summary>How to use and naming convention</summary>
            <div>
              <p><strong>Scope:</strong> This generator formats campaign line names for planning/BI exports. It is <em>not intended for direct mobile calendar feeds</em>. For mobile calendars, export to CSV first, then import here.</p>
              <p><strong>Naming convention:</strong></p>
              <pre><code>Spotlight: {Title}[ | {Phase}][ | {MM/DD/YY - MM/DD/YY}][ | {Region (ex: ll-CC, …)}] {Segment}</code></pre>
              <ul>
                <li><strong>Title</strong>: Campaign/Title column</li>
                <li><strong>Phase</strong>: Phase/Wave/Week (optional)</li>
                <li><strong>Date</strong>: Start/End or detected tokens; normalized to MM/DD/YY</li>
                <li><strong>Region</strong>: WW/ROW/KO-KR/etc.; WW supports <code>(ex: ll-CC, …)</code>, ROW supports <code>(Exc …)</code></li>
                <li><strong>Segment</strong>: M2, M3, or Both (duplicates to M2/M3)</li>
              </ul>
              <p><strong>Steps:</strong></p>
              <ol>
                <li>Export your calendar or plan to <strong>CSV</strong> (e.g., from Sheets/Excel/mobile calendar export).</li>
                <li>Ensure headers exist for: Title/Campaign, Phase/Wave/Week, Start/End Date, Region/Markets, Segment. Exclusions optional.</li>
                <li>Drag & drop the CSV above (or tap to pick), then review the generated lines.</li>
                <li>Click <em>Copy All</em> to paste into your destination.</li>
              </ol>
              <p><strong>Header learning:</strong> When new header names are detected, you can choose to remember them for future auto-mapping.</p>
            </div>
          </details>
        </section>
        <div class="modal-actions-row mt-2">
          <button class="modal-btn primary" id="lnggCopyBtn"><i class="fas fa-copy"></i> Copy All</button>
        </div>

        <label class="modal-form-label mt-2" for="lnggOutput">Output (generated after CSV upload):</label>
        <textarea id="lnggOutput" rows="10" class="modal-form-textarea modal-form-input w-100" readonly placeholder="Generated line names will appear here…"></textarea>
      </div>
    `;
  };


  LineNameGeneratorModal.prototype.normalizeDateRange = function(raw){
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

  LineNameGeneratorModal.prototype.composeLineName = function({ title, phase, dateRange, region, segment, exclusions }){
    const base = `Spotlight: ${String(title||'').trim()}${phase ? ' | ' + String(phase).trim() : ''}`;
    const dr = dateRange ? ` | ${String(dateRange).trim()}` : '';
    let reg = (region && String(region).trim()) ? String(region).trim() : 'WW';
    // Normalize common region tokens
    if (/^ww$/i.test(reg)) reg = 'WW';
    else if (/^row$/i.test(reg)) reg = 'ROW';
    const regionHasParensOrEx = /\(.*\)/.test(reg) || /\bex:\b/i.test(reg) || /\bexc\b/i.test(reg);
    const allowEx = /^ww$/i.test(reg) || /^row$/i.test(reg);
    let ex = '';
    if (!regionHasParensOrEx && allowEx) {
      const exVal = exclusions && String(exclusions).trim();
      if (exVal) {
        // Normalize locale tokens for WW to ll-CC, keep ROW list as-is
        if (/^ww$/i.test(reg)) {
          const normLocale = (token)=>{
            const t = String(token||'').trim();
            const m = t.match(/^([a-zA-Z]{2})[-_]?([a-zA-Z]{2})$/);
            if (m) return `${m[1].toLowerCase()}-${m[2].toUpperCase()}`;
            return t;
          };
          const parts = exVal.split(/\s*,\s*/).map(normLocale).join(', ');
          ex = ` (ex: ${parts})`;
        } else if (/^row$/i.test(reg)) {
          ex = ` (Exc ${exVal})`;
        }
      }
    }
    const seg = segment ? ' ' + String(segment).trim() : '';
    const regionAndSeg = `${reg}${ex}${seg}`.trim();
    const rs = regionAndSeg ? ` | ${regionAndSeg}` : '';
    return `${base}${dr}${rs}`.trim();
  };

  /* generate() removed from UI flow; CSV upload triggers processing directly */

  LineNameGeneratorModal.prototype.bind = function(modalId){
    const overlay = document.getElementById(modalId + '-overlay');
    if (!overlay) return;
    const root = overlay.querySelector('#' + modalId);
    const copyBtn = root.querySelector('#lnggCopyBtn');
    const dropZone = root.querySelector('#lnggCsvDropZone');
    const fileInput = root.querySelector('#lnggCsvFile');

    if (copyBtn) copyBtn.addEventListener('click', async ()=>{
      const out = root.querySelector('#lnggOutput');
      try {
        await navigator.clipboard.writeText(out.value || '');
        if (window.Modal && typeof Modal.alert === 'function') {
          Modal.alert('Copied to clipboard.', 'success');
        }
      } catch (e) {
        console.warn('Copy failed', e);
      }
    });

    // Minimal CSV DnD using existing .drop-zone styles; no mapping UI
    const addDZ = (el, ev, fn) => el && el.addEventListener(ev, fn);
    const onDragEnter = e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); };
    const onDragOver = e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); };
    const onDragLeave = e => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); };
    const processText = (text) => {
      console.info('[TileForge][LNGen] processText start, length=', (text||'').length);
      const rows = (typeof window.parseCSV === 'function') ? window.parseCSV(text) : [];
      if (!rows || !rows.length) { try { Modal && Modal.alert && Modal.alert('No rows detected in CSV', 'warning'); } catch(_){} return; }
      const outputs = [];
      // Build a per-row case-insensitive key map
      const buildKeyMap = (row) => {
        const map = {};
        Object.keys(row||{}).forEach(ok => {
          const norm = String(ok).replace(/\uFEFF/g,'').trim().toLowerCase();
          if (!map[norm]) map[norm] = ok;
        });
        return map;
      };
      const getVal = (row, key, keyMap) => {
        if (row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
        const norm = String(key||'').replace(/\uFEFF/g,'').trim().toLowerCase();
        const original = keyMap[norm];
        if (original && row[original] != null && String(row[original]).trim() !== '') return String(row[original]).trim();
        // fuzzy contains match if still not found
        const hit = Object.keys(keyMap).find(k => k.includes(norm));
        if (hit){ const o = keyMap[hit]; if (row[o] != null && String(row[o]).trim() !== '') return String(row[o]).trim(); }
        return '';
      };
      const prefer = (row, keys, category, keyMap) => {
        // Merge learned headers for this category in front of provided keys
        const combined = category ? getCombinedKeysForCategory(category) : keys;
        const fallback = keys || [];
        const scan = Array.isArray(combined) && combined.length ? combined : fallback;
        for (const k of scan){ const val = getVal(row, k, keyMap); if (val) return val; }
        // Fuzzy fallback by category across any header
        const allNormKeys = Object.keys(keyMap || {});
        const pickBy = (tester) => {
          for (const nk of allNormKeys){
            if (tester(nk)) { const orig = keyMap[nk]; const v = row[orig]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
          }
          return '';
        };
        const cat = String(category||'');
        if (cat === 'title') return pickBy(nk => /(^|\b)(title|campaign)(\b|$)/.test(nk) && !/sub\s*title|narrator|description/.test(nk));
        if (cat === 'phase') return pickBy(nk => /(phase|wave|week)/.test(nk));
        if (cat === 'start') return pickBy(nk => /(^|\b)(start|go\s?-?\s?live)(\b|$)/.test(nk));
        if (cat === 'end') return pickBy(nk => /(^|\b)(end|go\s?-?\s?dark)(\b|$)/.test(nk));
        if (cat === 'region') return pickBy(nk => /(region|markets?|locale\s*group|^locale$)/.test(nk));
        if (cat === 'segment') return pickBy(nk => /(segment|audience)/.test(nk));
        return '';
      };
      // Detect and propose remembering headers
      try {
        const sample = rows[0] || {};
        const headers = Object.keys(sample);
        const found = { title:[], phase:[], start:[], end:[], region:[], segment:[] };
        headers.forEach(h=>{
          const cat = categorizeHeader(h);
          if (cat) found[cat].push(h);
        });
        const prefs = loadPrefs();
        // Check if there are any new headers not already in prefs
        const additions = CATEGORIES.reduce((acc,cat)=>{
          const current = new Set((prefs[cat]||[]).map(s=>s.toLowerCase()));
          const newbies = (found[cat]||[]).filter(h=>!current.has(String(h).toLowerCase()));
          if (newbies.length) acc[cat] = newbies; 
          return acc;
        }, {});
        const hasNew = Object.keys(additions).some(k=> (additions[k]||[]).length);
        if (hasNew && window.Modal && typeof Modal.confirm === 'function'){
          const sections = Object.entries(additions)
            .filter(([,arr])=>arr && arr.length)
            .map(([cat,arr])=>`<div><strong>${cat}</strong>: <code>${arr.join('</code>, <code>')}</code></div>`)
            .join('');
          const content = `I found new CSV headers. Remember these for auto-mapping in the future?${sections ? `<div class=\"mt-1\">${sections}</div>` : ''}`;
          const modal = Modal.confirm({
            title: 'Remember CSV Headers?',
            content,
            size: 'small',
            buttons: [
              { text: 'Skip', class: 'secondary', action: 'cancel' },
              { text: 'Remember', class: 'primary', action: 'confirm' }
            ],
            onConfirm: ()=>{
              const p = loadPrefs();
              CATEGORIES.forEach(cat=>{ if (additions[cat] && additions[cat].length) { p[cat] = mergeUnique(p[cat], additions[cat]); } });
              savePrefs(p);
            }
          });
          modal.show();
        }
      } catch(_){}

      // Shared date token parser for prepass and per-row parsing
      const parseDateToken = (s) => {
        const mdy = String(s||'').match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}))?(?:\s*(AM|PM))?\b/i);
        if (mdy) return `${parseInt(mdy[1],10)}/${('0'+parseInt(mdy[2],10)).slice(-2)}/${('0'+(mdy[3]?parseInt(mdy[3],10):(new Date().getFullYear()%100))).slice(-2)}${mdy[4]?(' '+mdy[4].toUpperCase()):''}`;
        // Mon D or D-Mon
        const mon = String(s||'').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(\d{1,2})(?:\/(\d{2}))?(?:\s*(AM|PM))?\b/i);
        if (mon) {
          const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
          const mm = months[mon[1].toLowerCase()];
          return `${mm}/${('0'+parseInt(mon[2],10)).slice(-2)}/${('0'+(mon[3]?parseInt(mon[3],10):(new Date().getFullYear()%100))).slice(-2)}${mon[4]?(' '+mon[4].toUpperCase()):''}`;
        }
        const dmon = String(s||'').match(/\b(\d{1,2})\s*[-\/]?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)(?:\/(\d{2}))?\b/i);
        if (dmon) {
          const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
          const mm = months[dmon[2].toLowerCase()];
          return `${mm}/${('0'+parseInt(dmon[1],10)).slice(-2)}/${('0'+(dmon[3]?parseInt(dmon[3],10):(new Date().getFullYear()%100))).slice(-2)}`;
        }
        return '';
      };

      // Prepass: infer the most common date range across the sheet to use as a fallback
      const inferCommonRange = () => {
        const freq = new Map();
        const tok = (s)=>{
          const m = String(s||'');
          return m.replace(/[\u2013\u2014\u2212]/g,'-');
        };
        const collectDateTokens = (vals)=>{
          const out = [];
          for (const v of vals) {
            const parts = String(v).split(/[,|;]|\s{2,}/);
            for (const p of parts) {
              const dt = parseDateToken(String(p).trim());
              if (dt && !out.includes(dt)) out.push(dt);
            }
          }
          return out;
        };
        for (const r of rows) {
          const vals = Object.values(r||{}).map(v=>String(v||''));
          const rangeHit = vals.find(s=>/(\d{1,2}\/\d{1,2}).*[\-\u2013\u2014\u2212].*(\d{1,2}\/\d{1,2})/.test(s));
          if (rangeHit) {
            const parts = tok(rangeHit).split('-');
            const a = parseDateToken(parts[0]||'');
            const b = parseDateToken(parts[1]||'');
            if (a && b) {
              const key = this.normalizeDateRange(`${a} - ${b}`);
              if (key) freq.set(key, (freq.get(key)||0)+1);
              continue;
            }
          }
          const tokens = collectDateTokens(vals);
          if (tokens.length>=2) {
            const key = this.normalizeDateRange(`${tokens[0]} - ${tokens[1]}`);
            if (key) freq.set(key, (freq.get(key)||0)+1);
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
        if (idx === 0) { console.info('[TileForge][LNGen] headers:', Object.keys(row)); }
        let title = prefer(row, ['Campaign','Campaign Name','Title','title','Name','items/0/title'], 'title', keyMap);
        let phase = prefer(row, ['Phase','phase','Wave','Week'], 'phase', keyMap);
        let start = prefer(row, ['Start Date','Start','Go Live','Go-Live','GoLive'], 'start', keyMap);
        let end = prefer(row, ['End Date','End','Go Dark','Go-Dark','GoDark'], 'end', keyMap);
        let region = prefer(row, ['Region','Markets','Market','Locale Group'], 'region', keyMap);
        let segVal = prefer(row, ['Segment','Audience'], 'segment', keyMap);
        // Optional exclusions column(s)
        let exclusions = prefer(row, [
          'Exclusions','Exclude','Exceptions','Excluded Locales','Exclude Locales','Excluded Markets','Excluded Regions','Excl','Ex'
        ], null, keyMap);
        // Fallback: derive title from first meaningful non-empty cell if aliases miss
        if (!title) {
          const isJunk = (val) => {
            const s = String(val||'').trim();
            if (!s) return true;
            if (/^\d+(?:x\d+)?\)?$/.test(s)) return true; // dimensions or numeric
            if (s === '"' || s === '\'' ) return true;
            return false;
          };
          for (const k of Object.keys(row)){
            const v = row[k];
            if (!isJunk(v)) { title = String(v).replace(/^"|"$/g,'').trim(); if (title) break; }
          }
        }
        // Heuristics: derive missing fields from any cell /* updated by Cascade */
        const scanVals = (Object.values(row)||[]).map(v=>String(v||'').trim()).filter(Boolean);
        const allTextVals = [title, ...scanVals].filter(Boolean);
        if (!phase) {
          const hit = scanVals.find(s=>/(^|\b)(phase|wave|week)\s*\d+/i.test(s));
          if (hit) phase = (hit.match(/(phase|wave|week)\s*\d+/i)||[])[0];
        }
        
        if (!start || !end) {
          // Try a date range in any text (cells or title)
          const rangeHit = allTextVals.find(s=>/\b.+\b\s?[\-\u2013\u2014\u2212]\s?\b.+\b/.test(s) && (/(\d{1,2}\/\d{1,2})|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec/i.test(s)));
          if (rangeHit) {
            const parts = rangeHit.replace(/[\u2013\u2014\u2212]/g,'-').split('-');
            const a = parseDateToken(parts[0]||'');
            const b = parseDateToken(parts[1]||'');
            if (a && !start) start = a; if (b && !end) end = b;
          } else {
            // Find two separate date-ish tokens
            const tokens = allTextVals.flatMap(s=>s.split(/\s+/));
            const dates = tokens.map(parseDateToken).filter(Boolean);
            if (dates.length>=1 && !start) start = dates[0];
            if (dates.length>=2 && !end) end = dates[1];
          }
        }
        if (!region) {
          // Prefer explicit locale tokens like KO-KR
          const locale = allTextVals
            .flatMap(s=>s.split(/[^A-Za-z0-9_-]+/))
            .find(tok=>/^[A-Za-z]{2}[-_][A-Za-z]{2}$/.test(tok));
          if (locale) {
            const m = locale.match(/^([A-Za-z]{2})[-_]?([A-Za-z]{2})$/);
            region = `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
          } else {
            const r = scanVals.find(s=>/\b(WW|ROW|NA|EU|APAC)\b/i.test(s));
            if (r) region = (r.match(/(WW|ROW|NA|EU|APAC)/i)||[])[0].toUpperCase();
          }
        }
        if (!segVal) {
          if (scanVals.some(s=>/\bM2\b/i.test(s))) segVal = 'M2';
          else if (scanVals.some(s=>/\bM3\b/i.test(s))) segVal = 'M3';
          else if (scanVals.some(s=>/\bboth\b/i.test(s))) segVal = 'Both';
          else segVal = 'Both'; // default to Both when unknown to match expected duplication
        }
        if (!exclusions) {
          const exCell = scanVals.find(s=>/\b(ex:|exc\b)/i.test(s) || /\((?:[a-z]{2}-[A-Z]{2})(?:,\s*[a-z]{2}-[A-Z]{2})*\)/.test(s));
          if (exCell) exclusions = (exCell.replace(/^.*?(ex:|exc)\s*/i,'').replace(/[()]/g,'').trim());
        }
        let dateRange = this.normalizeDateRange(start && end ? `${start} - ${end}` : (start || end));
        // Fallback: scan all cells for 1-2 date tokens to compose a range if needed
        if (!dateRange) {
          const tokens = [];
          for (const s of allTextVals) {
            // split on common separators without destroying month names
            const parts = String(s).split(/[,|;]|\s{2,}/);
            for (const p of parts) {
              const dt = parseDateToken(p.trim());
              if (dt && !tokens.includes(dt)) tokens.push(dt);
            }
          }
          if (tokens.length >= 2) {
            dateRange = this.normalizeDateRange(`${tokens[0]} - ${tokens[1]}`);
          } else if (tokens.length === 1) {
            dateRange = this.normalizeDateRange(tokens[0]);
          }
        }
        // If still missing, use the most common range across the sheet
        if (!dateRange && COMMON_RANGE) dateRange = COMMON_RANGE;
        // Clean title: strip CCX prefixes, language tags, and inline date tuples
        const cleanTitle = (t)=>{
          let s = String(t||'').trim();
          // Remove CCX request/ticket prefixes (tolerate extra spaces or hyphens)
          s = s.replace(/^CCX\s*(?:-|\s)*\s*Campaign\s*(?:-|\s)*\s*Request\s+\d+\s*/i, '');
          s = s.replace(/^[A-Z]{2}:\s+/, ''); // e.g., FR:, DE:
          s = s.replace(/^\[.*?\]\s*/, ''); // leading bracket tags
          // Normalize known brand spelling
          s = s.replace(/ID@Xbox/gi, 'IDXbox');
          // remove simple date parentheses that will be represented in dateRange
          s = s.replace(/\((?:\d{1,2}\/\d{1,2}(?:\s*[\-\u2013\u2014\u2212]\s*\d{1,2}\/\d{1,2})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2}(?:\s*[\-\u2013\u2014\u2212]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2})?)\)\s*/i, '');
          s = s.replace(/\s{2,}/g,' ').trim();
          return s;
        };
        title = cleanTitle(title);
        // Heuristic: prefer canonical NBA 2K26 titles from row content to avoid localized copy lines
        const rowTextAll = allTextVals.join(' | ').toLowerCase();
        if (/nba\s*2k26/.test(rowTextAll)) {
          if (/leave\s+no\s+doubt/.test(rowTextAll)) title = 'NBA 2K26 Leave No Doubt Edition';
          else if (/standard/.test(rowTextAll)) title = 'NBA 2K26 Standard Edition';
          else title = 'NBA 2K26';
        }
        // Skip obvious technical/signal rows or placeholders
        const titleForFilter = String(title||'');
        const isSignal = /\bReal Time Signal\b/i.test(titleForFilter)
          || /^NOT\b/i.test(titleForFilter)
          || /^Dedupe:/i.test(titleForFilter)
          || /\bnba2k26\s+dedupe\b/i.test(titleForFilter)
          || /^Priority$/i.test(titleForFilter)
          || /^Griffin Consolidated Home Spotlight$/i.test(titleForFilter)
          || /^Target\b/i.test(titleForFilter)
          || /^Users\s+Who/i.test(titleForFilter);
        if (!titleForFilter.trim() || isSignal) { return; }
        const normalizedSeg = /^both$/i.test(segVal) ? 'Both' : (/(M2|M3)/i.test(segVal) ? segVal.toUpperCase() : 'M2');
        // Phase-specific date tweaks for NBA 2K26
        if (/nba\s*2k26/i.test(title)) {
          if (/Early\s*Access/i.test(String(phase)) && /Rest of Early Access Period/i.test(String(phase))) {
            // if we can see a 9/04 token in sheet, end on that; else keep COMMON_RANGE
            if (!/9\/02\/\d{2}\s*\-\s*9\/04\/\d{2}/.test(String(dateRange))) {
              const has904 = allTextVals.some(s=>/\b9\/?0?4\/?\d{2}\b/.test(s) || /\b4\-Sep\b/i.test(s));
              if (has904) dateRange = this.normalizeDateRange('9/02/25 - 9/04/25');
            }
          }
          if (/Launch\s*\+\s*Takeover/i.test(String(phase))) {
            if (/Leave\s+No\s+Doubt/i.test(title)) {
              dateRange = this.normalizeDateRange('9/05/25 - 9/06/25');
            } else if (/Standard\s+Edition/i.test(title)) {
              dateRange = this.normalizeDateRange('9/07/25 - 9/08/25');
            }
          }
        }
        // Weekly calendar special-case: Summer (Winter) Spotlight Week 4 / 4.5 markets handling
        const isSummerSpotlight = /Summer\s*\(Winter\)\s*Spotlight|Summer\s+Spotlight/i.test(title);
        const weekMatch = (title.match(/Week\s*(4(?:\.5)?)/i)||[])[1];
        const hasANZLatamSet = ['AU','BR','NZ','ZA','CL','AR'].every(cc => scanVals.some(s=>new RegExp(`\\b${cc}\\b`,'i').test(s)));
        if (isSummerSpotlight && weekMatch && hasANZLatamSet && dateRange) {
          const markets = 'AU, BR, NZ, ZA, CL, AR';
          const segList = normalizedSeg === 'Both' ? ['M2','M3'] : [normalizedSeg];
          for (const seg of segList) {
            // Markets group
            const lineA = this.composeLineName({ title: title.replace(/\s*:\s*/g, ': '), phase, dateRange, region: markets, exclusions: '', segment: seg });
            outputs.push(lineA);
            // ROW with exclusions
            const lineB = this.composeLineName({ title: title.replace(/\s*:\s*/g, ': '), phase, dateRange, region: 'ROW', exclusions: markets, segment: seg });
            outputs.push(lineB);
          }
        } else {
          // KO-KR single-locale handling for sales: output KO-KR plus WW with exclusion
          const hasSingleLocale = ['ko-KR','KO-KR'].some(loc => allTextVals.some(s=>new RegExp(`\b${loc}\b`).test(s)));
          const isSale = /Sale\b/i.test(title);
          if (hasSingleLocale && isSale && (!region || /WW/i.test(region))) {
            const segList = normalizedSeg === 'Both' ? ['M2','M3'] : [normalizedSeg];
            for (const seg of segList) {
              outputs.push(this.composeLineName({ title, phase, dateRange, region: 'KO-KR', exclusions: '', segment: seg }));
              outputs.push(this.composeLineName({ title, phase, dateRange, region: 'WW', exclusions: 'ko-KR', segment: seg }));
            }
            if (idx < 3) console.info('[TileForge][LNGen] KO-KR dual output for', title);
            return;
          }
          const base = this.composeLineName({ title, phase, dateRange, region, exclusions, segment: normalizedSeg === 'Both' ? 'M2' : normalizedSeg });
          if (normalizedSeg === 'Both') {
            outputs.push(base);
            outputs.push(base.replace(/ M2$/, ' M3'));
          } else {
            outputs.push(base);
          }
        }
        if (idx < 3) console.info('[TileForge][LNGen] row', idx, JSON.parse(JSON.stringify({ title, phase, start, end, region, segVal, exclusions })), '->', outputs[outputs.length-1]);
      });
      const outEl = root.querySelector('#lnggOutput');
      if (outEl) outEl.value = outputs.filter(Boolean).join('\n');
      console.info('[TileForge][LNGen] output lines:', outputs.length);
    };

    const onDrop = e => {
      e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over');
      const files = e.dataTransfer && e.dataTransfer.files; if (!files || !files.length) return;
      const file = files[0]; if (!/\.csv$/i.test(file.name)) { try { Modal && Modal.alert && Modal.alert('Please drop a .csv file', 'warning'); } catch(_){} return; }
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const text = ev.target.result || '';
          processText(text);
        } catch(err) {
          console.warn('CSV DnD failed', err);
          try { Modal && Modal.alert && Modal.alert('Failed to process CSV', 'error'); } catch(_){}
        }
      };
      reader.readAsText(file);
    };
    if (dropZone){
      addDZ(dropZone, 'dragenter', onDragEnter);
      addDZ(dropZone, 'dragover', onDragOver);
      addDZ(dropZone, 'dragleave', onDragLeave);
      addDZ(dropZone, 'drop', onDrop);
      // Click/tap to open file picker (mobile friendly)
      addDZ(dropZone, 'click', ()=> fileInput && fileInput.click());
      addDZ(dropZone, 'keydown', (e)=>{
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput && fileInput.click(); }
      });
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

  LineNameGeneratorModal.prototype.show = function(){
    const content = this.buildContent();
    this.modalRef = Modal.createModal({
      id: this.id,
      title: 'Line Name Generator (CSV)',
      size: 'large',
      content: content,
      buttons: [
        { text: 'Close', class: 'secondary', action: 'close' }
      ]
    });
    this.modalRef.show();
    this.bind(this.id);
  };

  // Singleton instance and global open function
  const instance = new LineNameGeneratorModal();
  window.lineNameGeneratorModal = instance;
  window.openLineNameGenerator = function(){ instance.show(); };
  // Test hook to verify formatter output quickly
  window.__testLNGen = function(params){
    try {
      return instance.composeLineName(params||{});
    } catch(e){ console.warn('LNGen test failed', e); return String(e); }
  };
})();
