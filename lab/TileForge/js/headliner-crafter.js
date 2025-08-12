/**
 * Headliner Crafter - Core mapping logic and conditional rules engine
 * Transforms raw localization data into CardForge-compatible format
 */

class HeadlinerCrafter {
  constructor() {
    this.mappingConfig = {
      rules: [
        {
          name: "Promotional Priority",
          condition: "hasPercentage",
          mapping: { "MiniFAD": "headline", "Title": "subheadline", "Description": "narrator" },
          priority: 1
        },
        {
          name: "Default Mapping",
          condition: "default",
          mapping: { "Title": "headline", "Description": "subheadline", "MiniFAD": "narrator" },
          priority: 10
        }
      ],
      localeOverrides: {},
      globalSettings: {
        enableSmartTruncation: true,
        preservePromotionalText: true,
        maxFieldLengths: {
          headline: 50,
          subheadline: 80,
          narrator: 150
        }
      }
    };
    
    this.conditions = {
      hasPercentage: (text) => /\d+%/.test(text || ''),
      isShort: (text) => (text || '').length < 30,
      isPromotional: (text) => /sale|offer|discount|save|deal/i.test(text || ''),
      hasDate: (text) => /\d{1,2}\/\d{1,2}/.test(text || ''),
      isEmpty: (text) => !text || text.trim().length === 0
    };
    
    this.approvalState = {
      status: 'draft', // draft, pending, approved, rejected
      reviewer: null,
      timestamp: null,
      comments: [],
      mappingSnapshot: null
    };
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
      if (row.Region && row.Language) {
        analysis.locales.add(`${row.Language.toUpperCase()}-${row.Region.toUpperCase()}`);
      }
      
      // Analyze field characteristics
      ['Title', 'Description', 'MiniFAD'].forEach(field => {
        if (!analysis.fieldAnalysis[field]) {
          analysis.fieldAnalysis[field] = {
            avgLength: 0,
            hasPercentage: 0,
            isPromotional: 0,
            isEmpty: 0,
            samples: []
          };
        }
        
        const text = row[field] || '';
        const fieldStats = analysis.fieldAnalysis[field];
        
        fieldStats.avgLength += text.length;
        if (this.conditions.hasPercentage(text)) fieldStats.hasPercentage++;
        if (this.conditions.isPromotional(text)) fieldStats.isPromotional++;
        if (this.conditions.isEmpty(text)) fieldStats.isEmpty++;
        
        if (fieldStats.samples.length < 3) {
          fieldStats.samples.push(text);
        }
      });
    });

    // Calculate averages
    Object.keys(analysis.fieldAnalysis).forEach(field => {
      analysis.fieldAnalysis[field].avgLength /= csvData.length;
    });

    // Generate mapping suggestions
    analysis.suggestedMappings = this.generateMappingSuggestions(analysis.fieldAnalysis);
    
    console.log('✅ Data analysis complete:', analysis);
    return analysis;
  }

  /**
   * Generate intelligent mapping suggestions based on data analysis
   * @param {Object} fieldAnalysis - Analysis results for each field
   * @returns {Array} Suggested mapping rules
   */
  generateMappingSuggestions(fieldAnalysis) {
    const suggestions = [];
    
    // If MiniFAD has high percentage content, suggest promotional mapping
    if (fieldAnalysis.MiniFAD?.hasPercentage > fieldAnalysis.MiniFAD?.isEmpty) {
      suggestions.push({
        name: "Promotional Focus",
        reason: "MiniFAD contains promotional content (percentages)",
        mapping: { "MiniFAD": "headline", "Title": "subheadline", "Description": "narrator" },
        confidence: 0.8
      });
    }
    
    // If Title is consistently short, suggest as headline
    if (fieldAnalysis.Title?.avgLength < 40) {
      suggestions.push({
        name: "Title-First Mapping",
        reason: "Title field is concise and suitable for headlines",
        mapping: { "Title": "headline", "Description": "subheadline", "MiniFAD": "narrator" },
        confidence: 0.7
      });
    }
    
    return suggestions;
  }

  /**
   * Apply mapping rules to transform data
   * @param {Array} csvData - Raw CSV data
   * @param {Object} customMapping - Optional custom mapping override
   * @returns {Array} Transformed CardForge-compatible data
   */
  transformData(csvData, customMapping = null) {
    console.log('🔄 Transforming data with mapping rules...');
    
    const mapping = customMapping || this.getActiveMapping();
    const transformedData = [];
    
    csvData.forEach(row => {
      const locale = this.buildLocaleCode(row);
      if (!locale) return; // Skip rows without valid locale info
      
      // Apply conditional logic to determine mapping
      const appliedMapping = this.applyConditionalMapping(row, mapping);
      
      // Transform the row
      const transformedRow = {
        locale: locale,
        headline: this.getFieldValue(row, appliedMapping.headline),
        subheadline: this.getFieldValue(row, appliedMapping.subheadline),
        narrator: this.getFieldValue(row, appliedMapping.narrator)
      };
      
      // Apply smart truncation if enabled
      if (this.mappingConfig.globalSettings.enableSmartTruncation) {
        transformedRow.headline = this.smartTruncate(transformedRow.headline, 'headline');
        transformedRow.subheadline = this.smartTruncate(transformedRow.subheadline, 'subheadline');
        transformedRow.narrator = this.smartTruncate(transformedRow.narrator, 'narrator');
      }
      
      transformedData.push(transformedRow);
    });
    
    console.log(`✅ Transformed ${transformedData.length} rows`);
    return transformedData;
  }

  /**
   * Apply conditional logic to determine field mapping for a specific row
   * @param {Object} row - Data row
   * @param {Object} baseMapping - Base mapping configuration
   * @returns {Object} Applied mapping for this row
   */
  applyConditionalMapping(row, baseMapping) {
    // Check each rule in priority order
    const sortedRules = this.mappingConfig.rules.sort((a, b) => a.priority - b.priority);
    
    for (const rule of sortedRules) {
      if (rule.condition === 'default') {
        return rule.mapping;
      }
      
      // Check if condition matches
      if (this.evaluateCondition(rule.condition, row)) {
        console.log(`📋 Applied rule: ${rule.name} for locale ${this.buildLocaleCode(row)}`);
        return rule.mapping;
      }
    }
    
    // Fallback to base mapping
    return baseMapping;
  }

  /**
   * Evaluate a condition against a data row
   * @param {String} conditionName - Name of condition to check
   * @param {Object} row - Data row to evaluate
   * @returns {Boolean} Whether condition is met
   */
  evaluateCondition(conditionName, row) {
    const condition = this.conditions[conditionName];
    if (!condition) return false;
    
    // Check condition against relevant fields
    const fields = ['Title', 'Description', 'MiniFAD'];
    return fields.some(field => condition(row[field]));
  }

  /**
   * Get field value with fallback logic
   * @param {Object} row - Data row
   * @param {String} sourceField - Source field name
   * @returns {String} Field value or fallback
   */
  getFieldValue(row, sourceField) {
    return row[sourceField] || '';
  }

  /**
   * Build locale code from region and language
   * @param {Object} row - Data row
   * @returns {String} Locale code (e.g., "EN-US")
   */
  buildLocaleCode(row) {
    if (!row.Language) return null;
    
    const language = row.Language.toUpperCase();
    const region = row.Region ? row.Region.toUpperCase() : language;
    
    return `${language}-${region}`;
  }

  /**
   * Smart truncation that preserves meaning
   * @param {String} text - Text to truncate
   * @param {String} fieldType - Type of field (headline, subheadline, narrator)
   * @returns {String} Truncated text
   */
  smartTruncate(text, fieldType) {
    if (!text) return '';
    
    const maxLength = this.mappingConfig.globalSettings.maxFieldLengths[fieldType];
    if (text.length <= maxLength) return text;
    
    // Preserve promotional content (percentages, discounts)
    if (this.mappingConfig.globalSettings.preservePromotionalText) {
      const promoMatch = text.match(/\d+%|save|discount|off/i);
      if (promoMatch) {
        // Try to keep promotional content
        const promoText = promoMatch[0];
        const remaining = maxLength - promoText.length - 3; // Account for ellipsis
        if (remaining > 10) {
          const prefix = text.substring(0, remaining).trim();
          return `${prefix}...${promoText}`;
        }
      }
    }
    
    // Standard truncation with word boundary
    const truncated = text.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.7) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  /**
   * Get the currently active mapping configuration
   * @returns {Object} Active mapping
   */
  getActiveMapping() {
    // Return default mapping for now
    return this.mappingConfig.rules.find(rule => rule.condition === 'default')?.mapping || {};
  }

  /**
   * Update mapping configuration
   * @param {Object} newConfig - New mapping configuration
   */
  updateMapping(newConfig) {
    this.mappingConfig = { ...this.mappingConfig, ...newConfig };
    console.log('📝 Mapping configuration updated');
  }

  /**
   * Export data in CardForge CSV format
   * @param {Array} transformedData - Transformed data
   * @returns {String} CSV string
   */
  exportToCardForgeCSV(transformedData) {
    const headers = ['Locale', 'items/0/title', 'items/0/subtitle'];
    const csvRows = [headers.join(',')];
    
    transformedData.forEach(row => {
      const csvRow = [
        row.locale,
        `"${row.headline}"`,
        `"${row.subheadline}"`
      ];
      csvRows.push(csvRow.join(','));
    });
    
    return csvRows.join('\n');
  }
}

// Global instance
window.HeadlinerCrafter = HeadlinerCrafter;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  if (!window.headlinerCrafter) {
    window.headlinerCrafter = new HeadlinerCrafter();
    console.log('🎯 Headliner Crafter initialized');
  }
});
