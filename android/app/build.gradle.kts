import java.util.Properties

plugins {
    id("com.android.application")
}

android {
    namespace = "com.unidad.tallyviewer"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.unidad.tallyviewer"
        minSdk = 24
        targetSdk = 35
        versionCode = 3
        versionName = "1.2.0"
    }

    // The web app lives in ../tally-viewer and is bundled as-is into the APK's assets.
    sourceSets {
        getByName("main") {
            assets.srcDirs("../../tally-viewer")
        }
    }

    // Release signing comes from keystore.properties (git-ignored). Without it the
    // build still succeeds using the default debug key, but such an APK will not
    // install as an update over one signed with the real key.
    val keystoreProps = Properties()
    val keystoreFile = rootProject.file("keystore.properties")
    if (keystoreFile.exists()) keystoreFile.inputStream().use { keystoreProps.load(it) }
    val hasKey = keystoreProps.getProperty("storeFile") != null
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
            signingConfig = if (hasKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
        debug {
            if (hasKey) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        resources.excludes += setOf("META-INF/*")
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
