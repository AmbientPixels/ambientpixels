/**
 * TileForge Headliner Crafter - Clean Version (No Approval Workflow)
 * Transforms raw localization CSV data into CardForge-compatible format
 * Simple workflow: Upload → Configure → Export
 */

class HeadlinerCrafter {
  constructor() {
    this.currentData = null;
    this.fieldMappings = {
      'Title': 'headline',
      'MiniFAD': 'headline', 
      'Description': 'subheadline',
      'Narrator': 'narrator'
    };
    this.conditionalRules = [];
    
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
      if (row.Region && row.Language) {
        analysis.locales.add(`${row.Language}-${row.Region}`);
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
  transformData(csvData) {
    console.log('🔄 Transforming data with current mappings...');
    
    const transformedData = csvData.map(row => {
      const transformed = {
        locale: row.Region ? `${row.Language}-${row.Region}` : row.Language,
        headline: '',
        subheadline: '',
        narrator: ''
      };

      // Apply field mappings
      Object.entries(this.fieldMappings).forEach(([sourceField, targetField]) => {
        if (row[sourceField]) {
          transformed[targetField] = this.applyConditionalRules(row[sourceField], sourceField, row);
        }
      });

      // Skip smart truncation to preserve full text without ellipses
      // transformed.headline = this.smartTruncate(transformed.headline, 45);
      // transformed.subheadline = this.smartTruncate(transformed.subheadline, 35);
      // transformed.narrator = this.smartTruncate(transformed.narrator, 60);

      return transformed;
    });

    console.log('✅ Data transformation complete:', transformedData.length, 'rows');
    return transformedData;
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
    console.log('🔄 Field mappings updated:', this.fieldMappings);
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
}

// Initialize global instance
window.headlinerCrafter = new HeadlinerCrafter();

console.log('🎯 Headliner Crafter module loaded (Clean Version - No Approval Workflow)');
