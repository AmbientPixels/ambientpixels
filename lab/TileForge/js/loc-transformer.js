// TileForge Localization Transformer Module
// Handles CSV transformation from generic language data to TileForge-compatible locale format

/**
 * Localization Transformer Class
 * Converts mapping tables + source localization data into TileForge format
 */
class LocTransformer {
  constructor() {
    this.mappingRows = null;
    this.sourceRows = null;
    this.transformedRows = null;
  }

  /**
   * Parse CSV text with basic quote support
   * @param {string} text - Raw CSV text
   * @returns {Array} Array of row objects
   */
  parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = this.splitCSVLine(lines[0]);
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = this.splitCSVLine(lines[i]);
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }
    
    return rows;
  }

  /**
   * Split CSV line handling quotes and commas
   * @param {string} line - CSV line to split
   * @returns {Array} Array of field values
   */
  splitCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    result.push(current.trim());
    return result;
  }

  /**
   * Normalize string values for matching
   * @param {*} value - Value to normalize
   * @returns {string} Normalized uppercase trimmed string
   */
  upperTrim(value) {
    return value == null ? '' : String(value).toUpperCase().trim();
  }

  /**
   * Regular trim for non-matching fields
   * @param {*} value - Value to trim
   * @returns {string} Trimmed string
   */
  trim(value) {
    return value == null ? '' : String(value).trim();
  }

  /**
   * Load mapping table data
   * @param {string} csvText - Raw CSV text for mapping table
   * @returns {boolean} Success status
   */
  loadMappingTable(csvText) {
    try {
      this.mappingRows = this.parseCSV(csvText);
      console.log('📊 Mapping table loaded:', this.mappingRows.length, 'rows');
      return this.mappingRows.length > 0;
    } catch (error) {
      console.error('Error loading mapping table:', error);
      return false;
    }
  }

  /**
   * Load source localization data
   * @param {string} csvText - Raw CSV text for source data
   * @returns {boolean} Success status
   */
  loadSourceData(csvText) {
    try {
      this.sourceRows = this.parseCSV(csvText);
      console.log('📝 Source data loaded:', this.sourceRows.length, 'rows');
      return this.sourceRows.length > 0;
    } catch (error) {
      console.error('Error loading source data:', error);
      return false;
    }
  }

  /**
   * Transform loaded data into TileForge format
   * @returns {Object} Transformation result with success status and data
   */
  transform() {
    if (!this.mappingRows || !this.sourceRows) {
      return {
        success: false,
        error: 'Both mapping table and source data must be loaded first',
        data: null
      };
    }

    try {
      // Normalize mapping table data
      const map = this.mappingRows.map(r => ({ ...r }));
      map.forEach(r => {
        if ('Language' in r) r.Language = this.upperTrim(r.Language);
        if ('Country' in r) r.Country = this.upperTrim(r.Country);
        if ('LanguageLocale' in r) r.LanguageLocale = this.upperTrim(r.LanguageLocale);
      });

      // Normalize source data
      const src = this.sourceRows.map(r => ({ ...r }));
      src.forEach(r => {
        if ('Language' in r) r.Language = this.upperTrim(r.Language);
        if ('Region' in r) {
          r.Region = r.Region == null || r.Region === '' ? '' : this.upperTrim(r.Region);
        } else {
          r.Region = '';
        }
      });

      // Split source data by region presence
      const withRegion = src.filter(r => r.Region !== '');
      const withoutRegion = src.filter(r => r.Region === '').map(r => {
        const { Region, ...rest } = r;
        return rest;
      });

      // Join with region (Language+Region = Language+Country)
      const joinWithRegion = [];
      const mapByLangCountry = new Map();
      
      map.forEach(r => {
        const key = r.Language + '||' + r.Country;
        if (!mapByLangCountry.has(key)) mapByLangCountry.set(key, []);
        mapByLangCountry.get(key).push(r);
      });

      withRegion.forEach(sr => {
        const key = sr.Language + '||' + sr.Region;
        const matches = mapByLangCountry.get(key);
        if (matches) {
          matches.forEach(mr => {
            joinWithRegion.push({
              Language: sr.Language,
              LanguageLocale: mr.LanguageLocale,
              Title: sr.Title ?? '',
              MiniFAD: sr.MiniFAD ?? ''
            });
          });
        }
      });

      // Join without region (Language only)
      const joinWithoutRegionRaw = [];
      const mapByLanguage = new Map();
      
      map.forEach(r => {
        if (!mapByLanguage.has(r.Language)) mapByLanguage.set(r.Language, []);
        mapByLanguage.get(r.Language).push(r);
      });

      withoutRegion.forEach(sr => {
        const matches = mapByLanguage.get(sr.Language);
        if (matches) {
          matches.forEach(mr => {
            joinWithoutRegionRaw.push({
              Language: sr.Language,
              LanguageLocale: mr.LanguageLocale,
              Title: sr.Title ?? '',
              MiniFAD: sr.MiniFAD ?? ''
            });
          });
        }
      });

      // Anti-join: remove duplicates from language-only matching
      const regionLocales = new Set(joinWithRegion.map(r => r.LanguageLocale));
      const joinWithoutRegion = joinWithoutRegionRaw.filter(r => !regionLocales.has(r.LanguageLocale));

      // Combine and format for TileForge
      const combined = [...joinWithRegion, ...joinWithoutRegion];
      const finalRows = combined.map(r => ({
        'Locale': r.LanguageLocale,
        'items/0/title': r.Title,
        'items/0/subtitle': r.MiniFAD,
        'items/0/narratorText': ''
      })).sort((a, b) => a.Locale.localeCompare(b.Locale));

      // Add required header rows for TileForge compatibility
      const headerRow = {
        'Locale': 'Locale',
        'items/0/title': 'items/0/title',
        'items/0/subtitle': 'items/0/subtitle',
        'items/0/narratorText': 'items/0/narratorText'
      };
      
      const sampleRow = {
        'Locale': 'Locale',
        'items/0/title': 'WWWWWWWWWWWWWWW',
        'items/0/subtitle': 'WWWWWWWWWWWWWWW',
        'items/0/narratorText': 'Narrator Text'
      };

      this.transformedRows = [headerRow, sampleRow, ...finalRows];

      return {
        success: true,
        error: null,
        data: this.transformedRows,
        stats: {
          totalRows: finalRows.length,
          withRegion: joinWithRegion.length,
          withoutRegion: joinWithoutRegion.length,
          duplicatesRemoved: joinWithoutRegionRaw.length - joinWithoutRegion.length
        }
      };

    } catch (error) {
      return {
        success: false,
        error: 'Transformation failed: ' + (error.message || error),
        data: null
      };
    }
  }

  /**
   * Export transformed data as CSV string
   * @returns {string} CSV formatted string
   */
  exportCSV() {
    if (!this.transformedRows || this.transformedRows.length === 0) {
      return '';
    }

    const headers = Object.keys(this.transformedRows[0]);
    const csvLines = [
      headers.join(','),
      ...this.transformedRows.map(row => 
        headers.map(header => this.csvEscape(row[header])).join(',')
      )
    ];

    return csvLines.join('\n');
  }

  /**
   * Escape CSV field values
   * @param {*} value - Value to escape
   * @returns {string} Escaped CSV field
   */
  csvEscape(value) {
    const str = String(value == null ? '' : value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /**
   * Check if CSV data needs transformation (missing TileForge columns)
   * @param {string} csvText - Raw CSV text to analyze
   * @returns {boolean} True if transformation is needed
   */
  static needsTransformation(csvText) {
    try {
      const lines = csvText.trim().split('\n');
      if (lines.length < 1) return false;
      
      const headers = lines[0].toLowerCase();
      const requiredColumns = ['locale', 'items/0/title', 'items/0/subtitle'];
      
      return !requiredColumns.every(col => headers.includes(col));
    } catch (error) {
      console.error('Error checking transformation need:', error);
      return false;
    }
  }

  /**
   * Reset transformer state
   */
  reset() {
    this.mappingRows = null;
    this.sourceRows = null;
    this.transformedRows = null;
  }
}

// Export for use in other modules
window.LocTransformer = LocTransformer;

// Initialize global transformer instance
window.locTransformer = new LocTransformer();

console.log('🔄 Localization Transformer module loaded');
