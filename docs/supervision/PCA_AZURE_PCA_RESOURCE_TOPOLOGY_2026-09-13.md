# PCA Azure resource topology reconciliation

Read-only reconciliation performed 2026-09-13 against the authenticated Azure
context. No Azure resource, application code, container, secret, database, or
`pcaSafe` setting was changed.

```text
AZURE_SUBSCRIPTION_ID=5f5205e2-4e56-4cea-8ce7-3d408ed1507b
AZURE_TENANT_ID=9d94b9fa-8bd6-420a-9d28-bfe2df02562a
```

## App Service applications

| Name | Resource group | Resource ID | Location | State | App Service plan | Default hostname | System-assigned principal | VNet integration | Container mode |
|---|---|---|---|---|---|---|---|---|---|
| `pca` | `AppWenPlan` | `/subscriptions/5f5205e2-4e56-4cea-8ce7-3d408ed1507b/resourceGroups/AppWenPlan/providers/Microsoft.Web/sites/pca` | UAE North | Running | `NEWWEPPLAN` | `pca-bngqeqahgdfvf8ak.uaenorth-01.azurewebsites.net` | `adc7c8de-7a4c-4f9c-9342-4104125085ab` | `/subscriptions/5f5205e2-4e56-4cea-8ce7-3d408ed1507b/resourceGroups/AppWenPlan/providers/Microsoft.Network/virtualNetworks/vnet-uqtkeyex/subnets/subnet-vtfnysly` | `sitecontainers/main`, system-identity pull, port 4001 |
| `pcaSafe` | `pca-group` | `/subscriptions/5f5205e2-4e56-4cea-8ce7-3d408ed1507b/resourceGroups/pca-group/providers/Microsoft.Web/sites/pcaSafe` | UAE North | Running | `PcAPlan` | `pcasafe-ghfg4ggaucmecc9.uaenorth-01.azurewebsites.net` | None | None observed | `sitecontainers/main`, user-credentials pull, port 80 |

## Related resources

| Resource | Resource group | Resource ID |
|---|---|---|
| `pcaSafe` ACR | `pca-group` | `/subscriptions/5f5205e2-4e56-4cea-8ce7-3d408ed1507b/resourceGroups/pca-group/providers/Microsoft.ContainerRegistry/registries/pcaSafe` |
| `pca-key` Key Vault | `pca-group` | `/subscriptions/5f5205e2-4e56-4cea-8ce7-3d408ed1507b/resourceGroups/pca-group/providers/Microsoft.KeyVault/vaults/pca-key` |
| `pca-mysql` Flexible Server | `pca-group` | `/subscriptions/5f5205e2-4e56-4cea-8ce7-3d408ed1507b/resourceGroups/pca-group/providers/Microsoft.DBforMySQL/flexibleServers/pca-mysql` |
| `pca-mysql-pe` private endpoint | `AppWenPlan` | `/subscriptions/5f5205e2-4e56-4cea-8ce7-3d408ed1507b/resourceGroups/AppWenPlan/providers/Microsoft.Network/privateEndpoints/pca-mysql-pe` |
| `vnet-uqtkeyex` VNet | `AppWenPlan` | `/subscriptions/5f5205e2-4e56-4cea-8ce7-3d408ed1507b/resourceGroups/AppWenPlan/providers/Microsoft.Network/virtualNetworks/vnet-uqtkeyex` |
| `NEWWEPPLAN` App Service plan | `AppWenPlan` | `/subscriptions/5f5205e2-4e56-4cea-8ce7-3d408ed1507b/resourceGroups/AppWenPlan/providers/Microsoft.Web/serverfarms/NEWWEPPLAN` |

The private endpoint connection `pca-mysql-conn` is approved and targets the
`pca-mysql` resource above. The `pca` site is the only exactly named `pca` web
app found in the subscription. Its public API hostname returned 200 for
`/health`, `/health/db`, and `/health/email`, and its main container is the
approved backend digest:

```text
PCA_BACKEND_DIGEST=sha256:a3feb4a8bddec77432f446b8bb00a6e04da9e7bb2f679bc52513a7e43f608d87
PCA_HEALTH=/health 200; /health/db 200; /health/email 200
PCA_RESOURCE_GROUP_RECONCILIATION=LEGITIMATE_APPWENPLAN
DB_DIAGNOSTIC_PATH_B=PLATFORM_BLOCKED
```

`pcaSafe` remains the separate public site in `pca-group`; no duplicate or
stale exactly named `pca` application was found. Runtime DB proof and AUTH_B
remain unresolved; Parent C must not start.
