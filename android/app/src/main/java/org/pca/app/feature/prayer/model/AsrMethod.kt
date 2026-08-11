package org.pca.app.feature.prayer.model

/** Shadow-length factor used to determine Asr: standard (Shafi'i/Maliki/Hanbali) uses 1x
 * an object's shadow beyond its noon shadow; Hanafi uses 2x. */
enum class AsrMethod(val shadowFactor: Int) {
    STANDARD(shadowFactor = 1),
    HANAFI(shadowFactor = 2),
}
