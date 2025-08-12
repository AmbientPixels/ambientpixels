/**
 * Content Analyzer - Smart truncation and content analysis utilities
 * Preserves meaning when shortening text for CardForge fields
 */

class ContentAnalyzer {
  constructor() {
    this.preservationRules = {
      // High priority terms to preserve
      promotional: [
        /\d+%\s*(off|discount|save)/i,
        /save\s+up\s+to\s+\d+%/i,
        /\d+%\s*savings?/i,
        /free\s+(shipping|delivery)/i,
        /limited\s+time/i,
        /ends?\s+\d{1,2}\/\d{1,2}/i
      ],
      
      // Important keywords to keep
      keywords: [
        /ultimate|epic|super|mega|grande?/i,
        /new|latest|exclusive/i,
        /edition|version|collection/i,
        /game|add-?on|dlc|expansion/i
      ],
      
      // Structural elements
      punctuation: /[.!?]/g,
      numbers: /\d+/g,
      currencies: /[$€£¥]/g
    };
    
    this.truncationStrategies = {
      headline: {
        maxLength: 50,
        priority: ['promotional', 'keywords', 'numbers'],
        preserveEnd: true // Keep ending for promotional text
      },
      subheadline: {
        maxLength: 80,
        priority: ['keywords', 'promotional'],
        preserveEnd: false
      },
      narrator: {
        maxLength: 150,
        priority: ['promotional', 'keywords'],
        preserveEnd: true
      }
    };
  }

  /**
   * Analyze content quality and characteristics
   * @param {String} text - Text to analyze
   * @returns {Object} Analysis results
   */
  analyzeContent(text) {
    if (!text) return { isEmpty: true };
    
    const analysis = {
      length: text.length,
      wordCount: text.split(/\s+/).length,
      hasPromotional: this.hasPromotionalContent(text),
      hasNumbers: /\d/.test(text),
      hasCurrency: /[$€£¥]/.test(text),
      hasPercentage: /\d+%/.test(text),
      hasDate: /\d{1,2}\/\d{1,2}/.test(text),
      sentiment: this.analyzeSentiment(text),
      readabilityScore: this.calculateReadability(text),
      keyPhrases: this.extractKeyPhrases(text)
    };
    
    return analysis;
  }

  /**
   * Smart truncation that preserves meaning and important content
   * @param {String} text - Text to truncate
   * @param {String} fieldType - Type of field (headline, subheadline, narrator)
   * @param {Object} options - Truncation options
   * @returns {String} Intelligently truncated text
   */
  smartTruncate(text, fieldType, options = {}) {
    if (!text) return '';
    
    const strategy = this.truncationStrategies[fieldType] || this.truncationStrategies.narrator;
    const maxLength = options.maxLength || strategy.maxLength;
    
    if (text.length <= maxLength) return text;
    
    console.log(`🔪 Smart truncating ${fieldType}: "${text}" (${text.length} → ${maxLength})`);
    
    // Strategy 1: Preserve promotional content at the end
    if (strategy.preserveEnd && this.hasPromotionalContent(text)) {
      const result = this.preservePromotionalEnd(text, maxLength);
      if (result) return result;
    }
    
    // Strategy 2: Preserve key phrases
    const keyPreserved = this.preserveKeyPhrases(text, maxLength, strategy.priority);
    if (keyPreserved) return keyPreserved;
    
    // Strategy 3: Smart word boundary truncation
    return this.truncateAtWordBoundary(text, maxLength);
  }

  /**
   * Preserve promotional content at the end of text
   * @param {String} text - Original text
   * @param {Number} maxLength - Maximum allowed length
   * @returns {String|null} Truncated text or null if not applicable
   */
  preservePromotionalEnd(text, maxLength) {
    // Look for promotional content at the end
    const promoMatches = [];
    
    this.preservationRules.promotional.forEach(pattern => {
      const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))];
      matches.forEach(match => {
        promoMatches.push({
          text: match[0],
          index: match.index,
          length: match[0].length
        });
      });
    });
    
    if (promoMatches.length === 0) return null;
    
    // Find the last promotional match
    const lastPromo = promoMatches.sort((a, b) => b.index - a.index)[0];
    
    // Check if we can fit it with some prefix
    const promoText = lastPromo.text;
    const availableSpace = maxLength - promoText.length - 3; // Account for "..."
    
    if (availableSpace < 10) return null; // Not enough space for meaningful prefix
    
    // Extract prefix and combine
    const prefix = text.substring(0, availableSpace).trim();
    const lastSpace = prefix.lastIndexOf(' ');
    
    if (lastSpace > availableSpace * 0.7) {
      return prefix.substring(0, lastSpace) + '...' + promoText;
    }
    
    return prefix + '...' + promoText;
  }

  /**
   * Preserve key phrases during truncation
   * @param {String} text - Original text
   * @param {Number} maxLength - Maximum allowed length
   * @param {Array} priorities - Priority order for preservation
   * @returns {String|null} Truncated text or null if not applicable
   */
  preserveKeyPhrases(text, maxLength, priorities) {
    const keyPhrases = [];
    
    // Extract key phrases based on priority
    priorities.forEach(priority => {
      if (this.preservationRules[priority]) {
        this.preservationRules[priority].forEach(pattern => {
          const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))];
          matches.forEach(match => {
            keyPhrases.push({
              text: match[0],
              index: match.index,
              priority: priority,
              length: match[0].length
            });
          });
        });
      }
    });
    
    if (keyPhrases.length === 0) return null;
    
    // Sort by priority and position
    keyPhrases.sort((a, b) => {
      const priorityOrder = priorities.indexOf(a.priority) - priorities.indexOf(b.priority);
      return priorityOrder !== 0 ? priorityOrder : a.index - b.index;
    });
    
    // Try to fit the most important phrases
    let result = text;
    let totalSaved = 0;
    
    for (const phrase of keyPhrases) {
      if (result.length <= maxLength) break;
      
      // Try to preserve this phrase by truncating around it
      const beforePhrase = text.substring(0, phrase.index);
      const afterPhrase = text.substring(phrase.index + phrase.length);
      
      const availableSpace = maxLength - phrase.length - 3; // Account for ellipsis
      
      if (availableSpace > 20) { // Minimum meaningful content
        const prefixLength = Math.floor(availableSpace * 0.6);
        const suffixLength = availableSpace - prefixLength;
        
        const prefix = beforePhrase.length > prefixLength ? 
          beforePhrase.substring(0, prefixLength).trim() + '...' : 
          beforePhrase;
          
        const suffix = afterPhrase.length > suffixLength ? 
          '...' + afterPhrase.substring(afterPhrase.length - suffixLength).trim() : 
          afterPhrase;
        
        result = prefix + phrase.text + suffix;
        break;
      }
    }
    
    return result.length <= maxLength ? result : null;
  }

  /**
   * Truncate at word boundary with smart positioning
   * @param {String} text - Original text
   * @param {Number} maxLength - Maximum allowed length
   * @returns {String} Truncated text
   */
  truncateAtWordBoundary(text, maxLength) {
    if (text.length <= maxLength) return text;
    
    const truncated = text.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    const lastPunctuation = Math.max(
      truncated.lastIndexOf('.'),
      truncated.lastIndexOf('!'),
      truncated.lastIndexOf('?')
    );
    
    // Prefer punctuation boundary if it's reasonably close
    if (lastPunctuation > maxLength * 0.8) {
      return text.substring(0, lastPunctuation + 1);
    }
    
    // Use word boundary if it's not too short
    if (lastSpace > maxLength * 0.7) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    // Fallback to character truncation
    return truncated + '...';
  }

  /**
   * Check if text contains promotional content
   * @param {String} text - Text to check
   * @returns {Boolean} Whether text has promotional content
   */
  hasPromotionalContent(text) {
    return this.preservationRules.promotional.some(pattern => pattern.test(text));
  }

  /**
   * Extract key phrases from text
   * @param {String} text - Text to analyze
   * @returns {Array} Array of key phrases
   */
  extractKeyPhrases(text) {
    const phrases = [];
    
    Object.entries(this.preservationRules).forEach(([category, patterns]) => {
      if (Array.isArray(patterns)) {
        patterns.forEach(pattern => {
          const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))];
          matches.forEach(match => {
            phrases.push({
              text: match[0],
              category: category,
              index: match.index
            });
          });
        });
      }
    });
    
    return phrases.sort((a, b) => a.index - b.index);
  }

  /**
   * Analyze sentiment of text (basic implementation)
   * @param {String} text - Text to analyze
   * @returns {String} Sentiment classification
   */
  analyzeSentiment(text) {
    const positiveWords = /exciting|amazing|ultimate|epic|best|great|awesome|fantastic|incredible/i;
    const promotionalWords = /save|discount|offer|deal|sale|free|limited/i;
    const neutralWords = /game|edition|content|add-on|expansion/i;
    
    if (positiveWords.test(text)) return 'positive';
    if (promotionalWords.test(text)) return 'promotional';
    if (neutralWords.test(text)) return 'neutral';
    
    return 'neutral';
  }

  /**
   * Calculate basic readability score
   * @param {String} text - Text to analyze
   * @returns {Number} Readability score (0-100, higher is more readable)
   */
  calculateReadability(text) {
    const words = text.split(/\s+/).length;
    const sentences = text.split(/[.!?]+/).length;
    const avgWordsPerSentence = words / Math.max(sentences, 1);
    
    // Simple readability approximation
    // Shorter sentences and common words = higher score
    let score = 100;
    
    if (avgWordsPerSentence > 15) score -= 20;
    if (avgWordsPerSentence > 25) score -= 20;
    
    // Penalty for very long words
    const longWords = text.split(/\s+/).filter(word => word.length > 8).length;
    score -= (longWords / words) * 30;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Optimize text for a specific field type
   * @param {String} text - Original text
   * @param {String} fieldType - Target field type
   * @param {Object} options - Optimization options
   * @returns {String} Optimized text
   */
  optimizeForField(text, fieldType, options = {}) {
    if (!text) return '';
    
    let optimized = text;
    
    // Field-specific optimizations
    switch (fieldType) {
      case 'headline':
        // Headlines should be punchy and promotional
        optimized = this.enhanceHeadline(optimized);
        break;
        
      case 'subheadline':
        // Subheadlines should be descriptive but concise
        optimized = this.enhanceSubheadline(optimized);
        break;
        
      case 'narrator':
        // Narrator can be more detailed
        optimized = this.enhanceNarrator(optimized);
        break;
    }
    
    // Apply smart truncation
    return this.smartTruncate(optimized, fieldType, options);
  }

  /**
   * Enhance text for headline use
   * @param {String} text - Original text
   * @returns {String} Enhanced headline
   */
  enhanceHeadline(text) {
    // Prioritize promotional content for headlines
    if (this.hasPromotionalContent(text)) {
      // Move promotional content to the front if it's not already there
      const promoMatch = text.match(/\d+%\s*(off|discount|save)/i);
      if (promoMatch && text.indexOf(promoMatch[0]) > 10) {
        const withoutPromo = text.replace(promoMatch[0], '').trim();
        return `${promoMatch[0]} ${withoutPromo}`;
      }
    }
    
    return text;
  }

  /**
   * Enhance text for subheadline use
   * @param {String} text - Original text
   * @returns {String} Enhanced subheadline
   */
  enhanceSubheadline(text) {
    // Subheadlines should complement headlines
    // Remove redundant promotional content if it's likely in the headline
    return text;
  }

  /**
   * Enhance text for narrator use
   * @param {String} text - Original text
   * @returns {String} Enhanced narrator text
   */
  enhanceNarrator(text) {
    // Narrator can include full details
    return text;
  }
}

// Global instance
window.ContentAnalyzer = ContentAnalyzer;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  if (!window.contentAnalyzer) {
    window.contentAnalyzer = new ContentAnalyzer();
    console.log('🧠 Content Analyzer initialized');
  }
});
