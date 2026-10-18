# Sky Tower — HTML5 MVP (hybrid-casual)

English stacking-tower game, rebuilt as a **hybrid-casual** MVP:
100 levels + daily challenge + stars + local saves, ready to be wrapped
into a native app (Capacitor) with AdMob rewarded/interstitial ads and
a remove-ads IAP.

## Play it

```bash
cd ~/workspace/game-sky-tower
python3 -m http.server 8080
# open http://localhost:8080/ (best on a phone browser)
```

No build step, no dependencies. Pure HTML/CSS/JS.

## Gameplay

- **Goal per level**: stack the target number of blocks (8 → 30 as levels rise).
- **Controls**: tap / click / Space to drop the sliding block.
- **Perfect drop** (centered): keeps full width, builds **combo**, bonus points
  (`100 + 50 × combo`). Sloppy drops trim the overhang.
- **Miss** (no overlap): lose 1 heart. 3 misses = level failed.
- **Stars**: finishing a level always earns ★; higher score → ★★ / ★★★
  (thresholds = 45% / 70% of the level's theoretical max score).
- **Daily Challenge**: one seeded challenge per calendar day — same for every
  player worldwide. First completion each day grants **+2 bonus stars**.
- **Revive**: "📺 Watch Ad to Revive" on the fail screen refills hearts once
  per attempt. **MVP: instant revive (AdMob plugs in here — see below).**

## Project layout

```
index.html          screens: home / level-select / game + overlays
css/style.css       mobile-first, portrait, dark-mode aware
js/config.js        level curve, star thresholds, daily-challenge seed (pure fns)
js/storage.js       localStorage save: unlocked, stars, best scores, dailies
js/ads.js           ad/IAP integration points (shim — see below)
js/game.js          canvas engine: physics, particles, audio, hearts, win/fail
js/ui.js            screens, HUD, level grid, results, pause
js/main.js          bootstrap
```

`js/config.js` has no DOM access — unit-testable with node.

## Save format (`localStorage["skytower_save_v1"]`)

```json
{
  "unlocked": 5,
  "stars": { "1": 3, "2": 2 },
  "best": { "1": 2450 },
  "daily": { "2026-10-18": true },
  "dailyBonus": 2,
  "muted": false
}
```

## Monetization hooks (for the native build)

All integration points live in **`js/ads.js`** — swap the shim bodies,
game code needs no changes:

| Hook | Used for | MVP | Production |
|---|---|---|---|
| `SkyTower.ads.showRewarded({onReward, onClose})` | Revive on fail screen | resolves after ~400ms | `@capacitor-community/admob` rewarded video |
| `window.showRewardedAd(opts)` | same (web-build compat) | same shim | same |
| `SkyTower.ads.showInterstitial()` | every 3rd level clear (`ui.js`: `levelsSinceAd`) | no-op | AdMob interstitial |
| `SkyTower.ads.isAdsRemoved()` | skip interstitials when owned | `false` | storekit entitlement check |
| `SkyTower.ads.purchaseRemoveAds()` | $2.99 remove-ads button (add to home screen) | stub | storekit purchase |

Interstitial pacing rule (already coded): every 3rd level clear, never on
first launch, never mid-level.

## Going native (Capacitor)

### Android (done)
- `npx cap add android`, AdMob wired with real ad unit IDs (`js/ads.js`)
- IAP `skytower_remove_ads` ($2.99) via cordova-plugin-purchase (Play Billing)
- Release AAB: `cd android && ./gradlew bundleRelease` (keystore: `skytower-release.keystore`)

### iOS (scaffolded)
- `npx cap add ios` (bundle id `com.glownest.skytower`)
- AdMob iOS: Google **test** IDs in `js/ads.js` (`AD_IDS.ios`) + `GADApplicationIdentifier`
  in `ios/App/App/Info.plist` — **replace with real iOS ad unit IDs before release**
  (AdMob console → add iOS app → ad units; also update Info.plist's
  `GADApplicationIdentifier`)
- IAP: same product id `skytower_remove_ads` via StoreKit (cordova-plugin-purchase
  `Platform.APPLE_APPSTORE`); create the product in App Store Connect
- CI: `.github/workflows/ios-build.yml` builds an **unsigned** IPA on macOS runner
  (compilation check). App Store signing needs the user's App Store Connect API key.

### Store fees
Google Play $25 one-time, Apple $99/year.

## Tuning knobs (`js/config.js`)

- `levelConfig()`: target length, speed, start width curves
- `starThresholds()`: 0.45 / 0.70 of max score
- `HEARTS`: misses allowed (3)
- `dailyConfig()`: target/speed/width ranges for the daily seed
- Scoring lives in `js/game.js` → `land()` (100 base, `100 + 50×combo` perfect)
