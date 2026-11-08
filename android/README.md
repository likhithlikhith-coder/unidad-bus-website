# Tally Viewer – Android app

Native Android shell around the web app in `../tally-viewer`: a single `WebView`
that serves the bundled web files through `WebViewAssetLoader` on a secure origin
(`https://appassets.androidplatform.net`), so IndexedDB, Web Workers and
`crypto.subtle` behave exactly as in Chrome. The only permission is `INTERNET`.
The shell lets the page reach two kinds of host and nothing else: TallyPrime's
XML server on a LAN address you type (Sync screen, HTTP because TallyPrime has
no TLS) and `ifsc.razorpay.com` for the optional IFSC lookup. Every other
subresource is answered with a 403 and every other `TallyBridge.request()`
target is refused. Auto Backup is off (`allowBackup="false"`); use the in-app
Backup/Restore to move data between phones.

The ready-to-install APK is in `../releases/`.

## Build

Needs JDK 17+, Android SDK platform 36 and build-tools 36.0.0 (`sdk.dir` in
`local.properties`, or `ANDROID_HOME`). Gradle 8.14.3 comes from the wrapper.

```sh
cd android
./gradlew assembleDebug      # debug key, installs beside nothing in particular
./gradlew assembleRelease    # needs keystore.properties, see below
```

The release APK lands in `app/build/outputs/apk/release/app-release.apk`.
Android Studio (Ladybug or newer) opens the `android/` folder directly.

The web app is not copied into this project; `app/build.gradle.kts` points the
`assets` source set at `../tally-viewer` (minus `README.md`, `package.json` and
`test/`), so editing the web files and rebuilding is all that is needed. Bump
`versionCode` and `versionName` in `app/build.gradle.kts` before each release;
`version.js` carries the matching web version.

## Signing key

Release builds are signed with the key named in `android/keystore.properties`
(git-ignored, as is the `keystore/` folder):

```
storeFile=keystore/tallyviewer.jks
storePassword=…
keyAlias=tallyviewer
keyPassword=…
```

Copy `keystore.properties.example` and fill it in. Without the file any task
whose name contains `Release` fails with "keystore.properties missing" rather
than quietly producing a debug-signed APK that would not install over the
published one. Debug builds always use the default debug key.

## Install on a phone

1. Copy the APK to the phone (download from GitHub, WhatsApp, Drive, USB).
2. Open it. Android asks to allow installs from that source; allow it once.
3. The app appears as **Tally Viewer**. Sharing or "Open with" on a Tally XML
   export also lands in the app and queues an import.

## The bridge (`window.TallyBridge`)

`MainActivity.TallyBridge` is exposed to the page with `addJavascriptInterface`.
Every call returns at once and reports back through a page callback on the UI
thread; the user agent carries ` TallyViewerApp/1.9` so the page can tell it is
inside the APK.

| Method | What it does | Reports through |
| --- | --- | --- |
| `request(id, url, xml)` | POSTs `xml` to TallyPrime at `url` (only `http(s)` to `10.*`, `192.168.*`, `172.16-31.*`, `169.254.*`, `127.*`, `localhost` or `*.local`), writes the reply to `cache/<id>.xml` | `TallyBridgeDone(id, ok, idOrError)`; the page then fetches `/cache/<id>.xml` |
| `discard(id)` | Deletes `cache/<id>.xml` and `cache/<id>-*` | – |
| `saveFile(name, mime, base64)` | Saves to `Downloads/TallyViewer` (Android 10+) or the app's own `Android/data/…/files/Download` (7–9). Save only, no share sheet | `TallyBridgeSaved(name, true, where)` |
| `shareFile(name, mime, base64, target, phone, text)` | Writes to `cache/exports` and opens WhatsApp (`target="whatsapp"`, optional number) or the system chooser | `TallyBridgeSaved(name, ok, info)` |
| `pickFolder(id)` | System folder picker; copies `Manager.1800`, `TranMgr.1800`, `Company.1800` (also from immediate sub-folders) to `cache/<id>-<name>` | `TallyBridgeFolder(id, ok, "name\|name…")` |
| `setSecure(on)` | Sets/clears `FLAG_SECURE` (no screenshots, blank recents thumbnail) – the page turns it on while a PIN is set | – |
| `setChrome(bgHex, lightIcons)` | Colours the area behind the system bars and switches the bar icons dark/light to match the theme | – |
| `version()` | Bridge API level, currently `"2"` | – |

Callbacks the shell makes without a request first:

- `TallyBridgeOpen(id, displayName)` – a file arrived through *Open with* /
  *Share to Tally Viewer* (`VIEW`, `SEND`, `SEND_MULTIPLE`); it was copied to
  `cache/<id>.xml` and the page should import it like a sync reply.
- `TVBack()` – the hardware/gesture back. Return `true` when the page handled
  it (closed a sheet, PIN screen showing); otherwise the shell goes back in the
  WebView history or closes the app.
- `TVRelock()` – the app returned to the foreground; the page decides whether
  to ask for the PIN again.

Ids passed to the bridge must match `[A-Za-z0-9_-]{1,64}`; files are served
back to the page from `https://appassets.androidplatform.net/cache/<file>`.
Files in `cache/tally` and `cache/exports` older than 24 hours are deleted at
startup.
