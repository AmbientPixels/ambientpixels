/**
 * Theme Manager for Projects Section
 * Loads and applies theme configurations from theme-config.json
 */

class ThemeManager {
  constructor(configPath = '/projects/config/theme-config.json') {
    this.configPath = configPath;
    this.config = null;
    this.initialized = false;
  }

  async init() {
    try {
      const response = await fetch(this.configPath);
      if (!response.ok) {
        throw new Error(`Failed to load theme config: ${response.status}`);
      }
      this.config = await response.json();
      this.initialized = true;
      return this.config;
    } catch (error) {
      console.error('Error initializing theme manager:', error);
      return null;
    }
  }

  /**
   * Apply theme to the page
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
    const { colors, gradients, typography } = this.config;

    // Apply color variables
    Object.entries(colors).forEach(([category, values]) => {
      Object.entries(values).forEach(([key, value]) => {
        style.setProperty(`--color-${category}-${key}`, value);
      });
    });

    // Apply gradient variables
    Object.entries(gradients).forEach(([name, gradient]) => {
      if (gradient.value) {
        style.setProperty(`--gradient-${name}`, gradient.value);
      }
      if (gradient.glow) {
        style.setProperty(`--glow-${name}`, gradient.glow);
      }
    });

    // Apply typography
    Object.entries(typography).forEach(([type, styles]) => {
      if (typeof styles === 'object') {
        Object.entries(styles).forEach(([prop, value]) => {
          style.setProperty(`--font-${type}-${prop}`, value);
        });
      } else if (type === 'fontFamily') {
        style.setProperty('--font-family', styles);
      }
    });
  }

  /**
   * Initialize components with theme settings
   */
  initializeComponents() {
    const { particles, components } = this.config;

    // Initialize particles if enabled
    if (particles?.enabled && typeof HeroParticles !== 'undefined') {
      this.initializeParticles(particles);
    }

    // Apply component styles
    this.applyComponentStyles(components);
  }

  /**
   * Initialize particle effects
   */
  initializeParticles(settings) {
    const particleContainer = document.getElementById('hero-particles');
    if (!particleContainer) return;

    new HeroParticles('hero-particles', {
      colors: settings.colors,
      speed: settings.speed,
      count: settings.count,
      minSize: settings.size.min,
      maxSize: settings.size.max
    });
  }

  /**
   * Apply styles to components
   */
  applyComponentStyles(components) {
    // Badge styles
    if (components?.badge) {
      const { borderRadius, padding, fontSize, fontWeight } = components.badge;
      const style = document.createElement('style');
      style.textContent = `
        .hero-card-badge {
          border-radius: ${borderRadius};
          padding: ${padding};
          font-size: ${fontSize};
          font-weight: ${fontWeight};
        }
      `;
      document.head.appendChild(style);
    }

    // Add more component styles as needed
  }

  /**
   * Get a value from the theme configuration
   * @param {string} path - Dot notation path to the value (e.g., 'colors.primary.main')
   * @returns {*} The value from the config
   */
  getThemeValue(path) {
    if (!this.initialized) {
      console.warn('Theme not initialized. Call init() first.');
      return null;
    }

    return path.split('.').reduce((obj, key) => {
      return obj && obj[key] !== undefined ? obj[key] : null;
    }, this.config);
  }
}

// Create and export a singleton instance
const themeManager = new ThemeManager();

document.addEventListener('DOMContentLoaded', async () => {
  await themeManager.init();
  themeManager.applyTheme();
});

export default themeManager;
