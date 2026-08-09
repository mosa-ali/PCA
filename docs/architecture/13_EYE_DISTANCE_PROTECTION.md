# 13 — Eye-Distance / Proximity Protection

## 1. Goal

Encourage healthier viewing distance without pretending a normal phone proximity sensor is a medical-grade ruler.

## 2. Sensor hierarchy

1. OS/system screen-distance feature where available and parent-enabled.
2. Public proximity sensor as near/far signal.
3. Supported depth/TrueDepth or on-device face geometry only in contexts where public APIs and foreground/privacy rules permit.

## 3. Android approach

- Prefer hardware proximity sensor for low-power near/far detection.
- Optional ML Kit face landmarks in a visible, permissioned PCA foreground flow for calibration/verification.
- Camera frames are processed transiently and never saved.
- No facial identity recognition.

## 4. iOS approach

Apple offers a system Screen Distance feature on supported TrueDepth devices. PCA should guide parents to enable it where appropriate. PCA does not claim a private API to manage the system feature.

Public `UIDevice` proximity state may be used inside supported app execution contexts. TrueDepth distance analysis is limited to justified, permissioned foreground camera use.

## 5. Trigger policy

Parent-configurable, with conservative defaults. Example architecture rule:
- near condition persists for 5–10 seconds;
- first response is warning;
- repeated/persistent condition may trigger a one-minute PCA eye-rest experience where platform enforcement permits.

Exact numeric distance thresholds are labeled approximate unless a depth-capable sensor is used.

## 6. Privacy

Never retain:
- face frames;
- facial landmarks after the immediate calculation;
- face templates;
- biometric identity.

Store only event outcome such as `near`, `rest_triggered`, timestamp and sensor confidence bucket.
