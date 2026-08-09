# 16 — Location and Last-Seen Architecture

## 1. Definitions

- **Current location:** latest location sample received from child device.
- **Location timestamp:** when the sample was measured.
- **Last seen:** latest authenticated PCA device connection/receipt timestamp.
- **Online:** recent authenticated connection, not merely push-token existence.

## 2. Data flow

Location is measured on the child device under platform permission, encrypted to authorized parent devices and retained according to family policy. PCA central infrastructure must not maintain readable location history.

## 3. Parent display

Show:
- map/location label;
- timestamp;
- accuracy indicator;
- live/cached/offline state;
- battery/network state only where APIs permit.

Never display stale data as current.

## 4. History options

- current/last only;
- 14 days;
- 1 month;
- 3/6/9 months only if general retention is at least as long.

Recommended privacy default: location retention shorter than general activity retention.

## 5. Geofences

Optional home/school safe zones use OS geofencing APIs where available. Alerts are family policy features, not a central advertising/analytics feed.

## 6. Permissions

The product must explain why background location is needed and must degrade visibly if permission is removed. No covert permission bypass.
