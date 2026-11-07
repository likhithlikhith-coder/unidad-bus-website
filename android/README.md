# Tally Viewer – Android app

Native Android shell around the web app in `../tally-viewer`. It is a single
`WebView` that serves the bundled web files through `WebViewAssetLoader` on a
secure origin (`https://appassets.androidplatform.net`), so IndexedDB, Web
Workers and the service worker behave exactly as in Chrome. The only
permission is `INTERNET`, used solely by the Sync screen to reach TallyPrime's
XML server at the address you type on your own Wi-Fi; the app has no server of
its own and contacts nothing else.

The ready-to-install APK is in `../releases/`.

`MainActivity` also exposes `window.TallyBridge` to the page: it POSTs an XML
request to the PC, writes the reply to the app cache, and the page reads it back
through the asset loader, so large exports never pass through a JavaScript
string.

## Install on a phone

1. Copy the APK to the phone (download from GitHub, WhatsApp, Drive, USB).
2. Open it. Android will ask to allow installs from that source; allow it once.
3. The app appears as **Tally Viewer**.

## Build in Android Studio

1. Open the `android/` folder in Android Studio (Hedgehog or newer).
2. Let it sync. It needs compile SDK 35 and JDK 17 or newer, which Android
   Studio offers to install.
3. **Build → Generate Signed App Bundle / APK → APK**, or run
   `./gradlew assembleRelease` from this folder.
   The release APK lands in `app/build/outputs/apk/release/app-release.apk`.

The web app is not copied into this project; `app/build.gradle.kts` points the
`assets` source set at `../tally-viewer`, so editing the web files and
rebuilding is all that is needed.

## Signing key

Release builds are signed with the key named in `keystore.properties` (both the
properties file and the `keystore/` folder are git-ignored, so the private key
never enters the repository). To rebuild an APK that installs as an **update**
over the one in `releases/` and keeps the imported company data:

1. Put the original `tallyviewer.jks` in `android/keystore/`.
2. Copy `keystore.properties.example` to `keystore.properties` and fill in the
   passwords.

Without those files the build uses the default debug key. That APK still works,
but the phone will refuse to install it over the differently-signed app until
the old one is uninstalled.

## Updating the app

Bump `versionCode` (and `versionName`) in `app/build.gradle.kts` before each
release build; Android refuses to install an APK whose `versionCode` is not
higher than the installed one.
