# 25 — Store, Privacy and Platform Compliance

## 1. Google Play monitoring-app posture

PCA must be clearly marketed as parental control, not spying. Current Google Play policy for monitoring applications requires transparent disclosure and includes requirements such as:
- no hidden/cloaked tracking behavior;
- persistent notification/unique icon when applicable;
- store listing disclosure;
- appropriate `isMonitoringTool` metadata (`child_monitoring`) for qualifying monitoring apps;
- prominent user-data disclosure/consent;
- compliance with sensitive-permission policies.

These requirements are release gates, not optional marketing choices.

## 2. Location

Background location is sensitive. PCA requests only what is necessary for the parent-facing location feature, documents the purpose and supports graceful degradation.

## 3. Apple Family Controls

Distribution requires Family Controls entitlement approval for the application and applicable Screen Time extensions. Managed Settings/Device Activity architecture must respect Apple's privacy-preserving model.

## 4. Child transparency

The child-facing app contains:
- protection-active status;
- clear explanation of monitored categories;
- privacy page;
- emergency controls;
- no deceptive system-like warnings.

## 5. Account deletion

If PCA creates accounts, account deletion/removal flows must satisfy applicable store rules. Family activity deletion is available independently from full account deletion.

## 6. Legal review

Before launch in any country, obtain legal/privacy review for child data, parental consent, geolocation and monitoring law. Architecture intentionally minimizes central child data but this does not remove legal obligations.

## 7. Store-submission evidence pack

- permission inventory and justifications;
- privacy-policy data-flow map;
- monitoring disclosure screenshots;
- Data Safety/App Privacy answers;
- Family Controls entitlement approval evidence;
- background location declaration if required;
- encryption/export compliance answers;
- child-safety and support contact material.
