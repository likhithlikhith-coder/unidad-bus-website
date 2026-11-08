import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing comes from keystore.properties (git-ignored). A release build without it is
// refused outright (see the taskGraph check at the bottom) instead of silently falling back to
// the debug key, which would produce an APK that cannot install as an update over the published one.
val keystoreProps = Properties()
val keystoreFile = rootProject.file("keystore.properties")
if (keystoreFile.exists()) keystoreFile.inputStream().use { keystoreProps.load(it) }
val hasKey = keystoreProps.getProperty("storeFile") != null

android {
    namespace = "com.unidad.tallyviewer"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "com.unidad.tallyviewer"
        minSdk = 24
        targetSdk = 36
        versionCode = 10
        versionName = "1.9.0"
    }

    // The web app lives in ../tally-viewer and is bundled as-is into the APK's assets.
    sourceSets {
        getByName("main") {
            assets.srcDirs("../../tally-viewer")
        }
    }

    // Only the runtime files ship: the web app's README, package.json and Node tests stay out of the APK.
    // (The first ten patterns are aapt's defaults, which are replaced rather than extended by this list.)
    androidResources {
        ignoreAssetsPatterns += listOf(
            "!.svn", "!.git", "!.ds_store", "!*.scc", ".*", "<dir>_*", "!CVS", "!thumbs.db", "!picasa.ini", "!*~",
            "!README.md", "!package.json", "!package-lock.json", "!test", "!node_modules"
        )
    }

    if (hasKey) {
        signingConfigs {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasKey) signingConfig = signingConfigs.getByName("release")
        }
        // debug builds keep the default debug key, so day-to-day builds never touch the release key
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        resources.excludes += setOf("META-INF/*")
    }
}

// Refuse to build any release variant without the real key rather than signing it with the debug key.
gradle.taskGraph.whenReady {
    if (!hasKey && allTasks.any { it.project == project && it.name.contains("Release") }) {
        throw GradleException("keystore.properties missing – refusing to build a release signed with the debug key")
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.core:core:1.16.0")
}
