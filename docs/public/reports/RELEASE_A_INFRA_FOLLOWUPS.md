# Release A — Infrastructure Follow-ups (recommendations only)

```
APEX_DOMAIN_REDIRECT  = NOT_CONFIGURED
ACR_IDENTITY_HARDENING = OWNER_AUTHORIZATION_REQUIRED
```

**Nothing in this document has been executed.** No DNS record was created or changed,
no registry authentication was altered, no Azure resource was modified. Both items are
recorded so they stay visible rather than being rediscovered after launch.

---

## A. Apex domain — `pcasafe.com` does not resolve

### What was measured

`pcasafe.com` has **no A, AAAA or CNAME record**. A lookup returns only SOA and NS,
on Squarespace nameservers (`nsd1`/`nsd2`/`nsd4.squarespacedns.com`). Every `www` and
subdomain record exists and works; the bare domain does not.

A visitor typing `pcasafe.com` — which is what people type, and what gets printed on
anything physical — reaches nothing at all. Not a redirect, not an error page: a DNS
failure, which browsers present as "site can't be reached". For a child-protection
service whose credibility is the product, that is a poor first contact.

### Recommended final behaviour

```
https://pcasafe.com/      → 301 → https://www.pcasafe.com/
https://pcasafe.com/<any> → 301 → https://www.pcasafe.com/<any>
http://pcasafe.com/       → 301 → https://pcasafe.com/ → https://www.pcasafe.com/
```

A permanent redirect, path-preserving, to the canonical `www` host. `www` is already
the canonical origin baked into every `<link rel="canonical">`, every `hreflang`
alternate and every `og:url` in the artifact, so redirecting apex→`www` agrees with
what the pages already declare. Redirecting the other way would contradict 14 pages of
canonical tags and is not recommended.

### What it needs, in order

1. **A DNS record for the apex.** CNAME is not valid at a zone apex, so this needs
   either an ALIAS/ANAME record (Squarespace DNS supports this for some targets) or
   A/AAAA records pointing at the App Service inbound IP. The A-record route pins an
   IP address that can change if the App Service is recreated, so an ALIAS is
   preferable where available.
2. **A domain-verification TXT record** (`asuid.` prefix) for the apex, which Azure
   requires before it will accept a new custom-domain binding.
3. **A binding on an App Service.** Simplest is to bind `pcasafe.com` alongside
   `www.pcasafe.com` on `pcaSafe` and issue the redirect in `deploy/nginx.conf` with a
   `server` block matching the apex `Host`. That keeps the redirect in the same
   reviewed, verifiable artifact as the security headers rather than in a separate
   piece of infrastructure.
4. **A certificate for the apex.** Measured: the current managed certificate is
   `CN=www.pcasafe.com` with a SAN covering `www.pcasafe.com` **only**. The apex needs
   its own certificate; without one, `https://pcasafe.com/` fails with a TLS name
   mismatch before any redirect can run — which is worse than not resolving, because
   it looks like an attack.

**Sequencing matters.** Add DNS and the certificate *before* the redirect, or the first
visitor to the newly-resolving apex gets a certificate warning.

### Not recommended

Do not add the apex record and leave it pointing at the app without a redirect. That
would serve the whole site on two hostnames with `www`-canonical tags on every page —
duplicate content with a self-contradicting canonical, which is worse for search than
the current clean failure.

---

## B. Container registry authentication

### What was measured

| | |
|---|---|
| Web App | `pcaSafe` pulls its image from ACR using **admin-user credentials** (`authType: UserCredentials`, a username is set) |
| Managed identity | **none assigned** — neither system- nor user-assigned |
| Registry | ACR `pcaSafe`, Basic SKU, `adminUserEnabled: true`, `publicNetworkAccess: Enabled`, anonymous pull disabled |
| Repository contents | **not verified** — the signed-in identity lacks the data-plane role, so the image inventory could not be listed. Recorded as unverified rather than assumed. |

No credential value was read, printed, logged or stored anywhere by this session, and
none appears in this repository.

### Why it is worth changing

The ACR admin account is a single long-lived username and password that grants **push
as well as pull** on the whole registry. It is stored in site configuration, shared by
anything configured to use it, identical across every consumer, and it does not
expire. Rotating it breaks every consumer at once, which in practice means it never
gets rotated. It also cannot be attributed: registry logs show the admin account, not
which service or person acted.

For a registry whose images will serve a child-protection site at
`www.pcasafe.com`, push access on a non-expiring shared secret is more authority than
the deployment needs.

### Recommended direction

1. Enable a **system-assigned managed identity** on `pcaSafe`.
2. Grant that identity the **`AcrPull`** role on the `pcaSafe` registry — pull only,
   scoped to that one registry.
3. Set `acrUseManagedIdentityCreds: true` on the site so image pulls use the identity.
4. Confirm a pull succeeds, **then** disable the ACR admin user.
5. Consider `publicNetworkAccess` once the pull path no longer depends on it.

Step 4's order matters: disabling the admin user before confirming the identity path
works would leave the app unable to pull its image on the next restart.

### Owner authorisation required

This changes authentication on the resource that serves the live public hostname. It
is a routing-sensitive infrastructure change, so it is not being made here.
`ACR_IDENTITY_HARDENING = OWNER_AUTHORIZATION_REQUIRED`.

---

## C. Related settings, already recorded

Not blockers, listed so the predeploy checklist is complete:

| Setting | Now | Should be | Why |
|---|---|---|---|
| `healthCheckPath` | `null` | `/healthz` | The Release A image already serves it; without a health path Azure cannot tell a wedged container from a healthy one |
| `alwaysOn` | `false` | `true` | The first visitor after ~20 minutes idle otherwise pays a cold start |
| `http20Enabled` | `false` | `true` | Free latency improvement for a multi-asset page |
| Image reference | tag | tag **and** recorded digest | A tag can be moved after review, which makes "which bytes are live?" unanswerable |
| `pca` plan | B1 shared with `ims-platform`, `ims-v1` | separate plan | PCA shares a Basic instance with an unrelated product |
