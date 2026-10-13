import java.net.URI

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
}

// The Parent Web build consumes this same canonical origin as
// VITE_PCA_CHILD_APP_PUBLIC_ORIGIN. Only the host is placed in Android's
// App Link filter; the fixed /enroll/ path prevents taking over other public
// website routes.
val configuredChildAppPublicOrigin = System.getenv("PCA_CHILD_APP_PUBLIC_ORIGIN")
    ?.trim()
    ?.takeIf { it.isNotEmpty() }
    ?: "https://www.pcasafe.com"
val parsedChildAppPublicOrigin = URI(configuredChildAppPublicOrigin)
require(
    parsedChildAppPublicOrigin.scheme.equals("https", ignoreCase = true) &&
        !parsedChildAppPublicOrigin.host.isNullOrBlank() &&
        parsedChildAppPublicOrigin.userInfo == null &&
        (parsedChildAppPublicOrigin.rawPath.isNullOrEmpty() || parsedChildAppPublicOrigin.rawPath == "/") &&
        parsedChildAppPublicOrigin.rawQuery == null &&
        parsedChildAppPublicOrigin.rawFragment == null &&
        (parsedChildAppPublicOrigin.port == -1 || parsedChildAppPublicOrigin.port == 443),
) {
    "PCA_CHILD_APP_PUBLIC_ORIGIN must be an HTTPS origin without path, credentials, query, fragment, or nonstandard port."
}
val childAppLinkHost = parsedChildAppPublicOrigin.host.lowercase()
val childAppLinkPathPrefix = "/enroll/"

// A Play/managed release update must carry a monotonically increasing package
// version code. Keep stable local/CI defaults, while allowing the release
// pipeline to supply the next owner-approved version without source edits.
// A present but invalid value fails configuration rather than silently
// producing another artifact with the default version code.
val androidVersionCodePattern = Regex("^[1-9][0-9]{0,9}$")
val configuredAndroidVersionCode = System.getenv("PCA_ANDROID_VERSION_CODE")
val androidVersionCode = if (configuredAndroidVersionCode == null) {
    1
} else {
    configuredAndroidVersionCode.trim().takeIf { androidVersionCodePattern.matches(it) }
        ?.toIntOrNull()?.takeIf { it in 1..2_100_000_000 }
        ?: error("PCA_ANDROID_VERSION_CODE must be an integer from 1 through 2100000000.")
}
val configuredAndroidVersionName = System.getenv("PCA_ANDROID_VERSION_NAME")
val androidVersionName = if (configuredAndroidVersionName == null) "0.1.0" else configuredAndroidVersionName.trim()
require(androidVersionName.isNotEmpty()) { "PCA_ANDROID_VERSION_NAME must not be blank when supplied." }
require(androidVersionName.length <= 64 && androidVersionName.none { it.isISOControl() }) {
    "PCA_ANDROID_VERSION_NAME must be at most 64 characters and contain no control characters."
}

android {
    namespace = "org.pca.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.pca.app"
        minSdk = 26
        targetSdk = 35
        versionCode = androidVersionCode
        versionName = androidVersionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["pcaChildAppLinkHost"] = childAppLinkHost
        manifestPlaceholders["pcaChildAppLinkPathPrefix"] = childAppLinkPathPrefix
        buildConfigField("String", "PCA_CHILD_APP_LINK_HOST", "\"$childAppLinkHost\"")
        buildConfigField("String", "PCA_CHILD_APP_LINK_PATH_PREFIX", "\"$childAppLinkPathPrefix\"")
    }

    // AGP 8+ no longer generates BuildConfig by default; the pre-existing
    // LaunchShellContractTest reads BuildConfig.APPLICATION_ID, so it must be
    // explicitly opted back in. Same fix independently required and verified
    // in the claude-1-pca0-2 lane's build.gradle.kts.
    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Explicit and consistent: without this, Java compile tasks fall back to
    // AGP's own default (1.8) while the Kotlin compiler targets the running
    // JDK (17 here), and the mismatch fails the build ("Inconsistent
    // JVM-target compatibility detected for tasks 'compileDebugJavaWithJavac'
    // (1.8) and 'compileDebugKotlin' (17)"). Same fix independently required
    // and verified in the claude-1-pca0-2 lane's build.gradle.kts.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // PCA-16 (lane brief Section 13): en-XA/ar-XB pseudo-locales surface hard-coded strings,
    // truncation and text-expansion issues in debug builds without needing physical Arabic
    // review for every iteration. Debug-only -- never shipped to a release build.
    // ANDROID_RELEASE_SIGNING_CONFIG (docs/release_readiness/external_gate_matrix.json), the
    // repository side of that gate. A release build type now exists, shrinks and obfuscates with
    // R8, and signs with a keystore that is NEVER committed: the four PCA_RELEASE_* values come
    // from the environment (a CI secret store or the release operator's shell). When they are
    // absent the release artifact is built UNSIGNED, so R8/lint problems surface on every CI run
    // without any secret present -- an unsigned release APK is not installable and is never a
    // release candidate. The gate itself closes only when the owner's keystore exists and a
    // signed artifact's provenance is recorded in docs/release_readiness/RELEASE_EVIDENCE.md.
    val releaseKeystorePath: String? = System.getenv("PCA_RELEASE_KEYSTORE_PATH")
    val releaseKeystorePassword: String? = System.getenv("PCA_RELEASE_KEYSTORE_PASSWORD")
    val releaseKeyAlias: String? = System.getenv("PCA_RELEASE_KEY_ALIAS")
    val releaseKeyPassword: String? = System.getenv("PCA_RELEASE_KEY_PASSWORD")
    val releaseSigningValues = listOf(
        releaseKeystorePath,
        releaseKeystorePassword,
        releaseKeyAlias,
        releaseKeyPassword,
    )
    val hasAnyReleaseSigningValue = releaseSigningValues.any { !it.isNullOrBlank() }
    val hasReleaseSigning = releaseSigningValues.all { !it.isNullOrBlank() }
    require(!hasAnyReleaseSigningValue || hasReleaseSigning) {
        "PCA release signing is partially configured; set all four PCA_RELEASE_* values or leave all four unset."
    }
    if (hasReleaseSigning) {
        require(file(releaseKeystorePath!!).isFile) {
            "PCA_RELEASE_KEYSTORE_PATH must point to an existing keystore file."
        }
    }
    if (hasReleaseSigning) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                storePassword = releaseKeystorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    } else {
        logger.warn("PCA release signing: PCA_RELEASE_KEYSTORE_PATH/PCA_RELEASE_KEYSTORE_PASSWORD/PCA_RELEASE_KEY_ALIAS/PCA_RELEASE_KEY_PASSWORD not set -- assembleRelease produces an UNSIGNED artifact (ANDROID_RELEASE_SIGNING_CONFIG gate open).")
    }

    buildTypes {
        debug {
            isPseudoLocalesEnabled = true
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseSigning) signingConfigs.getByName("release") else null
        }
    }

    lint {
        lintConfig = file("../lint.xml")
        abortOnError = true
        checkReleaseBuilds = true
    }

    sourceSets {
        getByName("androidTest") {
            assets.srcDirs(files("$projectDir/schemas"))
        }
    }
}

// PCA-LOCAL-DB-1: Room's `exportSchema = true` (set on PcaLocalDatabase) needs
// a KSP-side destination for the versioned schema JSON artifacts consumed by
// androidx.room.testing.MigrationTestHelper -- doc 06/PCA-LOCAL-DB-1 Section 22.
ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
    arg("room.generateKotlin", "true")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    // Forces transitive androidx.fragment >=1.3.0; see comment on androidx-fragment-ktx in
    // libs.versions.toml (InvalidFragmentVersionForActivityResult lint fix).
    implementation(libs.androidx.fragment.ktx)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    implementation(libs.kotlinx.coroutines.android)
    // PCA-AND-RUNTIME-PLATFORM-1: the app's first real background-execution primitive
    // (WorkManager/CoroutineWorker) -- see android/app/src/main/java/org/pca/app/runtime/background/.
    implementation(libs.androidx.work.runtime.ktx)
    // PCA-ADD-ENR-013: BiometricPrompt gate for sensitive local admin actions
    // (e.g. disabling protection, viewing sensitive settings) -- the official
    // Jetpack wrapper over BiometricManager/BiometricPrompt, not a custom
    // biometric implementation.
    implementation(libs.androidx.biometric)
    // PCA-FR-024 (CameraXFrameSource): Tier-2 foreground-only, single-frame ImageAnalysis source
    // for CameraProximitySource -- no camera-view/video-capture/extensions artifacts, since this
    // feature never previews, records, or uploads camera output.
    implementation(libs.androidx.camera.core)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    ksp(libs.androidx.room.compiler)

    testImplementation(libs.junit)
    testImplementation(libs.androidx.room.testing)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.org.json)
    testImplementation(libs.androidx.work.testing)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.room.testing)

    debugImplementation(libs.androidx.compose.ui.tooling)
}
