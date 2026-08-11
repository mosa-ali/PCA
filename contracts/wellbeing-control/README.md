# Parent-controlled wellbeing message policy — logical contract

This directory defines the **logical**, representation-neutral contract catalogue for the parent-controlled wellbeing-message domain described in [architecture document 36](../../docs/architecture/36_PARENT_WELLBEING_MESSAGE_CONTROL.md). It is not an API specification, a wire format, an endpoint implementation, or a cryptographic implementation, and it follows the same conventions as the [family-envelope contract foundation](../README.md).

`catalogue.json` is a development-time metadata representation used only to validate the accepted logical contract: policy document shape, target modes, message categories/triggers, permitted vs. forbidden delivery surfaces, length and frequency bounds, the adult-supervision rule, the revision/idempotency model, the command model, and the forbidden coercive-pattern list.

This domain never introduces a central plaintext store. Custom parent message text remains family plaintext produced for the existing family envelope (doc 22 §3, doc 09 §4); the service/Relay control plane sees only opaque envelope metadata and ciphertext for this message class.

Run the self-contained validation suite with:

```powershell
node --test contracts/wellbeing-control/test/*.test.cjs
```

The checks reject a missing policy-document field, an unrecognised category or trigger, a permitted delivery surface that is actually a forbidden one (full-screen / lock-screen replacement / security-alert impersonation), an unbounded or zero-cooldown frequency configuration, an adult-supervision rule that fails to force `lockScreenAllowed=false`, and a service-visibility declaration that leaks message text, schedule, faith preference, or target meaning to the central plane.
