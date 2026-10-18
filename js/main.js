/* Sky Tower MVP — bootstrap. */
'use strict';

(function () {
  function $(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', function () {
    var canvas = $('game');
    var game = SkyTower.createGame(canvas, SkyTower.ui.hooks);
    SkyTower.ui.init(game);

    window.addEventListener('resize', function () { game.resize(); });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { game.resize(); }, 200);
    });
    // keep the rAF clock sane when returning from background
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && game.getState() === 'playing') game.resume();
    });
  });
})();
