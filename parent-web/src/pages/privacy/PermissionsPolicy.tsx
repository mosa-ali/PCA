// PCA-NFR-061: privacy policy page explaining each real, on-device runtime
// permission PCA's Android app can ask for, mapped 1:1 to the permission
// list actually declared in android/app/src/main/AndroidManifest.xml's
// <uses-permission> entries -- never a fabricated or aspirational
// permission. Each entry's purpose/data-path text is grounded in the real
// capability-source class that requests/consumes that permission (cited per
// key below: org.pca.app.platform.StandardLocationCapabilitySource,
// org.pca.app.feature.wellbeing.delivery.WellbeingNotificationDelivery,
// org.pca.app.runtime.connectivity.NetworkConnectivityObserver,
// org.pca.app.runtime.communication.AndroidTelephonyCallStateObserver,
// org.pca.app.runtime.prayer.AlarmManagerPrayerScheduler,
// org.pca.app.feature.webprotection.vpn.WebProtectionVpnService,
// org.pca.app.platform.proximity.CameraProximitySource) and cross-checked
// against docs/architecture/03_FUNCTIONAL_REQUIREMENTS.md Section C
// (eye-distance) and docs/architecture/09_SECURITY_PRIVACY_E2EE.md Section 5
// (server-knowledge boundary) for what happens to the resulting data.
//
// This is distinct from Transparency.tsx (PCA-FR-096/PCA-FR-121), which
// lists data CATEGORIES visible to a parent in this console. This page
// instead lists the actual OS-level permission grants the Android app
// requests on-device -- the underlying capability, not the console view of
// its output.
import { useTranslation } from 'react-i18next';

// Exact android:name values from android/app/src/main/AndroidManifest.xml's
// <uses-permission> entries, in the same order as that file. Keep this list
// -- and only this list -- in sync with the manifest: never add or drop an
// entry here without the manifest changing first.
const PERMISSION_KEYS = [
  'accessFineLocation',
  'accessCoarseLocation',
  'accessBackgroundLocation',
  'postNotifications',
  'accessNetworkState',
  'readPhoneState',
  'scheduleExactAlarm',
  'foregroundService',
  'foregroundServiceSpecialUse',
  'camera',
] as const;

const MANIFEST_PERMISSION_NAMES: Record<(typeof PERMISSION_KEYS)[number], string> = {
  accessFineLocation: 'android.permission.ACCESS_FINE_LOCATION',
  accessCoarseLocation: 'android.permission.ACCESS_COARSE_LOCATION',
  accessBackgroundLocation: 'android.permission.ACCESS_BACKGROUND_LOCATION',
  postNotifications: 'android.permission.POST_NOTIFICATIONS',
  accessNetworkState: 'android.permission.ACCESS_NETWORK_STATE',
  readPhoneState: 'android.permission.READ_PHONE_STATE',
  scheduleExactAlarm: 'android.permission.SCHEDULE_EXACT_ALARM',
  foregroundService: 'android.permission.FOREGROUND_SERVICE',
  foregroundServiceSpecialUse: 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  camera: 'android.permission.CAMERA',
};

export default function PermissionsPolicy() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="permissions-policy-title">
      <h1 id="permissions-policy-title">{t('permissionsPolicy.title')}</h1>
      <p>{t('permissionsPolicy.intro')}</p>
      <p>{t('permissionsPolicy.scopeNotice')}</p>

      <div className="card">
        <h2>{t('permissionsPolicy.androidHeading')}</h2>
        <dl>
          {PERMISSION_KEYS.map((key) => (
            <div className="permission-entry" key={key}>
              <dt>
                {t(`permissionsPolicy.permissions.${key}.name`)} <code>{MANIFEST_PERMISSION_NAMES[key]}</code>
              </dt>
              <dd>{t(`permissionsPolicy.permissions.${key}.purpose`)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p>{t('permissionsPolicy.encryptionNote')}</p>
      <p>{t('permissionsPolicy.exhaustiveNote')}</p>
    </section>
  );
}
