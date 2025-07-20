/**
 * Validation and Sanitization Utilities for CardForge
 * Created: 2025-07-05
 * 
 * Frontend version of validation utilities for client-side validation
 */

// Wrap in IIFE to prevent global scope pollution
(function(global) {
  'use strict';

  // Check if ValidationUtils is already defined
  if (global.ValidationUtils) {
    console.warn('ValidationUtils is already defined. Skipping redefinition.');
    return;
  }

  /**
   * Validates if a string is a proper URL
   * @param {string} url - The URL to validate
   * @returns {boolean} - True if valid URL format, false otherwise
   */
  function isValidUrl(url) {
    if (!url) return false;

    try {
      const urlObj = new URL(url);
      // Check for http or https protocol
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Validates if a URL points to an image file
   * @param {string} url - The URL to validate
   * @returns {boolean} - True if valid image URL format, false otherwise
   */
  function isValidImageUrl(url) {
    if (!isValidUrl(url)) return false;
    
    // Check for common image file extensions
    const imageExtensions = ['jpeg', 'jpg', 'gif', 'png', 'webp', 'svg', 'bmp'];
    const urlLower = url.toLowerCase();
    
    // Either ends with extension or has it in the path
    return imageExtensions.some(ext => 
      urlLower.endsWith('.' + ext) || 
      urlLower.includes('.' + ext + '?')
    );
  }

  /**
   * Validates if a string is non-empty after trimming
   * @param {string} value - The string to validate
   * @returns {boolean} - True if non-empty, false otherwise
   */
  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  /**
   * Validates string length
   * @param {string} value - The string to validate
   * @param {number} maxLength - Maximum allowed length
   * @returns {boolean} - True if within limits, false otherwise
   */
  function isValidLength(value, maxLength) {
    if (!value) return true; // Empty is valid, use isNonEmptyString to require non-empty
    return value.length <= maxLength;
  }

  /**
   * Validates a string length between min and max (inclusive)
   * @param {string} value - The string to validate
   * @param {number} minLength - Minimum allowed length
   * @param {number} maxLength - Maximum allowed length
   * @returns {boolean} - True if within specified length range after trimming
   */
  function isValidString(value, minLength, maxLength) {
    if (typeof value !== 'string') return false;
    const len = value.trim().length;
    if (len < minLength) return false;
    if (len > maxLength) return false;
    return true;
  }

  /**
   * Sanitizes user input to prevent XSS
   * @param {string} input - The user input to sanitize
   * @returns {string} - Sanitized input
   */
  function sanitizeString(input) {
    if (!input) return '';
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Validates a card object based on CardForge schema
   * @param {object} card - Card object to validate
   * @returns {Array} - Array of validation errors, empty if valid
   */
  function validateCard(card) {
    const errors = [];
    
    // Required fields
    if (!isNonEmptyString(card.name)) {
      errors.push('Card name is required');
    }
    
    if (!isNonEmptyString(card.class)) {
      errors.push('Card class is required');
    }
    
    // Length validation
    if (card.name && !isValidLength(card.name, 100)) {
      errors.push('Card name must be less than 100 characters');
    }
    
    if (card.class && !isValidLength(card.class, 50)) {
      errors.push('Card class must be less than 50 characters');
    }
    
    if (card.quote && !isValidLength(card.quote, 500)) {
      errors.push('Card quote must be less than 500 characters');
    }
    
    // URL validation
    if (card.avatar && !isValidImageUrl(card.avatar)) {
      errors.push('Avatar URL is not valid or not an image');
    }
    
    return errors;
  }

  /**
   * Sanitizes a card object
   * @param {object} card - Card object to sanitize
   * @returns {object} - Sanitized card object
   */
  function sanitizeCard(card) {
    return {
      ...card,
      name: sanitizeString(card.name || ''),
      class: sanitizeString(card.class || ''),
      quote: sanitizeString(card.quote || ''),
      avatar: sanitizeString(card.avatar || '')
    };
  }

  // Create the ValidationUtils object
  const ValidationUtils = {
    isValidUrl,
    isValidImageUrl,
    isNonEmptyString,
    isValidLength,
    isValidString,
    sanitizeString,
    validateCard,
    sanitizeCard
  };

  // Export to appropriate scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ValidationUtils;
  } else {
    global.ValidationUtils = ValidationUtils;
  }

})(typeof window !== 'undefined' ? window : this);

// Make available both as module export and global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ValidationUtils;
} else {
  // For browser usage
  window.ValidationUtils = ValidationUtils;
}
