/**
 * TileForge Headliner Crafter - Clean Version (No Approval Workflow)
 * Transforms raw localization CSV data into CardForge-compatible format
 * Simple workflow: Upload → Configure → Export
 */

class HeadlinerCrafter {
  /**
   * Parse XML string to array of objects matching CSV format
   * @param {string} xmlString
   * @returns {Array} Array of objects (one per Variant)
   */
  static parseXML(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
    const variants = xmlDoc.querySelectorAll('Variant');
    const rows = [];
    variants.forEach(variant => {
      // Normalize culture and support 2- or 3-part tags (e.g., zh-Hant-TW)
      const raw = (variant.getAttribute('variantCulture') || '').trim();
      const norm = raw.replace(/_/g, '-').toUpperCase();
      const parts = norm.split('-').filter(Boolean);
      let Language = parts[0] || '';
      let Region = parts.length >= 2 ? parts[parts.length - 1] : '';
      const row = { Language, Region, Locale: norm };
      variant.querySelectorAll('Field').forEach(field => {
        const name = field.getAttribute('name');
        row[name] = field.textContent || '';
      });
      rows.push(row);
    });
    return rows;
  }

  /**
   * Export array of objects to XML string in the given format
   * @param {Array} data
   * @param {string} itemName (optional)
   * @returns {string} XML string
   */
  static exportToXML(data, itemName = '_ExportedItem') {
    let xml = '<ExportedContentItems>\n  <ExportedContentItem>\n    <Name>' + itemName + '</Name>\n    <ContentTypeId>3e04bb2b-7f7f-4ed9-be90-0c8b4fcd5e80</ContentTypeId>\n    <ContentItem>\n';
    data.forEach(row => {
      const culture = row.Region ? `${row.Language}-${row.Region}` : row.Language;
      xml += `      <Variant variantCulture="${culture}">\n`;
      ['Title','Description','MiniFAD','SubHeader','Footer'].forEach(field => {
        xml += `        <Field name="${field}" type="String">${row[field] || ''}</Field>\n`;
      });
      xml += '      </Variant>\n';
    });
    xml += '      <PresentationData />\n    </ContentItem>\n  </ExportedContentItem>\n</ExportedContentItems>';
    return xml;
  }

  constructor() {
    this.currentData = null;
    this.fieldMappings = {
      'Title': 'headline',
      'MiniFAD': 'headline', 
      'Description': 'subheadline',
      'Narrator': 'narrator'
    };
    this.conditionalRules = [];
    // mapper-only template override (null uses auto-detect)
    this.templateOverrideMode = null; // 'toh' | 'mobile' | null
     
    console.log('🎯 Headliner Crafter initialized (Clean Version)');
  }

  /**
   * Analyze raw CSV data and determine optimal field mapping
   * @param {Array} csvData - Array of objects with locale data
   * @returns {Object} Analysis results and suggested mappings
   */
  analyzeData(csvData) {
    console.log('🔍 Analyzing raw data for optimal mapping...');
    
    const analysis = {
      totalRows: csvData.length,
      locales: new Set(),
      fieldAnalysis: {},
      suggestedMappings: [],
      warnings: []
    };

    // Analyze each row
    csvData.forEach(row => {
      // Use normalized locale resolution for accurate counting
      try {
        const resolved = this.resolveLocale(row);
        if (resolved) analysis.locales.add(resolved);
      } catch (_) {
        if (row.Region && row.Language) {
          analysis.locales.add(`${row.Language}-${row.Region}`);
        }
      }
      
      // Analyze fields
      Object.keys(row).forEach(field => {
        if (!analysis.fieldAnalysis[field]) {
          analysis.fieldAnalysis[field] = {
            samples: [],
            avgLength: 0,
            maxLength: 0,
            hasPromotionalContent: false
          };
        }
        
        const value = String(row[field] || '');
        analysis.fieldAnalysis[field].samples.push(value.substring(0, 50));
        analysis.fieldAnalysis[field].maxLength = Math.max(
          analysis.fieldAnalysis[field].maxLength, 
          value.length
        );
        
        // Check for promotional content
        if (value.includes('%') || value.includes('$') || value.toLowerCase().includes('sale')) {
          analysis.fieldAnalysis[field].hasPromotionalContent = true;
        }
      });
    });

    // Generate suggested mappings
    if (analysis.fieldAnalysis['MiniFAD']) {
      analysis.suggestedMappings.push({
        name: 'Promotional Focus',
        description: 'Use MiniFAD for headlines (promotional content)',
        mappings: { 'MiniFAD': 'headline', 'Title': 'subheadline', 'Description': 'narrator' }
      });
    }
    
    analysis.suggestedMappings.push({
      name: 'Standard Mapping',
      description: 'Use Title for headlines, Description for subheadlines',
      mappings: { 'Title': 'headline', 'Description': 'subheadline', 'Narrator': 'narrator' }
    });

    console.log('✅ Data analysis complete:', analysis);
    return analysis;
  }

  /**
   * Transform data based on current field mappings and rules
   * @param {Array} csvData - Raw CSV data
   * @returns {Array} Transformed data ready for CardForge
   */
  transformData(rows) {
    try {
      const mode = this.getActiveTemplateMode();
      const expected = (window.TileForgeLocales && typeof window.TileForgeLocales.getDefaultSet === 'function')
        ? (window.TileForgeLocales.getDefaultSet(mode) || [])
        : [];
      if (!Array.isArray(rows) || rows.length === 0) return [];

      // 1) First, run the original mapping pipeline so each row has the expected fields for the preview table
      const mappedRows = rows.map(src => {
        const locale = this.resolveLocale(src) || '';
        const out = {
          locale,
          headline: '',
          subheadline: '',
          narrator: ''
        };
        // Apply field mappings (output -> input). Allows one input to feed multiple outputs
        const outputs = ['headline', 'subheadline', 'narrator'];
        for (const outKey of outputs) {
          const inputField = (this.fieldMappings && this.fieldMappings[outKey]) ? this.fieldMappings[outKey] : '';
          if (inputField && src[inputField] != null) {
            out[outKey] = this.applyConditionalRules
              ? this.applyConditionalRules(src[inputField], inputField, src)
              : src[inputField];
          }
        }
        return out;
      }).filter(r => r.locale); // keep only rows with a resolved locale

      // If mapping produced nothing, bail early to avoid empty preview
      if (!mappedRows.length) {
        console.warn('HeadlinerCrafter: no mapped rows produced. Showing empty list.');
        return [];
      }

      // 2) If we don't have an expected template set, just return mapped rows (previous behavior)
      if (!expected.length) {
        console.debug('HeadlinerCrafter: no expected set for mode, returning mapped rows only.', { mode, count: mappedRows.length });
        return mappedRows;
      }

      // 3) Build language-first indexes from already-mapped rows
      const cultureIndex = new Map(); // 'DE-DE' => mapped row
      const languageIndex = new Map(); // 'DE' => first mapped row for that language
      for (const r of mappedRows) {
        const resolved = (r.locale || '').toUpperCase();
        if (!resolved) continue;
        const lang = resolved.split('-')[0];
        if (!cultureIndex.has(resolved)) cultureIndex.set(resolved, r);
        if (lang && !languageIndex.has(lang)) languageIndex.set(lang, r);
      }

      const out = [];
      let exactHits = 0;
      let langFallbacks = 0;

      for (const wantRaw of expected) {
        const want = (wantRaw || '').toUpperCase();
        const wantLang = want.split('-')[0];

        if (cultureIndex.has(want)) {
          const row = { ...cultureIndex.get(want), locale: want };
          out.push(row);
          exactHits++;
          continue;
        }

        if (wantLang && languageIndex.has(wantLang)) {
          const base = { ...languageIndex.get(wantLang), locale: want };
          out.push(base);
          langFallbacks++;
          continue;
        }
        // else: missing language entirely — validator will report it
      }

      // If filtering resulted in zero rows, fall back to mapped rows for preview so table isn't empty
      if (!out.length) {
        console.warn('HeadlinerCrafter: filtering produced 0 rows. Falling back to mapped rows for preview.', { mode, mapped: mappedRows.length });
        return mappedRows;
      }

      console.debug(`HeadlinerCrafter: transformData — exact: ${exactHits}, language-fallbacks: ${langFallbacks}, total: ${out.length}, mode: ${mode}`);
      return out;
    } catch (err) {
      console.error('transformData failed:', err);
      return [];
    }
  }

  unifyRow(r, resolvedLocale) {
    const row = { ...r };
    // Normalize primary fields into a stable payload surface.
    // If mapping logic exists elsewhere, we simply pass-through here.
    row.locale = resolvedLocale || row.locale || row.Locale || '';
    return row;
  }

  /**
   * Apply conditional rules to field content
   */
  applyConditionalRules(content, sourceField, fullRow) {
    let result = content;
    
    // Apply each conditional rule
    this.conditionalRules.forEach(rule => {
      if (rule.enabled && rule.sourceField === sourceField) {
        if (this.evaluateCondition(content, rule.condition, rule.value)) {
          result = rule.action === 'replace' ? rule.replacement : result;
        }
      }
    });
    
    return result;
  }

  /**
   * Evaluate a conditional rule
   */
  evaluateCondition(content, condition, value) {
    const text = String(content).toLowerCase();
    const checkValue = String(value).toLowerCase();
    
    switch (condition) {
      case 'contains': return text.includes(checkValue);
      case 'starts_with': return text.startsWith(checkValue);
      case 'ends_with': return text.endsWith(checkValue);
      case 'equals': return text === checkValue;
      case 'length_greater': return content.length > parseInt(value);
      case 'length_less': return content.length < parseInt(value);
      default: return false;
    }
  }

  /**
   * Smart truncation that preserves meaning
   */
  smartTruncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    
    // Try to break at word boundaries
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.7) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  /**
   * Export transformed data as CardForge CSV
   * @param {Array} transformedData - Transformed data array
   * @returns {String} CSV string ready for CardForge
   */
  exportToCardForgeCSV(transformedData) {
    console.log('📤 Exporting to CardForge CSV format...');
    
    const headers = ['Locale', 'items/0/title', 'items/0/subtitle', 'items/0/narratorText'];
    const csvRows = [headers.join(',')];
    
    transformedData.forEach(row => {
      // Map our field names to TileForge expected field names
      const mappedRow = {
        'Locale': row.locale,
        'items/0/title': row.headline,
        'items/0/subtitle': row.subheadline,
        'items/0/narratorText': row.narrator
      };
      
      const csvRow = headers.map(header => {
        const value = String(mappedRow[header] || '');
        // Escape quotes and wrap in quotes if contains comma
        return value.includes(',') || value.includes('"') 
          ? `"${value.replace(/"/g, '""')}"` 
          : value;
      });
      csvRows.push(csvRow.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    console.log('✅ CardForge CSV export complete');
    return csvContent;
  }

  /**
   * Update field mappings
   */
  updateFieldMappings(mappings) {
    this.fieldMappings = { ...mappings };
    console.log('🔁 Field mappings updated:', this.fieldMappings);
  }

  /**
   * Add conditional rule
   */
  addConditionalRule(rule) {
    this.conditionalRules.push({
      id: Date.now(),
      enabled: true,
      ...rule
    });
    console.log('➕ Conditional rule added:', rule);
  }

  /**
   * Remove conditional rule
   */
  removeConditionalRule(ruleId) {
    this.conditionalRules = this.conditionalRules.filter(rule => rule.id !== ruleId);
    console.log('➖ Conditional rule removed:', ruleId);
  }

  /**
   * Get preview of transformation
   */
  getPreview(csvData, maxRows = 5) {
    const transformedData = this.transformData(csvData);
    return transformedData.slice(0, maxRows);
  }

  /**
   * Normalize Language/Region to a supported culture code in LOCALE_MAP
   * Falls back to the first matching code by language prefix when region is missing/unsupported
   */
  resolveLocale(row) {
    try {
      const localeRaw = (row.Locale || row.locale || '').toString().trim();
      const langRaw = (row.Language || '').toString().trim();
      const regRaw = (row.Region || '').toString().trim();
      const lang = langRaw.toUpperCase();
      const region = regRaw.toUpperCase();
      let culture = '';

      // Prefer explicit Language/Region if present
      if (lang && region) {
        culture = `${lang}-${region}`;
      } else if (localeRaw) {
        // Accept a single 'Locale' field like 'en-us' or 'EN_us'
        culture = localeRaw.replace('_', '-').toUpperCase();
      } else if (lang) {
        culture = lang; // will be resolved by prefix
      }

      const map = (window.TileForgeLocales && window.TileForgeLocales.LOCALE_MAP) ? window.TileForgeLocales.LOCALE_MAP : null;
      if (!map) return culture || (row.locale || '');

      // Direct hit
      if (culture && map[culture]) return culture;

      // Try normalized hyphenation/casing
      const norm = culture.replace('_', '-').toUpperCase();
      if (map[norm]) return norm;

      // Prefer template-canonical mapping when only language matches or region differs
      try {
        const mode = this.getActiveTemplateMode();
        if (window.TileForgeLocales && typeof window.TileForgeLocales.getDefaultSet === 'function') {
          const preferredOrder = window.TileForgeLocales.getDefaultSet(mode) || [];
          if (lang) {
            const canonical = preferredOrder.find(k => k.startsWith(`${lang}-`));
            if (canonical && map[canonical]) return canonical;
          }
        }
      } catch (_) {}

      // If only language provided or unsupported region, pick first key with that language prefix (global fallback)
      if (lang) {
        const match = Object.keys(map).find(k => k.startsWith(`${lang}-`));
        if (match) return match;
      }

      // As a last resort, return the input culture or empty string
      return culture || '';
    } catch (_) {
      return (row.Region && row.Language) ? `${row.Language}-${row.Region}` : (row.Language || '');
    }
  }

  /**
   * Determine active template mode from UI and map to TileForgeLocales set name
   */
  getActiveTemplateMode() {
    try {
      // Prefer mapper override when set
      if (this.templateOverrideMode === 'toh' || this.templateOverrideMode === 'mobile') {
        return this.templateOverrideMode;
      }
      const active = document.querySelector('.template-option.active');
      const tpl = active ? (active.getAttribute('data-template') || '').toLowerCase() : 'toh';
      if (tpl === 'mobile-spotlight') return 'mobile';
      return 'toh';
    } catch (_) {
      return 'toh';
    }
  }

  /**
   * Set mapper-only template override (null to clear)
   */
  setTemplateOverrideMode(mode) {
    if (mode === 'toh' || mode === 'mobile') {
      this.templateOverrideMode = mode;
    } else {
      this.templateOverrideMode = null;
    }
  }
}

// Initialize global instance
window.headlinerCrafter = new HeadlinerCrafter();

console.log('🎯 Headliner Crafter module loaded (Clean Version - No Approval Workflow)');
