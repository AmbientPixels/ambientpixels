/**
 * Theme Manager for Theme Dashboard
 * Handles loading, saving, and applying theme configurations
 */

class ThemeManager {
  constructor() {
    this.config = null;
    this.initialized = false;
  }

  /**
   * Initialize the theme manager
   * @param {Object} defaultConfig - Default theme configuration
   */
  async init(defaultConfig = null) {
    try {
      // In a real app, you would load from your API or config file
      // For now, we'll use the provided default config
      this.config = defaultConfig || await this.loadDefaultConfig();
      this.initialized = true;
      return this.config;
    } catch (error) {
      console.error('Error initializing theme manager:', error);
      throw error;
    }
  }

  /**
   * Load default theme configuration
   */
  async loadDefaultConfig() {
    try {
      const response = await fetch('/projects/config/theme-config.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error loading default theme config:', error);
      // Return a minimal default config as fallback
      return this.getFallbackConfig();
    }
  }

  /**
   * Get fallback configuration if loading fails
   */
  getFallbackConfig() {
    return {
      theme: {
        name: 'default',
        version: '1.0.0',
        lastUpdated: new Date().toISOString()
      },
      colors: {
        primary: {
          main: '#8e2de2',
          light: '#b366ff',
          dark: '#5c00b3'
        },
        // ... other fallback values
      }
      // ... rest of the config
    };
  }

  /**
   * Get the current theme configuration
   */
  getConfig() {
    if (!this.initialized) {
      console.warn('Theme manager not initialized. Call init() first.');
      return null;
    }
    return this.config;
  }

  /**
   * Update theme configuration
   * @param {Object} updates - Partial theme configuration to merge
   */
  updateConfig(updates) {
    if (!this.initialized) {
      console.warn('Theme manager not initialized. Call init() first.');
      return;
    }
    
    this.config = this.deepMerge(this.config, updates);
    this.applyTheme();
    return this.config;
  }

  /**
   * Apply the current theme to the document
   */
  applyTheme() {
    if (!this.initialized || !this.config) {
      console.warn('Theme not initialized. Call init() first.');
      return;
    }

    // Apply CSS variables
    this.applyCssVariables();
    
    // Initialize components with theme
    this.initializeComponents();
  }

  /**
   * Apply CSS custom properties from the theme
   */
  applyCssVariables() {
    const style = document.documentElement.style;
    const { colors, gradients } = this.config;

    // Apply color variables
    if (colors) {
      Object.entries(colors).forEach(([category, values]) => {
        if (typeof values === 'object') {
          Object.entries(values).forEach(([key, value]) => {
            if (value) {
              style.setProperty(`--color-${category}-${key}`, value);
            }
          });
        }
      });
    }

    // Apply gradient variables
    if (gradients) {
      Object.entries(gradients).forEach(([name, gradient]) => {
        if (gradient.value) {
          style.setProperty(`--gradient-${name}`, gradient.value);
        }
        if (gradient.glow) {
          style.setProperty(`--glow-${name}`, gradient.glow);
        }
      });
    }
  }

  /**
   * Initialize components with theme settings
   */
  initializeComponents() {
    const { particles } = this.config;

    // Initialize particles if enabled
    if (particles?.enabled && typeof HeroParticles !== 'undefined') {
      this.initializeParticles(particles);
    }
  }

  /**
   * Initialize particle effects
   */
  initializeParticles(settings) {
    const particleContainer = document.getElementById('hero-particles');
    if (!particleContainer) return;

    // Clear existing particles
    const existingParticles = particleContainer.querySelector('canvas');
    if (existingParticles) {
      existingParticles.remove();
    }

    // Initialize new particles
    new HeroParticles('hero-particles', {
      colors: settings.colors,
      speed: settings.speed,
      count: settings.count,
      minSize: settings.size?.min || 1,
      maxSize: settings.size?.max || 5
    });
  }

  /**
   * Deep merge two objects
   * @private
   */
  deepMerge(target, source) {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    
    return output;
  }

  
  /**
   * Check if a value is an object
   * @private
   */
  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }
}

// Export a singleton instance
export const themeManager = new ThemeManager();

// Initialize with default config when imported
// In a real app, you might want to initialize this in your main app code
themeManager.init().catch(console.error);
