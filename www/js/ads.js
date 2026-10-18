/* Sky Tower — ads & IAP integration (Capacitor + AdMob + Play Billing / StoreKit).
 *
 * BEHAVIOUR:
 *  - In a Capacitor native app: uses @capacitor-community/admob with the
 *    ad unit IDs below, and cordova-plugin-purchase for the remove-ads IAP
 *    (Google Play on Android, StoreKit on iOS).
 *  - In a plain browser: falls back to simulated ads (instant reward) so the
 *    game stays fully playable on the web.
 *
 * AD UNIT IDS — platform-specific:
 *   Android (REAL, user's AdMob account):
 *     App ID:        ca-app-pub-2490012576999564~6815382791
 *     Rewarded:      ca-app-pub-2490012576999564/4446124343
 *     Interstitial:  ca-app-pub-2490012576999564/2189917083
 *   iOS (Google OFFICIAL TEST ids — replace with real ids from AdMob console):
 *     App ID:        ca-app-pub-3940256099942544~1458002511
 *     Rewarded:      ca-app-pub-3940256099942544/1712485313
 *     Interstitial:  ca-app-pub-3940256099942544/4411468910
 * >>> BEFORE iOS RELEASE: replace the iOS test ids with your own <<<
 *     (AdMob console -> Apps -> Sky Tower (iOS) -> Ad units,
 *      and update GADApplicationIdentifier in ios/App/App/Info.plist)
 *
 * IAP — product id "skytower_remove_ads" ($2.99, non-consumable).
 *   Android: create in Play Console (Monetize -> Products -> In-app products).
 *   iOS:     create in App Store Connect (same product id).
 */
'use strict';

(function () {
  var AD_IDS = {
    android: {
      appId: 'ca-app-pub-2490012576999564~6815382791',
      rewardedAdId: 'ca-app-pub-2490012576999564/4446124343',
      interstitialAdId: 'ca-app-pub-2490012576999564/2189917083'
    },
    ios: {
      // Google official TEST ids — replace before iOS release
      appId: 'ca-app-pub-3940256099942544~1458002511',
      rewardedAdId: 'ca-app-pub-3940256099942544/1712485313',
      interstitialAdId: 'ca-app-pub-3940256099942544/4411468910'
    }
  };

  function currentPlatform() {
    try {
      if (window.Capacitor && window.Capacitor.getPlatform) {
        return window.Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
      }
    } catch (e) {}
    return 'web';
  }

  var _plat = currentPlatform();
  var _ids = AD_IDS[_plat] || AD_IDS.android;

  var CFG = {
    appId: _ids.appId,
    rewardedAdId: _ids.rewardedAdId,
    interstitialAdId: _ids.interstitialAdId,
    removeAdsSku: 'skytower_remove_ads',
    platform: _plat
  };

  var SIMULATED_AD_MS = 400;

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform &&
               window.Capacitor.isNativePlatform());
  }

  function admob() {
    try {
      return window.Capacitor && window.Capacitor.Plugins &&
             window.Capacitor.Plugins.AdMob;
    } catch (e) { return null; }
  }

  var rewardedReady = false;
  var interstitialReady = false;
  var adsRemoved = false; // cached; persisted in localStorage
  var admobInit = false;

  try { adsRemoved = localStorage.getItem('skytower_ads_removed') === '1'; } catch (e) {}

  function initAdMob() {
    if (admobInit || !isNative()) return;
    var A = admob();
    if (!A) return;
    admobInit = true;
    A.initialize({ requestTrackingAuthorization: false }).then(function () {
      prepareRewarded();
      prepareInterstitial();
    }).catch(function (e) {
      console.warn('[ads] AdMob init failed', e);
    });
  }

  function prepareRewarded() {
    var A = admob();
    if (!A || adsRemoved) return;
    A.prepareRewardVideoAd({ adId: CFG.rewardedAdId }).then(function () {
      rewardedReady = true;
    }).catch(function (e) { console.warn('[ads] rewarded prepare failed', e); });
    // Re-arm after each show
    A.addListener('onRewardedVideoAdDismiss', function () {
      rewardedReady = false;
      prepareRewarded();
    });
  }

  function prepareInterstitial() {
    var A = admob();
    if (!A || adsRemoved) return;
    A.prepareInterstitial({ adId: CFG.interstitialAdId }).then(function () {
      interstitialReady = true;
    }).catch(function (e) { console.warn('[ads] interstitial prepare failed', e); });
    A.addListener('onInterstitialDismiss', function () {
      interstitialReady = false;
      prepareInterstitial();
    });
  }

  /* ---------- IAP (cordova-plugin-purchase: Play Billing + StoreKit) ---------- */
  var iapInit = false;

  function initIAP() {
    if (iapInit || !isNative()) return;
    if (!window.CdvPurchase) { console.warn('[iap] CdvPurchase not found'); return; }
    iapInit = true;
    try {
      var store = window.CdvPurchase.store;
      var ProductType = window.CdvPurchase.ProductType;
      var Platform = window.CdvPurchase.Platform;
      // Pick the store platform: Google Play on Android, App Store (StoreKit) on iOS
      var storePlatform = (CFG.platform === 'ios') ? Platform.APPLE_APPSTORE : Platform.GOOGLE_PLAY;
      store.register([{
        id: CFG.removeAdsSku,
        type: ProductType.NON_CONSUMABLE,
        platform: storePlatform
      }]);
      store.addEventListener('approved', function (p) {
        if (p.id === CFG.removeAdsSku) {
          p.verify();
        }
      });
      store.addEventListener('verified', function (p) {
        if (p.id === CFG.removeAdsSku) {
          p.finish();
          setAdsRemoved(true);
        }
      });
      store.addEventListener('owned', function (p) {
        if (p.id === CFG.removeAdsSku) setAdsRemoved(true);
      });
      store.initialize([storePlatform]).then(function () {
        var p = store.get(CFG.removeAdsSku);
        if (p && p.owned) setAdsRemoved(true);
      }).catch(function (e) { console.warn('[iap] init failed', e); });
    } catch (e) {
      console.warn('[iap] init error', e);
    }
  }

  function setAdsRemoved(v) {
    adsRemoved = !!v;
    try { localStorage.setItem('skytower_ads_removed', adsRemoved ? '1' : '0'); } catch (e) {}
  }

  /* ---------- public API ---------- */
  var Ads = {
    config: CFG,

    /** Call once at boot. Safe in browser (no-op). */
    init: function () {
      initAdMob();
      initIAP();
    },

    /**
     * Rewarded video ad. Used by "Watch Ad to Revive".
     * Reward is granted only after the user finishes the ad
     * (in native). In browser, simulated instantly.
     */
    showRewarded: function (opts) {
      opts = opts || {};
      var onReward = opts.onReward || function () {};
      var onClose = opts.onClose || function () {};

      if (!isNative() || !admob()) {
        setTimeout(function () { try { onReward(); } catch (e) {} }, SIMULATED_AD_MS);
        return;
      }
      var A = admob();
      var done = function (rewarded) {
        if (rewarded) { try { onReward(); } catch (e) {} }
        else { try { onClose(); } catch (e) {} }
      };
      var rewardHandler = null;
      var dismissHandler = null;
      var cleanup = function () {
        try { if (rewardHandler) rewardHandler.remove(); } catch (e) {}
        try { if (dismissHandler) dismissHandler.remove(); } catch (e) {}
      };
      var show = function () {
        A.showRewardVideoAd().then(function () {
          // listeners below decide reward vs close
        }).catch(function (e) {
          console.warn('[ads] show rewarded failed', e);
          cleanup();
          done(false);
        });
      };
      Promise.all([
        A.addListener('onRewardedVideoAdReward', function () {
          cleanup();
          rewardedReady = false;
          prepareRewarded();
          done(true);
        }),
        A.addListener('onRewardedVideoAdDismiss', function () {
          // if reward already fired, ignore
          setTimeout(function () { cleanup(); }, 0);
          try { onClose(); } catch (e) {}
          rewardedReady = false;
          prepareRewarded();
        })
      ]).then(function (hs) {
        rewardHandler = hs[0];
        dismissHandler = hs[1];
        if (rewardedReady) {
          show();
        } else {
          // not preloaded: prepare then show
          A.prepareRewardVideoAd({ adId: CFG.rewardedAdId }).then(function () {
            rewardedReady = true;
            show();
          }).catch(function (e) {
            console.warn('[ads] rewarded not ready', e);
            cleanup();
            done(false);
          });
        }
      });
    },

    /**
     * Interstitial ad. Call sparingly (every 3rd level clear).
     * Suppressed when the user owns remove-ads.
     */
    showInterstitial: function () {
      if (adsRemoved || !isNative()) return;
      var A = admob();
      if (!A) return;
      var show = function () {
        A.showInterstitial().catch(function (e) {
          console.warn('[ads] show interstitial failed', e);
        });
      };
      if (interstitialReady) {
        show();
      } else {
        A.prepareInterstitial({ adId: CFG.interstitialAdId }).then(function () {
          interstitialReady = true;
          show();
        }).catch(function (e) { console.warn('[ads] interstitial not ready', e); });
      }
    },

    /** @return {boolean} true when the user owns the remove-ads IAP. */
    isAdsRemoved: function () { return adsRemoved; },

    /** Starts the $2.99 remove-ads purchase flow (native only). */
    purchaseRemoveAds: function () {
      if (!isNative() || !window.CdvPurchase) {
        console.warn('[iap] purchase only available in the native app');
        return Promise.resolve(false);
      }
      try {
        var store = window.CdvPurchase.store;
        var p = store.get(CFG.removeAdsSku);
        if (!p) {
          console.warn('[iap] product not found (not configured in Play Console?)');
          return Promise.resolve(false);
        }
        return store.order(CFG.removeAdsSku).then(function () { return true; })
          .catch(function (e) { console.warn('[iap] order failed', e); return false; });
      } catch (e) {
        console.warn('[iap] order error', e);
        return Promise.resolve(false);
      }
    }
  };

  // Back-compat hook (web build contract)
  window.showRewardedAd = function (opts) { Ads.showRewarded(opts || {}); };

  // Auto-init on script load; also safe to call Ads.init() again later.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { Ads.init(); });
  } else {
    Ads.init();
  }

  window.SkyTower = window.SkyTower || {};
  window.SkyTower.ads = Ads;
})();
