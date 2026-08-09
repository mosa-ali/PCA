# 29 — Release, Deployment and Rollback

## 1. Environments

- Development
- Internal QA
- Family Beta
- Production

No production child activity is copied into lower environments.

## 2. Mobile release channels

- Android internal/testing/production tracks.
- Apple TestFlight/App Store tracks.
- Feature capability gates by platform/version.

## 3. Backend rollout

Enrollment/relay services are stateless/minimal where possible. Schema changes affecting enrollment metadata require backward-compatible migration and rollback plan.

## 4. Rule/model rollout

Filtering rules and AI models have independent signed versioning:
- staged rollout;
- health metrics;
- checksum validation;
- one-step rollback to last accepted package.

## 5. Emergency rollback

Critical safety/privacy defect response:
1. stop rollout;
2. disable affected optional feature through signed configuration where possible;
3. preserve emergency access;
4. publish fixed build/package;
5. document incident without collecting unnecessary child data.

## 6. Compatibility

Server/relay protocol supports at least one previous stable mobile protocol minor version during ordinary updates.
