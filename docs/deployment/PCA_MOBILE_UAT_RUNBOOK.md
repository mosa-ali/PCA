# PCA Mobile UAT Runbook

This runbook covers the separate, manual device-acceptance workflow:
`.github/workflows/mobile-device-uat.yml`. It is not ordinary source
acceptance and does not make a physical-device or real-iPhone claim merely
because workflow source exists.

## GitHub Environment owner action

Create/configure the GitHub Environment `mobile-uat` for the `pca-dev` branch:

Repository → Settings → Environments → New environment → `mobile-uat`.

Restrict deployment branches to `pca-dev` and optionally require owner approval.
No Apple secrets are needed for the current unsigned simulator/emulator stage.
Do not add signing, TestFlight, App Store Connect, certificate, provisioning,
password, or private-key values in this phase. The current workflow does not
reference the environment, so a missing environment cannot be auto-created as
an unprotected substitute; configure it before any future credential-sensitive
job is introduced.

## Windows Android runner owner action

In Repository → Settings → Actions → Runners → New self-hosted runner →
Windows → x64, use the exact GitHub-generated commands and temporary token.

Recommended runner name: `PCA-Android-Device-01`

Required custom label: `pca-android-device`

Do not commit or paste the registration token. Do not install unrelated
packages or weaken Windows security settings. The runner should be dedicated
and trusted because self-hosted jobs execute on persistent infrastructure.

## Android phone owner action

On the dedicated phone, enable Developer options and USB debugging, connect the
USB cable, and approve the trusted computer prompt. Verify:

```text
<serial>    device
```

The physical job is selected only with `run_android_physical=true`. It fails
closed for zero devices, unauthorized/offline devices, or multiple devices;
it does not choose an arbitrary serial.

## Safe execution boundary

The workflow is `workflow_dispatch` only and has `contents: read`. Physical
execution is allowed only when the workflow ref is exactly `refs/heads/pca-dev`.
The default physical input is `false`, so an ordinary manual UAT run does not
wait for an offline personal runner.

The Android emulator and iOS simulator jobs use the real project, scheme,
Gradle tasks, and existing instrumentation tests. They use no Apple signing
credentials, do not upload an IPA, and do not distribute a build.

## Future iPhone phase

GitHub macOS is suitable for unsigned source/simulator testing. A real iPhone
requires a later owner-authorized signed build and distribution path, such as
TestFlight. Windows cannot provide Xcode or the iOS Simulator. That phase is
not implemented here.
