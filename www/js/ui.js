/* Sky Tower MVP — screens, HUD, level select, results.
 * Owns all DOM; the engine (game.js) never touches it directly.
 */
'use strict';

(function () {

  function $(id) { return document.getElementById(id); }

  var game = null;          // engine instance, injected via init()
  var context = null;       // { mode:'level'|'daily', n, cfg }
  var levelsSinceAd = 0;    // interstitial pacing counter
  var toastTimer = null;

  /* ---------------- helpers ---------------- */

  function showToast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('visible'); }, 2000);
  }

  function showScreen(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle('active', screens[i].id === 'screen-' + name);
    }
    if (name === 'game' && game) {
      // canvas needs real dimensions once visible
      setTimeout(function () { game.resize(); }, 30);
    }
    window.scrollTo(0, 0);
  }

  function starRow(earned) {
    var s = '';
    for (var i = 1; i <= 3; i++) {
      s += '<span class="star' + (i <= earned ? ' on' : '') + '">★</span>';
    }
    return s;
  }

  /* ---------------- home / levels ---------------- */

  function renderHome() {
    $('homeStars').textContent = SkyTower.storage.totalStars();
    var key = SkyTower.dailyKey();
    var done = SkyTower.storage.isDailyDone(key);
    var btn = $('dailyBtn');
    btn.classList.toggle('done', done);
    btn.querySelector('.daily-state').textContent = done ? 'Completed ✓' : 'Play today\'s challenge';
  }

  function renderLevels() {
    var d = SkyTower.storage.data;
    $('levelsStars').textContent = SkyTower.storage.totalStars();
    var grid = $('levelGrid');
    grid.innerHTML = '';
    for (var n = 1; n <= SkyTower.MAX_LEVEL; n++) {
      (function (level) {
        var locked = level > d.unlocked;
        var b = document.createElement('button');
        b.className = 'level-cell' + (locked ? ' locked' : '');
        var earned = d.stars[level] || 0;
        b.innerHTML = locked
          ? '<span class="cell-lock">🔒</span><span class="cell-num">' + level + '</span>'
          : '<span class="cell-num">' + level + '</span><span class="cell-stars">' + starRow(earned) + '</span>';
        b.setAttribute('aria-label', 'Level ' + level + (locked ? ' (locked)' : ', ' + earned + ' stars'));
        if (!locked) b.addEventListener('click', function () { startLevel(level); });
        grid.appendChild(b);
      })(n);
    }
  }

  /* ---------------- game flow ---------------- */

  function startLevel(n) {
    var cfg = SkyTower.levelConfig(n);
    context = { mode: 'level', n: n, cfg: cfg };
    enterGame(cfg);
  }

  function startDaily() {
    var cfg = SkyTower.dailyConfig();
    context = { mode: 'daily', n: 0, cfg: cfg };
    enterGame(cfg);
  }

  function enterGame(cfg) {
    showScreen('game');
    $('hudLabel').textContent = cfg.label;
    $('pauseOverlay').classList.add('hidden');
    $('resultOverlay').classList.add('hidden');
    $('hud').classList.add('visible');
    var rb = document.getElementById('reviveBtn');
    if (rb) rb.disabled = false; // fail panel may not be rendered yet on first play
    game.start(cfg);
  }

  function quitToLevels() {
    game.destroy();
    $('hud').classList.remove('visible');
    renderHome();
    renderLevels();
    showScreen('levels');
  }

  function onTick(s) {
    $('hudScore').textContent = s.score;
    $('hudProgress').textContent = s.placed + '/' + s.target;
    $('hudCombo').textContent = s.combo >= 2 ? 'Combo ×' + s.combo : '';
    $('hudCombo').classList.toggle('visible', s.combo >= 2);
    var hearts = '';
    for (var i = 0; i < SkyTower.HEARTS; i++) {
      hearts += '<span class="heart' + (i < s.hearts ? '' : ' lost') + '">♥</span>';
    }
    $('hudHearts').innerHTML = hearts;
  }

  function onWin(result) {
    $('hud').classList.remove('visible');
    var panel = $('resultPanel');
    var stars, title, subtitle;

    if (context.mode === 'daily') {
      var first = SkyTower.storage.recordDaily(context.cfg.key, SkyTower.DAILY_BONUS_STARS);
      stars = 3;
      title = 'Daily Complete!';
      subtitle = first
        ? '+' + SkyTower.DAILY_BONUS_STARS + ' bonus stars earned'
        : 'Already claimed today — nice run!';
    } else {
      stars = SkyTower.starsFor(result.score, context.cfg.target);
      SkyTower.storage.recordLevel(context.n, stars, result.score);
      title = 'Level Complete!';
      subtitle = 'Score ' + result.score;
      levelsSinceAd += 1;
      if (levelsSinceAd >= 3 && !SkyTower.ads.isAdsRemoved()) {
        levelsSinceAd = 0;
        SkyTower.ads.showInterstitial(); // no-op in MVP
      }
    }

    panel.innerHTML =
      '<p class="over-kicker win">★ ' + title + '</p>' +
      '<div class="big-stars">' + starRow(0) + '</div>' +
      '<div class="final-score">' + result.score + '</div>' +
      '<div class="final-label">' + subtitle + '</div>' +
      '<div class="result-meta"><div><span>Best</span><b>' +
        (context.mode === 'daily' ? '—' : (SkyTower.storage.data.best[context.n] || result.score)) +
      '</b></div><div><span>Total Stars</span><b>' + SkyTower.storage.totalStars() + '</b></div></div>' +
      (context.mode === 'level'
        ? '<button id="nextBtn" class="primary">Next Level</button>'
        : '') +
      '<button id="retryBtn" class="secondary">Play Again</button>' +
      '<button id="levelsBtn" class="secondary">All Levels</button>';

    // animate stars filling in
    var starEls = panel.querySelectorAll('.big-stars .star');
    for (var i = 0; i < stars; i++) {
      (function (idx) {
        setTimeout(function () { starEls[idx].classList.add('on'); }, 350 + idx * 350);
      })(i);
    }

    if (context.mode === 'level') {
      var next = $('nextBtn');
      if (context.n >= SkyTower.MAX_LEVEL) {
        next.textContent = 'All Levels';
        next.addEventListener('click', quitToLevels);
      } else {
        next.addEventListener('click', function () { startLevel(context.n + 1); });
      }
    }
    $('retryBtn').addEventListener('click', function () {
      if (context.mode === 'daily') startDaily(); else startLevel(context.n);
    });
    $('levelsBtn').addEventListener('click', quitToLevels);

    $('resultOverlay').classList.remove('hidden');
    renderHome();
  }

  function onFail(result) {
    $('hud').classList.remove('visible');
    var panel = $('resultPanel');
    panel.innerHTML =
      '<p class="over-kicker">Out of hearts</p>' +
      '<h2 class="over-title">So close!</h2>' +
      '<div class="final-score">' + result.score + '</div>' +
      '<div class="final-label">Score &nbsp;·&nbsp; ' + result.placed + '/' + result.target + ' blocks</div>' +
      '<button id="reviveBtn" class="reward">📺 Watch Ad to Revive</button>' +
      '<p class="fine-print">MVP build: revive is instant — AdMob plugs in here.</p>' +
      '<button id="retryBtn2" class="primary">Try Again</button>' +
      '<button id="levelsBtn2" class="secondary">All Levels</button>';

    $('reviveBtn').addEventListener('click', function () {
      var btn = $('reviveBtn');
      btn.disabled = true;
      btn.textContent = 'Loading ad…';
      SkyTower.ads.showRewarded({
        onReward: function () {
          if (game.revive()) {
            $('resultOverlay').classList.add('hidden');
            $('hud').classList.add('visible');
            showToast('Revived — keep stacking!');
          }
        },
        onClose: function () {
          btn.disabled = false;
          btn.textContent = '📺 Watch Ad to Revive';
        }
      });
    });
    $('retryBtn2').addEventListener('click', function () {
      if (context.mode === 'daily') startDaily(); else startLevel(context.n);
    });
    $('levelsBtn2').addEventListener('click', quitToLevels);

    $('resultOverlay').classList.remove('hidden');
  }

  /* ---------------- init ---------------- */

  function init(g) {
    game = g;

    $('playBtn').addEventListener('click', function () {
      renderLevels();
      showScreen('levels');
    });
    $('dailyBtn').addEventListener('click', startDaily);
    $('homeHow').addEventListener('click', function () {
      showToast('Stack blocks to the target. Perfect drops build combo. 3 misses = fail.');
    });
    $('backHomeBtn').addEventListener('click', function () {
      renderHome();
      showScreen('home');
    });
    $('resetBtn').addEventListener('click', function () {
      if (window.confirm('Reset all progress?')) {
        SkyTower.storage.reset();
        renderHome(); renderLevels();
        showToast('Progress reset');
      }
    });

    $('pauseBtn').addEventListener('click', function () {
      game.pause();
      $('pauseOverlay').classList.remove('hidden');
    });
    $('resumeBtn').addEventListener('click', function () {
      $('pauseOverlay').classList.add('hidden');
      game.resume();
    });
    $('restartBtn').addEventListener('click', function () {
      $('pauseOverlay').classList.add('hidden');
      if (context.mode === 'daily') startDaily(); else startLevel(context.n);
    });
    $('quitBtn').addEventListener('click', function () {
      $('pauseOverlay').classList.add('hidden');
      quitToLevels();
    });

    $('muteBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var muted = !game.isMuted();
      game.setMuted(muted);
      SkyTower.storage.data.muted = muted;
      SkyTower.storage.save();
      $('muteBtn').textContent = muted ? '🔇' : '🔊';
    });

    // canvas tap = drop (pointerdown covers touch + mouse)
    var canvas = $('game');
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      game.drop();
    });

    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space') {
        e.preventDefault();
        if (game.getState() === 'playing') game.drop();
      }
    });

    // restore mute preference
    var muted = !!SkyTower.storage.data.muted;
    game.setMuted(muted);
    $('muteBtn').textContent = muted ? '🔇' : '🔊';

    renderHome();
    showScreen('home');
  }

  SkyTower.ui = {
    init: init,
    showToast: showToast,
    hooks: { onTick: onTick, onWin: onWin, onFail: onFail }
  };
})();
