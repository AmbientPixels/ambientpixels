// Hero Particles Effect
class HeroParticles {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.particles = [];
    this.options = {
      count: 80, // Doubled the particle count for more density
      colors: [
        'rgba(90, 228, 255, 0.4)',
        'rgba(0, 180, 255, 0.35)',
        'rgba(0, 120, 215, 0.3)',
        'rgba(0, 255, 200, 0.25)',
        'rgba(100, 220, 255, 0.3)',
        'rgba(70, 150, 255, 0.25)'
      ],
      minSize: 1.2,  // Smaller minimum size
      maxSize: 10,   // Larger maximum size for more variation
      speed: 0.2,    // Slightly faster movement
      sizeVariation: 0.6, // More size variation
      spawnAreaMultiplier: 1.5, // Larger spawn area
      ...options
    };

    this.init();
    this.animate();
    window.addEventListener('resize', () => this.reset());
  }

  init() {
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';
    this.container.insertBefore(this.canvas, this.container.firstChild);
    
    // Set canvas size
    this.resize();
    
    // Create particles
    for (let i = 0; i < this.options.count; i++) {
      this.createParticle();
    }
  }

  createParticle() {
    const size = Math.random() * (this.options.maxSize - this.options.minSize) + this.options.minSize;
    const color = this.options.colors[Math.floor(Math.random() * this.options.colors.length)];
    const baseSpeed = this.options.speed * (0.7 + Math.random() * 0.6); // More speed variation
    
    // Distribute particles in a larger area
    const margin = 200; // Extra space outside container
    const spawnAreaX = this.width + (margin * 2);
    const spawnAreaY = this.height + (margin * 2);
    
    this.particles.push({
      x: (Math.random() * spawnAreaX) - (margin / 2),
      y: (Math.random() * spawnAreaY) - (margin / 2),
      baseX: 0,
      baseY: 0,
      size: size,
      color: color,
      speedX: (Math.random() - 0.5) * baseSpeed,
      speedY: (Math.random() - 0.5) * baseSpeed,
      angle: Math.random() * Math.PI * 2,
      angleSpeed: (Math.random() - 0.5) * 0.01,
      baseSize: size,
      timeOffset: Math.random() * Math.PI * 2,
      opacity: 0.9 + Math.random() * 0.1 // Slight opacity variation
    });
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    
    // Set canvas size to match container
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.scale(dpr, dpr);
    
    // Adjust canvas display size
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
  }

  reset() {
    this.resize();
    this.particles = [];
    for (let i = 0; i < this.options.count; i++) {
      this.createParticle();
    }
  }

  animate() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    const time = Date.now() * 0.001; // Current time in seconds
    
    this.particles.forEach((particle, i) => {
      // Update position with more pronounced organic movement
      const noiseX = Math.sin(time * 0.3 + i * 0.2) * 0.3;
      const noiseY = Math.cos(time * 0.35 + i * 0.25) * 0.3;
      
      particle.x += particle.speedX + noiseX;
      particle.y += particle.speedY + noiseY;
      particle.angle += particle.angleSpeed;
      
      // Allow particles to move further outside the container
      const padding = 50; // Match the padding from createParticle
      if (particle.x < -padding || particle.x > this.width + padding) {
        particle.speedX *= -0.9;
        particle.x = Math.max(-padding, Math.min(this.width + padding, particle.x));
      }
      if (particle.y < -padding || particle.y > this.height + padding) {
        particle.speedY *= -0.9;
        particle.y = Math.max(-padding, Math.min(this.height + padding, particle.y));
      }
      
      // Pulsing size effect
      const pulse = Math.sin(time * 0.8 + particle.timeOffset) * 0.2 + 0.8;
      const currentSize = particle.baseSize * pulse;
      
      // Draw particle with glow effect
      const gradient = this.ctx.createRadialGradient(
        particle.x, particle.y, 0,
        particle.x, particle.y, currentSize * 1.5
      );
      
      gradient.addColorStop(0, particle.color);
      gradient.addColorStop(1, particle.color.replace('0.5)', '0)'));
      
      this.ctx.beginPath();
      this.ctx.arc(
        particle.x,
        particle.y,
        currentSize,
        0,
        Math.PI * 2
      );
      
      this.ctx.fillStyle = gradient;
      this.ctx.shadowColor = particle.color;
      this.ctx.shadowBlur = currentSize * 1.5;
      this.ctx.globalAlpha = particle.opacity;
      this.ctx.fill();
      
      // Reset shadow and alpha for next particle
      this.ctx.shadowBlur = 0;
      this.ctx.globalAlpha = 1;
    });
    
    requestAnimationFrame(() => this.animate());
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new HeroParticles('hero-particles');
});
