# 33 — Official Reference Sources

**Source review date:** 2026-08-10

Platform/API behavior changes over time. Revalidate these sources before the relevant implementation phase and before store submission.

## Android — official Android Developers

- DevicePolicyManager API: https://developer.android.com/reference/android/app/admin/DevicePolicyManager
- Device control / DPC: https://developer.android.com/work/dpc/device-management
- Build a device policy controller: https://developer.android.com/work/dpc/build-dpc
- Lock task mode: https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode
- UsageStatsManager: https://developer.android.com/reference/android/app/usage/UsageStatsManager
- UsageEvents.Event: https://developer.android.com/reference/android/app/usage/UsageEvents.Event
- VpnService: https://developer.android.com/reference/android/net/VpnService
- Android VPN guide: https://developer.android.com/develop/connectivity/vpn

Key verified facts used by the architecture:
- UsageStats supports application usage/event queries including screen interactive events.
- `VpnService` is the public basis for app-provided VPN/network filtering.
- DPC device/profile-owner authority can suspend packages and, with required authority, block uninstall.
- Lock task mode is an Android managed-device capability, not a promise for ordinary unprivileged apps.

## Google Play — official policy

- Developer Program Policy: https://support.google.com/googleplay/android-developer/answer/17190352
- Malware / monitoring applications: https://support.google.com/googleplay/android-developer/answer/9888380
- `isMonitoringTool` flag: https://support.google.com/googleplay/android-developer/answer/12955211
- User Data policy: https://support.google.com/googleplay/android-developer/answer/10144311
- Sensitive permissions/API access: https://support.google.com/googleplay/android-developer/answer/16558241

Key verified fact: parental monitoring applications must be transparent and satisfy monitoring-app/user-data requirements; hidden spyware positioning is not acceptable.

## Apple — official Apple Developer / Apple Support

- Family Controls: https://developer.apple.com/documentation/familycontrols
- Configure Family Controls: https://developer.apple.com/documentation/xcode/configuring-family-controls
- Request Family Controls entitlement: https://developer.apple.com/documentation/FamilyControls/requesting-the-family-controls-entitlement
- Managed Settings: https://developer.apple.com/documentation/ManagedSettings
- Screen Time technology frameworks: https://developer.apple.com/documentation/ScreenTimeAPIDocumentation
- UIDevice proximity monitoring: https://developer.apple.com/documentation/uikit/uidevice/isproximitymonitoringenabled
- Core ML: https://developer.apple.com/documentation/CoreML
- Apple Screen Distance user documentation: https://support.apple.com/105007

Key verified facts used by the architecture:
- Family Controls works with Managed Settings and Device Activity for parental controls.
- Distribution requires Family Controls entitlement approval for app/extensions.
- Parent/guardian authorization for a child can prevent the child from deleting the parental-control app.
- Apple's Screen Distance uses TrueDepth on supported devices; PCA does not assume a private API to control it.

## Google ML / on-device AI

- ML Kit face detection: https://developers.google.com/ml-kit/vision/face-detection
- Android face detection guide: https://developers.google.com/ml-kit/vision/face-detection/android
- LiteRT: https://ai.google.dev/edge/litert

Key verified fact: ML Kit face detection is on-device and detects faces/features rather than identifying people; it can support real-time use with performance constraints.

## YouTube — official Google Developers

- YouTube Data API reference: https://developers.google.com/youtube/v3/docs
- PlaylistItems list: https://developers.google.com/youtube/v3/docs/playlistItems/list
- Revision history: https://developers.google.com/youtube/v3/revision_history
- Search list / safeSearch: https://developers.google.com/youtube/v3/docs/search/list

Key verified fact: watch-history data cannot be retrieved through the YouTube Data API.

## OpenAI — official

- Models: https://developers.openai.com/api/docs/models

Current model guidance reviewed on 2026-08-10 identifies GPT-5.6 Sol as the flagship choice for complex reasoning/coding. This is a development-agent recommendation, not a dependency of the PCA runtime product.
