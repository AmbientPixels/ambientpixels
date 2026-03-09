/**
 * adventure-scene-art.js — Narrative Drift
 * Genre-adaptive algorithmic art for the scene loading placeholder.
 * Uses p5.js instance mode to avoid global pollution.
 *
 * API:
 *   NarrativeDrift.start(containerEl, genre)  — mount canvas and begin
 *   NarrativeDrift.stop()                     — dissolve particles and remove
 *   NarrativeDrift.isRunning()                — boolean
 */
var NarrativeDrift = (function () {
  'use strict';

  var p5Instance = null;
  var dissolving = false;
  var onStopCallback = null;

  /* ── Genre profiles ─────────────────────────────────────────────── */
  var GENRE_PROFILES = {
    fantasy: {
      color: [124, 58, 237],
      soft:  [167, 139, 250],
      noiseScale: 0.0025,
      noiseSpeed: 0.003,
      fieldStyle: 'spiral',      // spiraling vortices
      particleCount: 600,
      trailAlpha: 18,
      glowIntensity: 0.7
    },
    horror: {
      color: [239, 68, 68],
      soft:  [252, 165, 165],
      noiseScale: 0.005,
      noiseSpeed: 0.006,
      fieldStyle: 'jagged',      // erratic, fragmenting
      particleCount: 500,
      trailAlpha: 12,
      glowIntensity: 0.5
    },
    scifi: {
      color: [6, 182, 212],
      soft:  [103, 232, 249],
      noiseScale: 0.002,
      noiseSpeed: 0.002,
      fieldStyle: 'orbital',     // clean orbital arcs
      particleCount: 550,
      trailAlpha: 20,
      glowIntensity: 0.8
    },
    detective: {
      color: [251, 191, 36],
      soft:  [253, 230, 138],
      noiseScale: 0.003,
      noiseSpeed: 0.0015,
      fieldStyle: 'grid',        // methodical convergence
      particleCount: 450,
      trailAlpha: 15,
      glowIntensity: 0.6
    },
    postapoc: {
      color: [132, 204, 22],
      soft:  [190, 242, 100],
      noiseScale: 0.004,
      noiseSpeed: 0.004,
      fieldStyle: 'decay',       // gravitational scatter
      particleCount: 500,
      trailAlpha: 14,
      glowIntensity: 0.5
    },
    pirate: {
      color: [249, 115, 22],
      soft:  [253, 186, 116],
      noiseScale: 0.002,
      noiseSpeed: 0.003,
      fieldStyle: 'wave',        // sweeping wave arcs
      particleCount: 550,
      trailAlpha: 18,
      glowIntensity: 0.65
    }
  };

  var DEFAULT_PROFILE = GENRE_PROFILES.fantasy;

  /* ── Sketch factory ─────────────────────────────────────────────── */
  function createSketch(containerEl, genreId) {
    var profile = GENRE_PROFILES[genreId] || DEFAULT_PROFILE;

    return function (p) {
      var particles = [];
      var W, H;
      var time = 0;
      var mouseInfluence = { x: -9999, y: -9999, active: false };
      var dissolveStart = 0;
      var dissolveDuration = 600; // ms

      /* ── Particle ──────────────────────────────────────────── */
      function Particle() {
        this.reset(true);
      }

      Particle.prototype.reset = function (initial) {
        if (initial) {
          this.x = p.random(W);
          this.y = p.random(H);
        } else {
          // Respawn from edges
          var edge = p.floor(p.random(4));
          if (edge === 0)      { this.x = 0;  this.y = p.random(H); }
          else if (edge === 1) { this.x = W;  this.y = p.random(H); }
          else if (edge === 2) { this.x = p.random(W); this.y = 0;  }
          else                 { this.x = p.random(W); this.y = H;  }
        }
        this.vx = 0;
        this.vy = 0;
        this.life = p.random(150, 400);
        this.maxLife = this.life;
        this.size = p.random(1, 3.5);
        // Blend between primary and soft color
        var t = p.random();
        this.r = p.lerp(profile.color[0], profile.soft[0], t);
        this.g = p.lerp(profile.color[1], profile.soft[1], t);
        this.b = p.lerp(profile.color[2], profile.soft[2], t);
        this.brightness = p.random(0.5, 1);
      };

      Particle.prototype.update = function () {
        // Field force
        var angle = getFieldAngle(this.x, this.y, time);
        var speed = 0.8 + p.noise(this.x * 0.005, this.y * 0.005, time * 0.5) * 1.2;

        this.vx += p.cos(angle) * speed * 0.15;
        this.vy += p.sin(angle) * speed * 0.15;

        // Mouse attractor
        if (mouseInfluence.active) {
          var dx = mouseInfluence.x - this.x;
          var dy = mouseInfluence.y - this.y;
          var distSq = dx * dx + dy * dy;
          var minDist = 2500; // 50px squared
          if (distSq > minDist && distSq < 40000) {
            var force = 80 / distSq;
            this.vx += dx * force;
            this.vy += dy * force;
          }
        }

        // Damping
        this.vx *= 0.92;
        this.vy *= 0.92;

        this.x += this.vx;
        this.y += this.vy;
        this.life--;

        // Wrap
        if (this.x < -10) this.x = W + 10;
        if (this.x > W + 10) this.x = -10;
        if (this.y < -10) this.y = H + 10;
        if (this.y > H + 10) this.y = -10;
      };

      Particle.prototype.draw = function (dissolveProgress) {
        var lifeRatio = this.life / this.maxLife;
        var fadeIn = lifeRatio > 0.9 ? (1 - lifeRatio) / 0.1 : 1;
        var fadeOut = lifeRatio < 0.2 ? lifeRatio / 0.2 : 1;
        var alpha = fadeIn * fadeOut * this.brightness * 255;

        // Dissolve effect — particles scatter outward and fade
        if (dissolveProgress > 0) {
          var scatter = dissolveProgress * 8;
          var cx = W / 2;
          var cy = H / 2;
          var awayX = (this.x - cx) * scatter * 0.02;
          var awayY = (this.y - cy) * scatter * 0.02;
          this.x += awayX;
          this.y += awayY;
          alpha *= (1 - dissolveProgress);
        }

        if (alpha < 1) return;

        // Glow layer
        if (profile.glowIntensity > 0 && this.size > 2) {
          p.noStroke();
          p.fill(this.r, this.g, this.b, alpha * 0.15 * profile.glowIntensity);
          p.circle(this.x, this.y, this.size * 6);
        }

        // Core particle
        p.noStroke();
        p.fill(this.r, this.g, this.b, alpha);
        p.circle(this.x, this.y, this.size);
      };

      /* ── Field angle — genre-adaptive ──────────────────────── */
      function getFieldAngle(x, y, t) {
        var ns = profile.noiseScale;
        var base = p.noise(x * ns, y * ns, t) * p.TWO_PI * 2;

        switch (profile.fieldStyle) {
          case 'spiral': {
            var cx = W / 2, cy = H / 2;
            var dx = x - cx, dy = y - cy;
            var dist = p.sqrt(dx * dx + dy * dy);
            var spiral = p.atan2(dy, dx) + dist * 0.008;
            return p.lerp(base, spiral, 0.4);
          }
          case 'jagged': {
            var jitter = p.noise(x * ns * 3, y * ns * 3, t * 2) * p.PI;
            return base + (p.random() < 0.05 ? p.random(p.TWO_PI) : jitter * 0.5);
          }
          case 'orbital': {
            var cx2 = W / 2, cy2 = H / 2;
            var orbital = p.atan2(y - cy2, x - cx2) + p.HALF_PI;
            return p.lerp(base, orbital, 0.55);
          }
          case 'grid': {
            var gridSnap = p.floor(base / p.HALF_PI) * p.HALF_PI;
            return p.lerp(base, gridSnap, 0.35 + p.sin(t * 3) * 0.1);
          }
          case 'decay': {
            var cx3 = W / 2, cy3 = H / 2;
            var away = p.atan2(y - cy3, x - cx3);
            var pull = p.lerp(base, away, 0.3);
            return pull + p.noise(x * ns * 2, t * 2) * 0.8;
          }
          case 'wave': {
            var waveAngle = p.sin(y * 0.01 + t * 4) * p.HALF_PI * 0.6;
            return p.lerp(base, waveAngle, 0.45);
          }
          default:
            return base;
        }
      }

      /* ── p5 lifecycle ──────────────────────────────────────── */
      p.setup = function () {
        W = containerEl.offsetWidth;
        H = containerEl.offsetHeight;
        var canvas = p.createCanvas(W, H);
        canvas.parent(containerEl);
        canvas.style('position', 'absolute');
        canvas.style('top', '0');
        canvas.style('left', '0');
        canvas.style('z-index', '1');
        canvas.style('pointer-events', 'auto');

        p.pixelDensity(1);

        // Seed from time for uniqueness each load
        var seed = Date.now() % 100000;
        p.randomSeed(seed);
        p.noiseSeed(seed);

        for (var i = 0; i < profile.particleCount; i++) {
          particles.push(new Particle());
        }
      };

      p.draw = function () {
        // Semi-transparent background for trails
        p.background(15, 15, 35, profile.trailAlpha);

        time += profile.noiseSpeed;

        // Handle dissolve
        var dissolveProgress = 0;
        if (dissolving) {
          var elapsed = Date.now() - dissolveStart;
          dissolveProgress = p.constrain(elapsed / dissolveDuration, 0, 1);
          if (dissolveProgress >= 1) {
            p.noLoop();
            if (onStopCallback) {
              var cb = onStopCallback;
              onStopCallback = null;
              setTimeout(cb, 0);
            }
            return;
          }
        }

        // Update and draw particles
        for (var i = 0; i < particles.length; i++) {
          var pt = particles[i];
          pt.update();
          pt.draw(dissolveProgress);
          if (pt.life <= 0 && !dissolving) {
            pt.reset(false);
          }
        }

        // Subtle vignette
        drawVignette();
      };

      p.mouseMoved = function () {
        mouseInfluence.x = p.mouseX;
        mouseInfluence.y = p.mouseY;
        mouseInfluence.active = p.mouseX > 0 && p.mouseX < W && p.mouseY > 0 && p.mouseY < H;
      };

      p.touchMoved = function () {
        if (p.touches.length > 0) {
          mouseInfluence.x = p.touches[0].x;
          mouseInfluence.y = p.touches[0].y;
          mouseInfluence.active = true;
        }
        return false; // prevent default
      };

      p.touchEnded = function () {
        mouseInfluence.active = false;
      };

      p.windowResized = function () {
        W = containerEl.offsetWidth;
        H = containerEl.offsetHeight;
        if (W > 0 && H > 0) p.resizeCanvas(W, H);
      };

      function drawVignette() {
        var maxDim = p.max(W, H);
        var cx = W / 2, cy = H / 2;
        p.noStroke();
        for (var i = 0; i < 8; i++) {
          var r = maxDim * (0.5 + i * 0.08);
          var a = i * 4;
          p.fill(15, 15, 35, a);
          p.ellipse(cx, cy, r, r);
        }
      }

      // Expose dissolve trigger
      p.triggerDissolve = function () {
        dissolving = true;
        dissolveStart = Date.now();
      };
    };
  }

  /* ── Public API ─────────────────────────────────────────────────── */
  function start(containerEl, genreId) {
    stop(); // cleanup any previous instance
    dissolving = false;
    if (!containerEl || !window.p5) return;
    p5Instance = new p5(createSketch(containerEl, genreId), undefined);
  }

  function stop(callback) {
    if (!p5Instance) {
      if (callback) callback();
      return;
    }
    onStopCallback = function () {
      if (p5Instance) {
        p5Instance.remove();
        p5Instance = null;
      }
      if (callback) callback();
    };
    if (p5Instance.triggerDissolve) {
      p5Instance.triggerDissolve();
    } else {
      // Fallback: just remove immediately
      p5Instance.remove();
      p5Instance = null;
      if (callback) callback();
    }
  }

  function isRunning() {
    return p5Instance !== null && !dissolving;
  }

  return {
    start: start,
    stop: stop,
    isRunning: isRunning
  };
})();
