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
      accent: [220, 180, 255],     // shimmer sparkles
      noiseScale: 0.0025,
      noiseSpeed: 0.003,
      fieldStyle: 'spiral',        // spiraling vortices — arcane energy
      particleCount: 600,
      trailAlpha: 16,
      glowIntensity: 0.8,
      sizeRange: [1, 3.5],
      speedMult: 1,
      drawMode: 'circle',          // round luminous motes
      bgColor: [12, 8, 30],        // deep indigo
      hasSparkles: true,            // occasional bright flashes
      hasRunes: true                // faint geometric shapes
    },
    horror: {
      color: [239, 68, 68],
      soft:  [180, 40, 40],
      accent: [255, 100, 100],
      noiseScale: 0.005,
      noiseSpeed: 0.008,
      fieldStyle: 'jagged',        // erratic, fragmenting — reality tearing
      particleCount: 400,
      trailAlpha: 8,               // very dark trails — unsettling
      glowIntensity: 0.3,
      sizeRange: [0.5, 2],
      speedMult: 1.5,              // fast, frantic
      drawMode: 'streak',          // elongated streaks, not circles
      bgColor: [10, 5, 5],         // near black with red tint
      hasFlicker: true,             // random brightness drops
      hasVoid: true                 // dark voids that repel particles
    },
    scifi: {
      color: [6, 182, 212],
      soft:  [103, 232, 249],
      accent: [180, 255, 255],
      noiseScale: 0.002,
      noiseSpeed: 0.002,
      fieldStyle: 'orbital',       // clean orbital arcs — data streams
      particleCount: 500,
      trailAlpha: 22,              // long bright trails
      glowIntensity: 0.9,
      sizeRange: [1, 2.5],
      speedMult: 0.8,              // smooth and precise
      drawMode: 'dot',             // crisp dots with connecting lines
      bgColor: [5, 12, 20],        // dark navy
      hasGrid: true,               // faint hex grid underlay
      hasConnections: true          // lines between nearby particles
    },
    detective: {
      color: [251, 191, 36],
      soft:  [253, 230, 138],
      accent: [255, 220, 100],
      noiseScale: 0.003,
      noiseSpeed: 0.0012,
      fieldStyle: 'grid',          // methodical convergence — clues connecting
      particleCount: 350,
      trailAlpha: 12,
      glowIntensity: 0.5,
      sizeRange: [1.5, 4],         // larger, fewer particles
      speedMult: 0.5,              // slow and deliberate
      drawMode: 'circle',
      bgColor: [15, 12, 5],        // warm dark brown
      hasPulse: true,               // rhythmic brightness pulse
      hasWeb: true                  // connecting web between clusters
    },
    postapoc: {
      color: [132, 204, 22],
      soft:  [80, 140, 20],
      accent: [190, 242, 100],
      noiseScale: 0.004,
      noiseSpeed: 0.005,
      fieldStyle: 'decay',         // gravitational scatter — entropy
      particleCount: 450,
      trailAlpha: 10,
      glowIntensity: 0.4,
      sizeRange: [0.8, 3],
      speedMult: 1.2,
      drawMode: 'dust',            // irregular dust motes
      bgColor: [10, 12, 5],        // sickly dark green
      hasStatic: true,              // TV static noise bursts
      hasEmbers: true               // upward-floating ember particles
    },
    pirate: {
      color: [249, 115, 22],
      soft:  [253, 186, 116],
      accent: [255, 200, 100],
      noiseScale: 0.002,
      noiseSpeed: 0.003,
      fieldStyle: 'wave',          // sweeping wave arcs — wind and tide
      particleCount: 500,
      trailAlpha: 18,
      glowIntensity: 0.65,
      sizeRange: [1, 3],
      speedMult: 1,
      drawMode: 'circle',
      bgColor: [15, 10, 5],        // warm dark
      hasWaves: true,               // sine wave horizon lines
      hasSparkles: true             // golden shimmer
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
      var sizeMin = (profile.sizeRange || [1, 3.5])[0];
      var sizeMax = (profile.sizeRange || [1, 3.5])[1];
      var speedMult = profile.speedMult || 1;

      function Particle() {
        this.reset(true);
      }

      Particle.prototype.reset = function (initial) {
        if (initial) {
          this.x = p.random(W);
          this.y = p.random(H);
        } else {
          var edge = p.floor(p.random(4));
          if (edge === 0)      { this.x = 0;  this.y = p.random(H); }
          else if (edge === 1) { this.x = W;  this.y = p.random(H); }
          else if (edge === 2) { this.x = p.random(W); this.y = 0;  }
          else                 { this.x = p.random(W); this.y = H;  }
        }
        this.vx = 0;
        this.vy = 0;
        this.prevX = this.x;
        this.prevY = this.y;
        this.life = p.random(150, 400);
        this.maxLife = this.life;
        this.size = p.random(sizeMin, sizeMax);
        // Blend between primary, soft, and accent colors
        var t = p.random();
        var useAccent = p.random() < 0.15 && profile.accent;
        var col2 = useAccent ? profile.accent : profile.soft;
        this.r = p.lerp(profile.color[0], col2[0], t);
        this.g = p.lerp(profile.color[1], col2[1], t);
        this.b = p.lerp(profile.color[2], col2[2], t);
        this.brightness = p.random(0.5, 1);
        this.isSparkle = profile.hasSparkles && p.random() < 0.03;
      };

      Particle.prototype.update = function () {
        this.prevX = this.x;
        this.prevY = this.y;

        var angle = getFieldAngle(this.x, this.y, time);
        var speed = (0.8 + p.noise(this.x * 0.005, this.y * 0.005, time * 0.5) * 1.2) * speedMult;

        this.vx += p.cos(angle) * speed * 0.15;
        this.vy += p.sin(angle) * speed * 0.15;

        // Horror: random jitter
        if (profile.hasFlicker && p.random() < 0.02) {
          this.vx += p.random(-2, 2);
          this.vy += p.random(-2, 2);
        }

        // Post-apoc: embers float upward
        if (profile.hasEmbers && this.isSparkle) {
          this.vy -= 0.3;
        }

        // Mouse attractor
        if (mouseInfluence.active) {
          var dx = mouseInfluence.x - this.x;
          var dy = mouseInfluence.y - this.y;
          var distSq = dx * dx + dy * dy;
          if (distSq > 2500 && distSq < 40000) {
            var force = 80 / distSq;
            this.vx += dx * force;
            this.vy += dy * force;
          }
        }

        // Horror: void repulsion from center
        if (profile.hasVoid) {
          var vcx = W * 0.5 + p.sin(time * 2) * W * 0.15;
          var vcy = H * 0.5 + p.cos(time * 1.5) * H * 0.15;
          var vdx = this.x - vcx;
          var vdy = this.y - vcy;
          var vDistSq = vdx * vdx + vdy * vdy;
          var voidRadius = 8000;
          if (vDistSq < voidRadius) {
            var repel = (voidRadius - vDistSq) / voidRadius * 0.5;
            this.vx += (vdx / (p.sqrt(vDistSq) + 1)) * repel;
            this.vy += (vdy / (p.sqrt(vDistSq) + 1)) * repel;
          }
        }

        this.vx *= 0.92;
        this.vy *= 0.92;
        this.x += this.vx;
        this.y += this.vy;
        this.life--;

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

        // Horror: random flicker
        if (profile.hasFlicker && p.random() < 0.08) {
          alpha *= p.random(0.1, 0.5);
        }

        // Detective: rhythmic pulse
        if (profile.hasPulse) {
          alpha *= 0.7 + p.sin(time * 5 + this.x * 0.01) * 0.3;
        }

        // Dissolve
        if (dissolveProgress > 0) {
          var cx = W / 2, cy = H / 2;
          var scatter = dissolveProgress * 8;
          this.x += (this.x - cx) * scatter * 0.02;
          this.y += (this.y - cy) * scatter * 0.02;
          alpha *= (1 - dissolveProgress);
        }

        if (alpha < 1) return;

        p.noStroke();

        // Glow layer
        if (profile.glowIntensity > 0 && this.size > 1.5) {
          p.fill(this.r, this.g, this.b, alpha * 0.12 * profile.glowIntensity);
          p.circle(this.x, this.y, this.size * 6);
        }

        // Sparkle flash
        if (this.isSparkle && p.random() < 0.3) {
          p.fill(255, 255, 255, alpha * 0.6);
          p.circle(this.x, this.y, this.size * 3);
        }

        // Draw mode
        switch (profile.drawMode) {
          case 'streak': {
            // Horror: elongated streaks in motion direction
            var len = p.sqrt(this.vx * this.vx + this.vy * this.vy) * 4 + 2;
            p.stroke(this.r, this.g, this.b, alpha);
            p.strokeWeight(this.size * 0.6);
            p.line(this.prevX, this.prevY, this.x, this.y);
            p.noStroke();
            break;
          }
          case 'dot': {
            // Sci-fi: crisp dots
            p.fill(this.r, this.g, this.b, alpha);
            p.circle(this.x, this.y, this.size);
            break;
          }
          case 'dust': {
            // Post-apoc: irregular shapes
            p.fill(this.r, this.g, this.b, alpha);
            p.push();
            p.translate(this.x, this.y);
            p.rotate(this.x + this.y + time);
            p.rect(-this.size / 2, -this.size / 2, this.size, this.size * p.random(0.6, 1.4));
            p.pop();
            break;
          }
          default: {
            // Circle (fantasy, detective, pirate)
            p.fill(this.r, this.g, this.b, alpha);
            p.circle(this.x, this.y, this.size);
          }
        }
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
        W = containerEl.clientWidth || containerEl.offsetWidth;
        H = containerEl.clientHeight || containerEl.offsetHeight;
        var canvas = p.createCanvas(W, H);
        canvas.parent(containerEl);
        canvas.style('position', 'absolute');
        canvas.style('top', '0');
        canvas.style('left', '0');
        canvas.style('width', '100%');
        canvas.style('height', '100%');
        canvas.style('z-index', '3');
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
        // Genre-specific background color for trails
        var bg = profile.bgColor || [15, 15, 35];
        p.background(bg[0], bg[1], bg[2], profile.trailAlpha);

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

        // Genre-specific background effects (drawn behind particles)
        drawGenreBackground(dissolveProgress);

        // Update and draw particles
        for (var i = 0; i < particles.length; i++) {
          var pt = particles[i];
          pt.update();
          pt.draw(dissolveProgress);
          if (pt.life <= 0 && !dissolving) {
            pt.reset(false);
          }
        }

        // Sci-fi: draw connections between close particles
        if (profile.hasConnections && !dissolving) {
          drawConnections();
        }

        // Subtle vignette
        drawVignette();
      };

      function drawGenreBackground(dProg) {
        var fadeAlpha = dProg > 0 ? (1 - dProg) : 1;

        // Sci-fi: faint hex grid
        if (profile.hasGrid) {
          p.stroke(profile.color[0], profile.color[1], profile.color[2], 8 * fadeAlpha);
          p.strokeWeight(0.5);
          p.noFill();
          var gridSize = 60;
          for (var gx = 0; gx < W + gridSize; gx += gridSize) {
            for (var gy = 0; gy < H + gridSize; gy += gridSize * 0.866) {
              var offset = (Math.floor(gy / (gridSize * 0.866)) % 2) * gridSize * 0.5;
              p.circle(gx + offset, gy, gridSize * 0.3);
            }
          }
          p.noStroke();
        }

        // Horror: dark void
        if (profile.hasVoid) {
          var vcx = W * 0.5 + p.sin(time * 2) * W * 0.15;
          var vcy = H * 0.5 + p.cos(time * 1.5) * H * 0.15;
          p.noStroke();
          for (var vi = 0; vi < 5; vi++) {
            var vr = 40 + vi * 25;
            p.fill(bg[0], bg[1], bg[2], (40 - vi * 8) * fadeAlpha);
            p.circle(vcx, vcy, vr);
          }
        }

        // Post-apoc: TV static bursts
        if (profile.hasStatic && p.random() < 0.04) {
          var sx = p.random(W);
          var sy = p.random(H);
          var sw = p.random(30, 100);
          var sh = p.random(2, 6);
          p.fill(profile.color[0], profile.color[1], profile.color[2], 15 * fadeAlpha);
          p.noStroke();
          p.rect(sx, sy, sw, sh);
        }

        // Pirate: sine wave horizon lines
        if (profile.hasWaves) {
          p.noFill();
          p.strokeWeight(0.5);
          for (var wi = 0; wi < 3; wi++) {
            var wy = H * (0.35 + wi * 0.15);
            p.stroke(profile.color[0], profile.color[1], profile.color[2], (12 - wi * 3) * fadeAlpha);
            p.beginShape();
            for (var wx = 0; wx < W; wx += 8) {
              var wvy = wy + p.sin(wx * 0.008 + time * (3 - wi) + wi) * (15 + wi * 8);
              p.vertex(wx, wvy);
            }
            p.endShape();
          }
          p.noStroke();
        }

        // Fantasy: faint rune shapes
        if (profile.hasRunes && p.frameCount % 120 < 60) {
          var runeAlpha = p.sin(p.frameCount * 0.05) * 10 * fadeAlpha;
          if (runeAlpha > 1) {
            p.noFill();
            p.stroke(profile.accent[0], profile.accent[1], profile.accent[2], runeAlpha);
            p.strokeWeight(0.8);
            var rcx = W * 0.5 + p.sin(time * 0.5) * W * 0.2;
            var rcy = H * 0.5 + p.cos(time * 0.3) * H * 0.2;
            var rs = 40 + p.sin(time) * 10;
            // Hexagram
            p.push();
            p.translate(rcx, rcy);
            p.rotate(time * 0.2);
            for (var ri = 0; ri < 6; ri++) {
              var ra = ri * p.TWO_PI / 6;
              p.line(0, 0, p.cos(ra) * rs, p.sin(ra) * rs);
            }
            p.circle(0, 0, rs * 1.5);
            p.pop();
            p.noStroke();
          }
        }

        // Detective: connecting web between clusters
        if (profile.hasWeb && p.frameCount % 3 === 0) {
          p.stroke(profile.color[0], profile.color[1], profile.color[2], 6 * fadeAlpha);
          p.strokeWeight(0.3);
          for (var di = 0; di < particles.length; di += 8) {
            for (var dj = di + 8; dj < particles.length; dj += 8) {
              var ddx = particles[di].x - particles[dj].x;
              var ddy = particles[di].y - particles[dj].y;
              if (ddx * ddx + ddy * ddy < 6000) {
                p.line(particles[di].x, particles[di].y, particles[dj].x, particles[dj].y);
              }
            }
          }
          p.noStroke();
        }
      }

      function drawConnections() {
        // Sci-fi: lines between nearby particles
        p.strokeWeight(0.4);
        var maxDist = 3600; // 60px squared
        for (var ci = 0; ci < particles.length; ci += 4) {
          for (var cj = ci + 4; cj < particles.length; cj += 4) {
            var cdx = particles[ci].x - particles[cj].x;
            var cdy = particles[ci].y - particles[cj].y;
            var cd = cdx * cdx + cdy * cdy;
            if (cd < maxDist) {
              var ca = p.map(cd, 0, maxDist, 40, 0);
              p.stroke(profile.color[0], profile.color[1], profile.color[2], ca);
              p.line(particles[ci].x, particles[ci].y, particles[cj].x, particles[cj].y);
            }
          }
        }
        p.noStroke();
      }

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
        W = containerEl.clientWidth || containerEl.offsetWidth;
        H = containerEl.clientHeight || containerEl.offsetHeight;
        if (W > 0 && H > 0) p.resizeCanvas(W, H);
      };

      function drawVignette() {
        var bg = profile.bgColor || [15, 15, 35];
        var maxDim = p.max(W, H);
        var cx = W / 2, cy = H / 2;
        p.noStroke();
        for (var i = 0; i < 8; i++) {
          var r = maxDim * (0.5 + i * 0.08);
          var a = i * 4;
          p.fill(bg[0], bg[1], bg[2], a);
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
