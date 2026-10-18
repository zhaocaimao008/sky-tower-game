/* Sky Tower MVP — level & difficulty configuration.
 *
 * Pure functions, no DOM access. Safe to unit-test with node:
 *   node -e "window={}; require('./js/config.js'); ..."
 */
'use strict';

var SkyTower = window.SkyTower || {};
window.SkyTower = SkyTower;

SkyTower.MAX_LEVEL = 100;   // total levels
SkyTower.HEARTS = 3;        // misses allowed per level attempt
SkyTower.DAILY_BONUS_STARS = 2; // bonus stars for completing the daily challenge

/**
 * Deterministic config for level n (1-based).
 * Difficulty ramps: faster blocks, narrower start width, longer targets.
 */
SkyTower.levelConfig = function (n) {
  n = Math.max(1, Math.min(SkyTower.MAX_LEVEL, n | 0));
  return {
    n: n,
    target: Math.min(30, 8 + Math.floor((n - 1) / 4)), // blocks to stack: 8 .. 30
    speed: Math.min(380, 135 + n * 2.4),              // px/s sliding speed
    startWidth: Math.max(150, 248 - n * 0.95),        // px, shrinks with level
    hearts: SkyTower.HEARTS,
    label: 'Level ' + n,
    isDaily: false
  };
};

/** Theoretical max score for a target (every placement perfect). */
SkyTower.maxScore = function (target) {
  // per block: 100 base + 50 * combo(1..T)
  return 100 * target + 25 * target * (target + 1);
};

/** Score cutoffs for 2 and 3 stars. 1 star is guaranteed on completion. */
SkyTower.starThresholds = function (target) {
  var max = SkyTower.maxScore(target);
  return {
    two: Math.round(max * 0.45),
    three: Math.round(max * 0.70)
  };
};

SkyTower.starsFor = function (score, target) {
  var t = SkyTower.starThresholds(target);
  if (score >= t.three) return 3;
  if (score >= t.two) return 2;
  return 1;
};

/* ------------------------------------------------------------------ */
/* Daily challenge — deterministic per calendar date, so every player  */
/* worldwide gets the same challenge on the same day.                 */
/* ------------------------------------------------------------------ */

SkyTower.dailySeed = function (date) {
  date = date || new Date();
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
};

SkyTower.dailyKey = function (date) {
  date = date || new Date();
  function p(x) { return (x < 10 ? '0' : '') + x; }
  return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

SkyTower.dailyConfig = function (date) {
  var rnd = mulberry32(SkyTower.dailySeed(date));
  return {
    n: 0,
    target: 15 + Math.floor(rnd() * 11),          // 15..25 blocks
    speed: Math.round((150 + rnd() * 110) * 10) / 10, // 150..260 px/s
    startWidth: Math.round(200 + rnd() * 40),     // 200..240 px
    hearts: SkyTower.HEARTS,
    label: 'Daily Challenge',
    isDaily: true,
    seed: SkyTower.dailySeed(date),
    key: SkyTower.dailyKey(date)
  };
};
