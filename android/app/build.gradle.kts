plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "org.pca.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.pca.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // AGP 8+ no longer generates BuildConfig by default; the existing test
    // (LaunchShellContractTest) reads BuildConfig.APPLICATION_ID, so it must
    // be explicitly opted back in.
    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Explicit and consistent: without this, Java compile tasks fall back to
    // AGP's own default (1.8) while the Kotlin compiler targets the running
    // JDK (17 here), and the mismatch fails the build ("Inconsistent
    // JVM-target compatibility detected for tasks 'compileDebugJavaWithJavac'
    // (1.8) and 'compileDebugKotlin' (17)").
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        lintConfig = file("../lint.xml")
        abortOnError = true
        checkReleaseBuilds = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)

    testImplementation(libs.junit)
    debugImplementation(libs.androidx.compose.ui.tooling)
}

