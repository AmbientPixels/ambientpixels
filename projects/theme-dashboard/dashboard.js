// Theme Dashboard - Main JavaScript
import { themeManager } from './theme-manager.js';

// Debug Utilities
const debug = {
  enabled: true,
  log: function(...args) {
    if (this.enabled) {
      console.log('%c[Theme Dashboard]', 'color: #8e2de2; font-weight: bold;', ...args);
    }
  },
  error: function(...args) {
    console.error('%c[Theme Dashboard]', 'color: #ff3860; font-weight: bold;', ...args);
  },
  warn: function(...args) {
    console.warn('%c[Theme Dashboard]', 'color: #ffdd57; font-weight: bold;', ...args);
  },
  time: function(label) {
    if (this.enabled) console.time(`[Theme Dashboard] ${label}`);
  },
  timeEnd: function(label) {
    if (this.enabled) console.timeEnd(`[Theme Dashboard] ${label}`);
  }
};

// Convert RGBA to Hex (without alpha)
function rgbaToHex(rgba) {
  // Extract r, g, b values from rgba string
  const rgbaValues = rgba.match(/\d+/g);
  if (!rgbaValues || rgbaValues.length < 3) return '#000000';
  
  const [r, g, b] = rgbaValues.map(Number);
  return '#' + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

class ThemeDashboard {
  constructor() {
    this.themeConfig = null;
    this.currentSection = 'colors';
    this.initElements();
    this.bindEvents();
    this.loadThemeConfig();
  }

  initElements() {
    // Navigation
    this.navLinks = document.querySelectorAll('.theme-sections a');
    this.sections = document.querySelectorAll('.section-content');
    
    // Buttons
    this.saveBtn = document.getElementById('save-theme');
    this.resetBtn = document.getElementById('reset-theme');
    this.copyJsonBtn = document.getElementById('copy-json');
    this.downloadJsonBtn = document.getElementById('download-json');
    this.importJsonBtn = document.getElementById('import-json');
    this.togglePreviewBtn = document.getElementById('toggle-preview');
    this.addHeroStopBtn = document.getElementById('add-hero-stop');
    this.addParticleColorBtn = document.getElementById('add-particle-color');
    
    // Preset Buttons
    this.presetButtons = document.querySelectorAll('.preset-btn');
    
    // Form Elements
    this.themeJsonTextarea = document.getElementById('theme-json');
    this.particlesEnabled = document.getElementById('particles-enabled');
    this.particleCount = document.getElementById('particle-count');
    this.particleCountValue = document.getElementById('particle-count-value');
    this.particleSpeed = document.getElementById('particle-speed');
    this.particleSpeedValue = document.getElementById('particle-speed-value');
    
    // Preview Elements
    this.previewHero = document.getElementById('preview-hero');
    this.previewParticles = document.getElementById('preview-particles');
    this.heroGradientPreview = document.getElementById('hero-gradient-preview');
    this.heroGradientStops = document.getElementById('hero-gradient-stops');
    this.particleColorsList = document.querySelector('.color-list');
  }

  bindEvents() {
    // Navigation
    this.navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchSection(link.dataset.section);
      });
    });
    
    // Preset Buttons
    this.presetButtons.forEach(button => {
      button.addEventListener('click', () => {
        const preset = button.dataset.preset;
        this.applyPreset(preset);
      });
    });

    // Buttons
    this.saveBtn.addEventListener('click', () => this.saveTheme());
    this.resetBtn.addEventListener('click', () => this.resetTheme());
    this.copyJsonBtn.addEventListener('click', () => this.copyThemeJson());
    this.downloadJsonBtn.addEventListener('click', () => this.downloadThemeJson());
    this.importJsonBtn.addEventListener('change', (e) => this.importThemeJson(e));
    this.togglePreviewBtn.addEventListener('click', () => this.toggleFullscreenPreview());
    this.addHeroStopBtn.addEventListener('click', () => this.addGradientStop());
    this.addParticleColorBtn.addEventListener('click', () => this.addParticleColor());

    // Color Inputs
    document.addEventListener('input', (e) => {
      if (e.target.matches('input[type="color"]')) {
        const hexInput = document.getElementById(`${e.target.id}-hex`);
        if (hexInput) {
          hexInput.value = e.target.value;
        }
        this.updatePreview();
      }
    });

    // Text Inputs
    document.addEventListener('change', (e) => {
      if (e.target.matches('input[type="text"][id$="-hex"]')) {
        const colorInput = document.getElementById(e.target.id.replace('-hex', ''));
        if (colorInput && this.isValidHex(e.target.value)) {
          colorInput.value = e.target.value;
          this.updatePreview();
        }
      }
    });

    // Range Inputs
    this.particleCount.addEventListener('input', (e) => {
      this.particleCountValue.textContent = e.target.value;
      this.updateThemeConfig('particles.count', parseInt(e.target.value));
    });

    this.particleSpeed.addEventListener('input', (e) => {
      this.particleSpeedValue.textContent = e.target.value;
      this.updateThemeConfig('particles.speed', parseFloat(e.target.value));
    });

    // Toggle Switches
    this.particlesEnabled.addEventListener('change', (e) => {
      this.updateThemeConfig('particles.enabled', e.target.checked);
    });
  }

  async loadThemeConfig() {
    try {
      const response = await fetch('/projects/config/theme-config.json');
      if (!response.ok) throw new Error('Failed to load theme config');
      
      this.themeConfig = await response.json();
      this.updateUI();
      this.updatePreview();
      this.updateThemeJson();
    } catch (error) {
      console.error('Error loading theme config:', error);
      alert('Failed to load theme configuration. Please check the console for details.');
    }
  }

  updateUI() {
    if (!this.themeConfig) return;

    const { colors, gradients, particles, typography } = this.themeConfig;

    // Update color inputs
    Object.entries(colors.primary).forEach(([key, value]) => {
      const input = document.getElementById(`color-primary-${key}`);
      const hexInput = document.getElementById(`color-primary-${key}-hex`);
      if (input && hexInput) {
        input.value = value;
        hexInput.value = value;
      }
    });

    // Update gradient preview
    this.updateGradientPreview(gradients.hero.value);

    // Update particle settings
    if (particles) {
      this.particlesEnabled.checked = particles.enabled;
      this.particleCount.value = particles.count;
      this.particleCountValue.textContent = particles.count;
      this.particleSpeed.value = particles.speed;
      this.particleSpeedValue.textContent = particles.speed;
      
      // Update particle colors
      this.updateParticleColors(particles.colors);
    }
  }

  updateGradientPreview(gradientValue) {
    if (!gradientValue) return;
    
    // Update preview element
    if (this.heroGradientPreview) {
      this.heroGradientPreview.style.background = gradientValue;
    }
    
    // Update gradient stops
    if (this.heroGradientStops) {
      this.heroGradientStops.innerHTML = '';
      
      // Extract colors from gradient
      const colors = this.extractColorsFromGradient(gradientValue);
      
      colors.forEach((color, index) => {
        const stopElement = document.createElement('div');
        stopElement.className = 'gradient-stop';
        stopElement.innerHTML = `
          <div class="gradient-stop-color" style="background: ${color}"></div>
          <span>${color}</span>
          <button class="gradient-stop-remove" data-index="${index}">&times;</button>
        `;
        
        // Add event listener for color picker
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = this.rgbToHex(color) || '#ffffff';
        colorInput.className = 'gradient-stop-picker';
        colorInput.dataset.index = index;
        
        colorInput.addEventListener('input', (e) => {
          const newColor = e.target.value;
          const colorSpan = stopElement.querySelector('span');
          const colorBox = stopElement.querySelector('.gradient-stop-color');
          
          colorSpan.textContent = newColor;
          colorBox.style.background = newColor;
          
          // Update gradient with new color
          colors[index] = newColor;
          this.updateGradient(colors);
        });
        
        // Add remove button handler
        const removeBtn = stopElement.querySelector('.gradient-stop-remove');
        removeBtn.addEventListener('click', () => {
          if (colors.length > 2) {
            colors.splice(index, 1);
            this.updateGradient(colors);
          } else {
            alert('A gradient must have at least 2 color stops');
          }
        });
        
        // Add color picker trigger
        const colorBox = stopElement.querySelector('.gradient-stop-color');
        colorBox.addEventListener('click', () => {
          colorInput.click();
        });
        
        stopElement.appendChild(colorInput);
        this.heroGradientStops.appendChild(stopElement);
      });
    }
  }

  addGradientStop() {
    const colors = this.extractColorsFromGradient(this.themeConfig.gradients.hero.value);
    const newColor = this.getRandomColor();
    colors.push(newColor);
    this.updateGradient(colors);
  }

  updateGradient(colors) {
    const gradientValue = `linear-gradient(135deg, ${colors.join(', ')})`;
    this.themeConfig.gradients.hero.value = gradientValue;
    this.updateGradientPreview(gradientValue);
    this.updatePreview();
    this.updateThemeJson();
  }

  updateParticleColors(colors) {
    if (!this.particleColorsList) return;
    
    this.particleColorsList.innerHTML = '';
    
    colors.forEach((color, index) => {
      const colorItem = document.createElement('div');
      colorItem.className = 'color-item';
      colorItem.innerHTML = `
        <input type="color" value="${color}" data-index="${index}">
        <span>${color}</span>
        <button class="btn btn-sm btn-outline remove-color" data-index="${index}">
          <i class="fas fa-times"></i>
        </button>
      `;
      
      // Add color change handler
      const colorInput = colorItem.querySelector('input[type="color"]');
      colorInput.addEventListener('input', (e) => {
        const newColor = e.target.value;
        const colorSpan = colorItem.querySelector('span');
        colorSpan.textContent = newColor;
        
        // Update theme config
        this.themeConfig.particles.colors[index] = newColor;
        this.updatePreview();
        this.updateThemeJson();
      });
      
      // Add remove button handler
      const removeBtn = colorItem.querySelector('.remove-color');
      removeBtn.addEventListener('click', () => {
        if (this.themeConfig.particles.colors.length > 1) {
          this.themeConfig.particles.colors.splice(index, 1);
          this.updateParticleColors(this.themeConfig.particles.colors);
          this.updatePreview();
          this.updateThemeJson();
        } else {
          alert('At least one color is required');
        }
      });
      
      this.particleColorsList.appendChild(colorItem);
    });
  }

  addParticleColor() {
    if (!this.themeConfig.particles.colors) {
      this.themeConfig.particles.colors = [];
    }
    this.themeConfig.particles.colors.push(this.getRandomColor());
    this.updateParticleColors(this.themeConfig.particles.colors);
    this.updatePreview();
    this.updateThemeJson();
  }

  updatePreview() {
    // Update hero gradient
    if (this.previewHero && this.themeConfig.gradients.hero) {
      this.previewHero.style.background = this.themeConfig.gradients.hero.value;
    }
    
    // Update particle preview
    if (this.previewParticles && this.themeConfig.particles) {
      // In a real implementation, you would update the particle system here
      // For now, we'll just update a data attribute for CSS
      this.previewParticles.setAttribute('data-particles-enabled', this.themeConfig.particles.enabled);
    }
  }

  updateThemeJson() {
    if (this.themeJsonTextarea) {
      this.themeJsonTextarea.value = JSON.stringify(this.themeConfig, null, 2);
    }
  }

  async saveTheme() {
    try {
      // In a real implementation, you would save this to your backend
      // For now, we'll just show a success message
      console.log('Saving theme:', this.themeConfig);
      alert('Theme saved successfully! (This is a demo - in a real app, this would save to your backend)');
    } catch (error) {
      console.error('Error saving theme:', error);
      alert('Failed to save theme. Please check the console for details.');
    }
  }

  resetTheme() {
    if (confirm('Are you sure you want to reset all theme settings to default?')) {
      this.loadThemeConfig();
    }
  }

  copyThemeJson() {
    this.themeJsonTextarea.select();
    document.execCommand('copy');
    
    // Show copied feedback
    const originalText = this.copyJsonBtn.innerHTML;
    this.copyJsonBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
    
    setTimeout(() => {
      this.copyJsonBtn.innerHTML = originalText;
    }, 2000);
  }

  downloadThemeJson() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.themeConfig, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute('href', dataStr);
    downloadAnchorNode.setAttribute('download', 'theme-config.json');
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  importThemeJson(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedConfig = JSON.parse(e.target.result);
        this.themeConfig = importedConfig;
        this.updateUI();
        this.updatePreview();
        this.updateThemeJson();
        alert('Theme imported successfully!');
      } catch (error) {
        console.error('Error importing theme:', error);
        alert('Invalid theme file. Please check the format and try again.');
      }
    };
    reader.readAsText(file);
    
    // Reset the input so the same file can be imported again if needed
    event.target.value = '';
  }

  toggleFullscreenPreview() {
    const previewPanel = document.querySelector('.preview-panel');
    previewPanel.classList.toggle('fullscreen');
    
    const icon = this.togglePreviewBtn.querySelector('i');
    if (previewPanel.classList.contains('fullscreen')) {
      icon.classList.remove('fa-expand');
      icon.classList.add('fa-compress');
    } else {
      icon.classList.remove('fa-compress');
      icon.classList.add('fa-expand');
    }
  }

  switchSection(sectionId) {
    // Update active nav link
    this.navLinks.forEach(link => {
      if (link.dataset.section === sectionId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
    
    // Show active section
    this.sections.forEach(section => {
      if (section.id === sectionId) {
        section.classList.add('active');
      } else {
        section.classList.remove('active');
      }
    });
    
    this.currentSection = sectionId;
  }

  updateThemeConfig(path, value) {
    const pathParts = path.split('.');
    let current = this.themeConfig;
    
    for (let i = 0; i < pathParts.length - 1; i++) {
      if (!current[pathParts[i]]) {
        current[pathParts[i]] = {};
      }
      current = current[pathParts[i]];
    }
    
    current[pathParts[pathParts.length - 1]] = value;
    this.updatePreview();
    this.updateThemeJson();
  }

  // Deep merge utility
  deepMerge(target, source) {
    debug.log('Merging objects:', { target, source });
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
  
  // Check if value is an object
  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  // Preset Methods
  applyPreset(presetName) {
    debug.time(`Applying preset: ${presetName}`);
    
    const presets = {
      default: {
        gradients: {
          hero: {
            value: 'linear-gradient(135deg, #654ea3, #eaafc8)'
          }
        },
        colors: {
          primary: {
            main: '#8e2de2',
            light: '#b366ff',
            dark: '#5c00b3'
          },
          secondary: {
            main: '#eaafc8',
            light: '#ffe1f0',
            dark: '#b77f9e'
          }
        },
        particles: {
          colors: [
            '#c87bff',
            '#aa64ff',
            '#8c3cff'
          ]
        }
      },
      ocean: {
        gradients: {
          hero: {
            value: 'linear-gradient(135deg, #00c6ff, #0072ff)'
          }
        },
        colors: {
          primary: {
            main: '#0072ff',
            light: '#5aa2ff',
            dark: '#0045b3'
          },
          secondary: {
            main: '#00c6ff',
            light: '#5dd9ff',
            dark: '#0095cc'
          }
        },
        particles: {
          colors: [
            '#00c6ff',
            '#0072ff',
            '#0050c8'
          ]
        }
      },
      sunset: {
        gradients: {
          hero: {
            value: 'linear-gradient(135deg, #ff6b6b, #ffa3a3)'
          }
        },
        colors: {
          primary: {
            main: '#ff6b6b',
            light: '#ff9e9e',
            dark: '#cc5656'
          },
          secondary: {
            main: '#ffa3a3',
            light: '#ffc4c4',
            dark: '#cc8282'
          }
        },
        particles: {
          colors: [
            '#ff6b6b',
            '#ffa3a3',
            '#ffc8c8'
          ]
        }
      },
      forest: {
        gradients: {
          hero: {
            value: 'linear-gradient(135deg, #2ecc71, #27ae60)'
          }
        },
        colors: {
          primary: {
            main: '#2ecc71',
            light: '#5cdd94',
            dark: '#25a35a'
          },
          secondary: {
            main: '#27ae60',
            light: '#4fc27d',
            dark: '#1e8b4d'
          }
        },
        particles: {
          colors: [
            '#2ecc71',
            '#27ae60',
            '#219653'
          ]
        }
      }
    };

    if (presets[presetName]) {
      try {
        debug.log(`Applying preset: ${presetName}`, presets[presetName]);
        
        // Create a deep copy of the current config
        const newConfig = JSON.parse(JSON.stringify(this.themeConfig));
        
        // Merge the preset
        this.themeConfig = this.deepMerge(newConfig, presets[presetName]);
        
        debug.log('Merged config:', this.themeConfig);
        
        // Update the UI
        this.updateUI();
        this.updatePreview();
        this.updateThemeJson();
        
        // Show feedback
        const button = document.querySelector(`.preset-btn[data-preset="${presetName}"]`);
        if (button) {
          const span = button.querySelector('span');
          if (span) {
            const originalText = span.textContent;
            span.textContent = '✓ Applied!';
            
            // Reset button text after delay
            setTimeout(() => {
              span.textContent = originalText;
            }, 1500);
          }
        }
        
        debug.timeEnd(`Applying preset: ${presetName}`);
      } catch (error) {
        debug.error('Error applying preset:', error);
        // Show error to user
        alert(`Failed to apply preset: ${error.message}`);
      }
    } else {
      debug.warn(`Preset not found: ${presetName}`);
    }
  }

  // Helper Methods
  extractColorsFromGradient(gradient) {
    if (!gradient) return [];
    
    // Simple regex to extract colors from gradient
    const colorMatches = gradient.match(/#[0-9a-fA-F]{3,6}|rgba?\([^)]+\)/g) || [];
    return colorMatches;
  }

  getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color + '80'; // Add some transparency
  }

  isValidHex(color) {
    return /^#([0-9A-F]{3}){1,2}$/i.test(color) || 
           /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i.test(color) ||
           /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[01]?\d?\d(?:.\d+)?\s*\)$/i.test(color);
  }

  rgbToHex(rgb) {
    // If it's already a hex color, return it
    if (rgb.startsWith('#')) return rgb;
    
    // Convert rgb/rgba to hex
    const rgbMatch = rgb.match(/\d+/g);
    if (rgbMatch && rgbMatch.length >= 3) {
      const r = parseInt(rgbMatch[0]).toString(16).padStart(2, '0');
      const g = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
      const b = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`;
    }
    
    return '#ffffff';
  }
}

// Initialize the dashboard when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const dashboard = new ThemeDashboard();
  
  // Make it globally available for debugging
  window.dashboard = dashboard;
});
