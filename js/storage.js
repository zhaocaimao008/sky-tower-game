/* Sky Tower MVP — local persistence (localStorage).
 * Schema (key: skytower_save_v1):
 *   { unlocked, stars{level:1..3}, best{level:score}, daily{YYYY-MM-DD:true},
 *     dailyBonus, muted }
 */
'use strict';

(function () {
  var KEY = 'skytower_save_v1';

  function blank() {
    return {
      unlocked: 1,   // highest level index the player may enter (1-based)
      stars: {},     // level -> 1..3
      best: {},      // level -> best score
      daily: {},     // 'YYYY-MM-DD' -> true when completed
      dailyBonus: 0, // total bonus stars earned from dailies
      muted: false
    };
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return blank();
      var s = JSON.parse(raw);
      var b = blank();
      for (var k in b) {
        if (s[k] !== undefined) b[k] = s[k];
      }
      return b;
    } catch (e) {
      return blank(); // private mode / disabled storage -> play without saving
    }
  }

  function persist(s) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) { /* ignore */ }
  }

  var api = {
    data: load(),

    save: function () { persist(api.data); },

    reset: function () { api.data = blank(); persist(api.data); },

    /** Record a finished level. Keeps the best star/score, unlocks next. */
    recordLevel: function (n, stars, score) {
      var d = api.data;
      if (stars > (d.stars[n] || 0)) d.stars[n] = stars;
      if (!d.best[n] || score > d.best[n]) d.best[n] = score;
      if (n >= d.unlocked && d.unlocked < SkyTower.MAX_LEVEL) d.unlocked = n + 1;
      persist(d);
    },

    /**
     * Record a daily-challenge completion.
     * @return {boolean} true when this is the first completion today
     *                   (i.e. the bonus should be granted).
     */
    recordDaily: function (key, bonusStars) {
      var d = api.data;
      if (d.daily[key]) return false;
      d.daily[key] = true;
      d.dailyBonus += bonusStars;
      persist(d);
      return true;
    },

    totalStars: function () {
      var d = api.data, t = d.dailyBonus;
      for (var k in d.stars) t += d.stars[k];
      return t;
    },

    isDailyDone: function (key) { return !!api.data.daily[key]; }
  };

  SkyTower.storage = api;
})();
