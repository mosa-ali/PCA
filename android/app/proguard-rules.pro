# Intentionally empty: the launch shell has no product features or data paths.

# ---- PCA release build rules (2026-09-08) --------------------------------------------------
# Room persists several enums by name (FamilyMemberRole, DeviceTrustState, RetentionPolicy, ...)
# and reads them back with valueOf(); keep every persistence entity/enum verbatim so an
# obfuscated constant name can never corrupt a stored row or a migration.
-keep class org.pca.app.persistence.entity.** { *; }
# Retraceable crash reports without leaking source paths: keep line numbers, rename the
# source-file attribute. Nothing else here is reflected over; coroutines, WorkManager,
# security-crypto and CameraX ship their own consumer rules.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod, SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile

# Tink (transitively via androidx.security:security-crypto) references compile-only annotation
# types at runtime that are never shipped; R8 reports them as missing classes. These are the
# exact rules AGP generates into missing_rules.txt for this dependency set (2026-09-08).
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
-dontwarn javax.annotation.Nullable
-dontwarn javax.annotation.concurrent.GuardedBy
