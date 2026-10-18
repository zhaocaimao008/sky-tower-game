/* Sky Tower MVP — core stacking engine (canvas 2D).
 *
 * Level-based hybrid-casual rules:
 *   - stack `cfg.target` blocks to clear the level
 *   - a miss costs 1 heart (cfg.hearts per attempt); 0 hearts = fail
 *   - perfect placement: score += 100 + 50 * combo (combo = consecutive perfects)
 *   - normal placement: score += 100, combo resets
 *   - revive() refills hearts once per attempt (wired to rewarded ad in UI)
 *
 * API:
 *   var game = SkyTower.createGame(canvas, hooks);
 *   game.start(cfg);            // cfg from SkyTower.levelConfig / dailyConfig
 *   game.drop(); game.pause(); game.resume();
 *   game.revive();              // -> true when a revive was available
 *   game.setMuted(bool); game.resize(); game.destroy();
 *
 * hooks: { onTick(state), onWin(result), onFail(result) }
 *   state  = { score, placed, target, hearts, combo, label }
 *   result = { score, placed, target }
 */
'use strict';

(function () {

  function createGame(canvas, hooks) {
    hooks = hooks || {};
    var ctx = canvas.getContext('2d');

    var W = 0, H = 0, dpr = 1;
    var state = 'idle'; // idle | playing | paused | over
    var cfg = null;

    var blocks = [], current = null;
    var debris = [], particles = [], floats = [], stars = [];

    var placed = 0, score = 0, combo = 0, hearts = 0, revived = false;
    var camera = 0, cameraTarget = 0, last = 0;
    var shake = 0, pulse = 0, pendingSpawn = 0, failTimer = 0;
    var muted = false, audioCtx = null;
    var running = false, raf = 0;

    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------------- setup ---------------- */

    function makeStars() {
      stars = [];
      var seed = 9731;
      function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
      for (var i = 0; i < 90; i++) {
        stars.push({ x: rnd(), y: rnd(), r: 0.5 + rnd() * 1.45, a: 0.3 + rnd() * 0.7 });
      }
    }

    function resize() {
      W = canvas.clientWidth || window.innerWidth;
      H = canvas.clientHeight || window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function blockHeight() {
      return Math.max(30, Math.min(39, H * 0.052));
    }

    function emit() {
      if (hooks.onTick) {
        hooks.onTick({
          score: score, placed: placed,
          target: cfg ? cfg.target : 0,
          hearts: hearts, combo: combo,
          label: cfg ? cfg.label : ''
        });
      }
    }

    /* ---------------- flow ---------------- */

    function start(c) {
      cfg = c;
      resize(); // ensure valid canvas dimensions (W/H) before play
      blocks = []; debris = []; particles = []; floats = [];
      placed = 0; score = 0; combo = 0;
      hearts = c.hearts; revived = false;
      camera = 0; cameraTarget = 0;
      shake = 0; pulse = 0; pendingSpawn = 0; failTimer = 0;
      var bw = Math.min(c.startWidth, W * 0.62);
      blocks.push({ x: (W - bw) / 2, y: 0, w: bw, h: blockHeight(), hue: 196 });
      state = 'playing';
      last = performance.now();
      emit();
      spawnBlock();
      ensureLoop();
    }

    function spawnBlock() {
      var base = blocks[blocks.length - 1];
      var fromLeft = placed % 2 === 0;
      var pad = 8;
      var speed = Math.min(420, cfg.speed + placed * 0.9); // mild ramp inside a level
      current = {
        x: fromLeft ? pad : W - base.w - pad,
        y: base.y + blockHeight() + Math.max(112, H * 0.17),
        targetY: base.y + blockHeight(),
        w: base.w,
        h: blockHeight(),
        hue: (196 - (placed + 1) * 17 + 720) % 360,
        dir: fromLeft ? 1 : -1,
        speed: speed,
        phase: 'sliding'
      };
    }

    function drop() {
      if (state !== 'playing' || !current || current.phase !== 'sliding') return;
      unlockAudio();
      current.phase = 'falling';
      current.vy = -720;
      bleep(180, 0.04, 'square', 0.035);
    }

    function land() {
      var base = blocks[blocks.length - 1];
      var curLeft = current.x, curRight = current.x + current.w;
      var baseLeft = base.x, baseRight = base.x + base.w;
      var overlapLeft = Math.max(curLeft, baseLeft);
      var overlapRight = Math.min(curRight, baseRight);
      var overlap = overlapRight - overlapLeft;
      var centerDelta = Math.abs((curLeft + current.w / 2) - (baseLeft + base.w / 2));
      var perfectThreshold = Math.max(5, Math.min(9, base.w * 0.045));

      if (overlap <= 0) { miss(); return; }

      if (centerDelta <= perfectThreshold) {
        // ---- perfect ----
        current.x = base.x;
        current.w = base.w;
        combo += 1;
        score += 100 + 50 * combo;
        burst(base.x + base.w / 2, worldToScreenY(current.targetY), current.hue);
        floats.push({
          x: base.x + base.w / 2,
          y: worldToScreenY(current.targetY) - 14,
          text: combo >= 3 ? 'PERFECT x' + combo + '!' : 'PERFECT!',
          life: 1, hue: current.hue
        });
        pulse = reducedMotion ? 0.13 : 0.4;
        bleep(680 + combo * 20, 0.09, 'sine', 0.06);
        setTimeout(function () { bleep(920 + combo * 25, 0.07, 'sine', 0.035); }, 55);
      } else {
        // ---- trimmed ----
        combo = 0;
        score += 100;
        var cut;
        if (curLeft < baseLeft) {
          cut = { x: curLeft, y: current.targetY, w: baseLeft - curLeft, h: current.h, hue: current.hue, vx: -34 - Math.random() * 30, vy: 34, rot: 0, vr: -0.8 };
        } else {
          cut = { x: baseRight, y: current.targetY, w: curRight - baseRight, h: current.h, hue: current.hue, vx: 34 + Math.random() * 30, vy: 34, rot: 0, vr: 0.8 };
        }
        if (cut.w > 0.5) debris.push(cut);
        current.x = overlapLeft;
        current.w = overlap;
        shake = reducedMotion ? 0 : Math.min(6, 2 + centerDelta * 0.02);
        sliceSparks(curLeft < baseLeft ? baseLeft : baseRight, worldToScreenY(current.targetY), current.hue);
        bleep(250, 0.055, 'triangle', 0.035);
      }

      blocks.push({ x: current.x, y: current.targetY, w: current.w, h: current.h, hue: current.hue });
      current = null;
      placed += 1;
      cameraTarget = Math.max(0, blocks[blocks.length - 1].y - H * 0.55);
      emit();

      if (placed >= cfg.target) { win(); return; }
      pendingSpawn = 0.15;
    }

    function miss() {
      current.phase = 'missed';
      current.vy = -120;
      current.vx = current.dir * 55;
      combo = 0;
      hearts -= 1;
      shake = reducedMotion ? 0 : 9;
      bleep(90, 0.34, 'sawtooth', 0.05);
      emit();
      if (hearts <= 0) {
        failTimer = 0.5; // dramatic pause before the fail screen (game-time)
      }
      // respawn handled in update() once the missed block leaves the screen
    }

    function win() {
      if (state !== 'playing') return;
      state = 'over';
      current = null;
      if (hooks.onWin) hooks.onWin({ score: score, placed: placed, target: cfg.target });
    }

    function fail() {
      if (state !== 'playing') return;
      state = 'over';
      current = null;
      if (hooks.onFail) hooks.onFail({ score: score, placed: placed, target: cfg.target });
    }

    /** Refill hearts once per attempt (rewarded-ad revive). */
    function revive() {
      if (state !== 'over' || revived) return false;
      revived = true;
      hearts = cfg.hearts;
      state = 'playing';
      shake = 0;
      last = performance.now();
      pendingSpawn = 0.2;
      emit();
      ensureLoop();
      return true;
    }

    function pause() { if (state === 'playing') state = 'paused'; }
    function resume() {
      if (state === 'paused') { state = 'playing'; last = performance.now(); ensureLoop(); }
    }

    /* ---------------- update ---------------- */

    function worldToScreenY(y) { return H - 84 - (y - camera) - blockHeight(); }

    function update(dt) {
      if (state === 'playing') {
        camera += (cameraTarget - camera) * Math.min(1, dt * 5.5);
        if (failTimer > 0) {
          failTimer -= dt;
          if (failTimer <= 0) { fail(); return; }
        }
        if (pendingSpawn > 0) {
          pendingSpawn -= dt;
          if (pendingSpawn <= 0) spawnBlock();
        }
        if (current) {
          if (current.phase === 'sliding') {
            current.x += current.dir * current.speed * dt;
            if (current.x <= 6) { current.x = 6; current.dir = 1; }
            if (current.x + current.w >= W - 6) { current.x = W - 6 - current.w; current.dir = -1; }
          } else if (current.phase === 'falling') {
            current.y += current.vy * dt;
            current.vy -= 1000 * dt;
            if (current.y <= current.targetY) { current.y = current.targetY; land(); }
          } else if (current.phase === 'missed') {
            current.y += current.vy * dt;
            current.x += current.vx * dt;
            current.vy -= 950 * dt;
            if (worldToScreenY(current.y) > H + 200 && hearts > 0) {
              current = null;
              pendingSpawn = 0.3;
            }
          }
        }
      }
      for (var i = debris.length - 1; i >= 0; i--) {
        var d = debris[i];
        d.x += d.vx * dt; d.y += d.vy * dt; d.vy -= 900 * dt; d.rot += d.vr * dt;
        if (worldToScreenY(d.y) > H + 180) debris.splice(i, 1);
      }
      for (var p = particles.length - 1; p >= 0; p--) {
        var q = particles[p];
        q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 320 * dt; q.life -= dt * 1.25;
        if (q.life <= 0) particles.splice(p, 1);
      }
      for (var f = floats.length - 1; f >= 0; f--) {
        floats[f].y -= 34 * dt; floats[f].life -= dt * 0.85;
        if (floats[f].life <= 0) floats.splice(f, 1);
      }
      shake *= Math.pow(0.02, dt);
      pulse = Math.max(0, pulse - dt * 1.7);
    }

    /* ---------------- draw ---------------- */

    function bgStops() {
      var t = Math.min(1, placed / 42);
      if (t < 0.28) return ['#59bdf0', '#d9f3ff'];
      if (t < 0.55) return ['#ef875e', '#ffd283'];
      if (t < 0.78) return ['#4c3979', '#d2757d'];
      return ['#090d2b', '#322457'];
    }

    function drawBackground() {
      var stops = bgStops();
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, stops[0]); g.addColorStop(1, stops[1]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (placed < 12) {
        var sunA = Math.max(0, 1 - placed / 15);
        ctx.globalAlpha = sunA * 0.85;
        ctx.fillStyle = '#fff8c7';
        ctx.beginPath(); ctx.arc(W * 0.78, H * 0.18, Math.min(W, H) * 0.065, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (placed > 22) {
        var a = Math.min(1, (placed - 22) / 16);
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          ctx.globalAlpha = a * s.a * (0.75 + 0.25 * Math.sin(performance.now() * 0.0016 + i));
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    function roundRect(c, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    function drawBlock(b, isMoving) {
      var sy = worldToScreenY(b.y);
      var depth = Math.max(5, Math.min(8, b.h * 0.19));
      ctx.save();
      if (isMoving) { ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 7; }
      ctx.fillStyle = 'hsl(' + b.hue + ', 74%, 51%)';
      roundRect(ctx, b.x, sy, b.w, b.h, 3); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = 'hsl(' + b.hue + ', 78%, 61%)';
      ctx.beginPath();
      ctx.moveTo(b.x, sy); ctx.lineTo(b.x + depth, sy - depth);
      ctx.lineTo(b.x + b.w + depth, sy - depth); ctx.lineTo(b.x + b.w, sy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'hsl(' + b.hue + ', 67%, 36%)';
      ctx.beginPath();
      ctx.moveTo(b.x + b.w, sy); ctx.lineTo(b.x + b.w + depth, sy - depth);
      ctx.lineTo(b.x + b.w + depth, sy + b.h - depth); ctx.lineTo(b.x + b.w, sy + b.h);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      ctx.fillRect(b.x + 4, sy + 5, Math.max(0, b.w - 9), 2);
      ctx.restore();
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackground();
      var sx = shake ? (Math.random() - 0.5) * shake : 0;
      var sy = shake ? (Math.random() - 0.5) * shake : 0;
      ctx.save(); ctx.translate(sx, sy);

      ctx.fillStyle = 'rgba(7,20,45,.13)';
      ctx.beginPath();
      ctx.ellipse(W / 2, H - 68, Math.min(W * 0.38, 180), 17, 0, 0, Math.PI * 2);
      ctx.fill();

      var from = Math.max(0, blocks.length - 30);
      for (var i = from; i < blocks.length; i++) drawBlock(blocks[i], false);
      for (var j = 0; j < debris.length; j++) {
        var d = debris[j], dsy = worldToScreenY(d.y);
        ctx.save();
        ctx.translate(d.x + d.w / 2, dsy + d.h / 2);
        ctx.rotate(d.rot);
        ctx.translate(-d.w / 2, -d.h / 2);
        ctx.fillStyle = 'hsl(' + d.hue + ',74%,49%)';
        ctx.fillRect(0, 0, d.w, d.h);
        ctx.restore();
      }
      if (current) drawBlock(current, current.phase === 'sliding');

      for (var p = 0; p < particles.length; p++) {
        var q = particles[p];
        ctx.globalAlpha = Math.max(0, q.life);
        ctx.fillStyle = 'hsl(' + q.hue + ',90%,65%)';
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.life * 4);
        ctx.fillRect(-q.size / 2, -q.size / 2, q.size, q.size);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      for (var f = 0; f < floats.length; f++) {
        var t = floats[f];
        ctx.globalAlpha = Math.max(0, t.life);
        ctx.font = '900 ' + Math.min(26, W * 0.065) + 'px ui-rounded, system-ui';
        ctx.textAlign = 'center';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,30,60,.25)';
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillStyle = '#fff8a7'; ctx.fillText(t.text, t.x, t.y);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      if (state === 'playing' && current && current.phase === 'sliding' && placed === 0) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#fff';
        ctx.font = '800 12px ui-rounded, system-ui'; ctx.textAlign = 'center';
        ctx.fillText('Tap to drop', W / 2, Math.max(102, worldToScreenY(current.y) - 23));
        ctx.globalAlpha = 1;
      }
      if (pulse > 0) {
        ctx.globalAlpha = pulse; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }

    function loop(now) {
      if (!running) return;
      var dt = Math.min(0.033, (now - last) / 1000 || 0.016);
      last = now;
      if (state !== 'paused') update(dt);
      draw();
      raf = requestAnimationFrame(loop);
    }

    function ensureLoop() {
      if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(loop); }
    }

    /* ---------------- particles & audio ---------------- */

    function burst(x, y, hue) {
      for (var i = 0; i < 28; i++) {
        var a = Math.random() * Math.PI * 2, sp = 70 + Math.random() * 190;
        particles.push({
          x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
          life: 0.65 + Math.random() * 0.35,
          size: 3 + Math.random() * 6,
          hue: (hue + Math.random() * 50 - 25 + 360) % 360
        });
      }
    }

    function sliceSparks(x, y, hue) {
      for (var i = 0; i < 9; i++) {
        particles.push({
          x: x, y: y,
          vx: (Math.random() - 0.5) * 110, vy: -30 - Math.random() * 100,
          life: 0.35 + Math.random() * 0.25,
          size: 2 + Math.random() * 3, hue: hue
        });
      }
    }

    function unlockAudio() {
      if (muted) return;
      if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { return; }
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    function bleep(freq, duration, type, volume) {
      if (muted || !audioCtx) return;
      try {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain(), now = audioCtx.currentTime;
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, now);
        o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.82), now + duration);
        g.gain.setValueAtTime(volume || 0.04, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(now); o.stop(now + duration + 0.015);
      } catch (e) {}
    }

    /* ---------------- public API ---------------- */

    makeStars();

    return {
      start: start,
      drop: drop,
      pause: pause,
      resume: resume,
      revive: revive,
      setMuted: function (m) { muted = !!m; },
      isMuted: function () { return muted; },
      getState: function () { return state; },
      resize: resize,
      destroy: function () { running = false; cancelAnimationFrame(raf); state = 'idle'; },
      /** @internal Test/debug helper: snapshot of the moving block & top base. */
      getDebug: function () {
        var base = blocks[blocks.length - 1] || { x: 0, w: 0 };
        return {
          phase: current ? current.phase : null,
          x: current ? current.x : 0,
          w: current ? current.w : 0,
          dir: current ? current.dir : 0,
          speed: current ? current.speed : 0,
          baseX: base.x, baseW: base.w,
          placed: placed, hearts: hearts, score: score, W: W
        };
      }
    };
  }

  SkyTower.createGame = createGame;
})();
