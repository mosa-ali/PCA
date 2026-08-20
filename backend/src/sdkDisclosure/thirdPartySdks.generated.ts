/**
 * GENERATED FILE -- do not hand-edit. Regenerate with
 * `node backend/scripts/generateSdkDisclosure.mjs` (PCA-NFR-064). Source
 * of truth is backend/package.json, platform-admin-web/package.json, and
 * android/gradle/libs.versions.toml's actual dependency entries --
 * backend/test/security/sdkDisclosure.test.mjs fails CI if this file
 * drifts from what the generator would currently produce.
 */
export interface DisclosedSdk {
  readonly name: string;
  readonly version: string;
  readonly category: string;
}

export interface ThirdPartySdkDisclosure {
  readonly disclosureVersion: number;
  readonly generatedFrom: string;
  readonly surfaces: {
    readonly backend: readonly DisclosedSdk[];
    readonly platformAdminWeb: readonly DisclosedSdk[];
    readonly android: readonly DisclosedSdk[];
    readonly ios: readonly DisclosedSdk[];
  };
}

export const THIRD_PARTY_SDK_DISCLOSURE: ThirdPartySdkDisclosure = {
  "disclosureVersion": 1,
  "generatedFrom": "backend/package.json, platform-admin-web/package.json, android/gradle/libs.versions.toml (production dependencies only)",
  "surfaces": {
    "backend": [
      {
        "name": "fastify",
        "version": "5.11.3",
        "category": "HTTP server framework"
      },
      {
        "name": "mysql2",
        "version": "3.15.2",
        "category": "database driver"
      }
    ],
    "platformAdminWeb": [
      {
        "name": "i18next",
        "version": "23.15.1",
        "category": "internationalization"
      },
      {
        "name": "i18next-browser-languagedetector",
        "version": "8.0.0",
        "category": "internationalization"
      },
      {
        "name": "react",
        "version": "18.3.1",
        "category": "UI framework"
      },
      {
        "name": "react-dom",
        "version": "18.3.1",
        "category": "UI framework"
      },
      {
        "name": "react-i18next",
        "version": "15.0.2",
        "category": "UI framework"
      },
      {
        "name": "react-router-dom",
        "version": "^7.18.2",
        "category": "UI framework"
      }
    ],
    "android": [
      {
        "name": "androidx.activity:activity-compose",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.biometric:biometric",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.camera:camera-camera2",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.camera:camera-core",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.camera:camera-lifecycle",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.compose:compose-bom",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.compose.material3:material3",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.compose.ui:ui",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.compose.ui:ui-tooling",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.compose.ui:ui-tooling-preview",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.core:core-ktx",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.fragment:fragment-ktx",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.lifecycle:lifecycle-runtime-ktx",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.room:room-compiler",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.room:room-ktx",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.room:room-runtime",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.security:security-crypto",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.work:work-runtime-ktx",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "androidx.work:work-testing",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Android Jetpack (first-party Google platform library)"
      },
      {
        "name": "org.jetbrains.kotlinx:kotlinx-coroutines-android",
        "version": "see android/gradle/libs.versions.toml",
        "category": "Kotlin standard library extension"
      }
    ],
    "ios": []
  }
} as const;
