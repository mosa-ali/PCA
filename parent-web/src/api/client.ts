// Factory that wires the typed API interfaces to their current
// implementation. Today only the DEVELOPMENT_ONLY fixture implementation
// exists; a future real-HTTP implementation set can be swapped in here
// (behind config.demoMode / config.apiBaseUrl) WITHOUT any UI changes,
// because every consumer imports only the interfaces from ./interfaces.
import { config } from '../config/env';
import type {
  DeviceStatusClient,
  FamilyAuthorityGateway,
  ParentFamilyDataGateway,
  RequestClient,
  ServiceAuthClient,
  WellbeingMessageAdminClient,
} from './interfaces';
import type { ParentRuntimeSyncClient } from './runtimeSyncClient';
import type { TrustedBrowserProvider } from '../domain/trustedBrowser';
import { DevServiceAuthClient } from './dev/devServiceAuthClient';
import { DevFamilyAuthorityGateway } from './dev/devFamilyAuthorityGateway';
import { DevParentFamilyDataGateway } from './dev/devParentFamilyDataGateway';
import { DevDeviceStatusClient } from './dev/devDeviceStatusClient';
import { DevRequestClient } from './dev/devRequestClient';
import { DevWellbeingMessageAdminClient } from './dev/devWellbeingMessageAdminClient';
import { DevTrustedBrowserProvider } from './dev/devTrustedBrowserProvider';
import { DevRuntimeSyncClient } from './dev/devRuntimeSyncClient';
import { RealServiceAuthClient } from './real/realServiceAuthClient';

export interface PcaApiClients {
  serviceAuth: ServiceAuthClient;
  familyAuthority: FamilyAuthorityGateway;
  parentFamilyData: ParentFamilyDataGateway;
  deviceStatus: DeviceStatusClient;
  requests: RequestClient;
  wellbeingMessages: WellbeingMessageAdminClient;
  trustedBrowser: TrustedBrowserProvider;
  runtimeSync: ParentRuntimeSyncClient;
  isFixtureBacked: boolean;
}

function buildDevClients(): PcaApiClients {
  return {
    serviceAuth: new DevServiceAuthClient(),
    familyAuthority: new DevFamilyAuthorityGateway(),
    parentFamilyData: new DevParentFamilyDataGateway(),
    deviceStatus: new DevDeviceStatusClient(),
    requests: new DevRequestClient(),
    wellbeingMessages: new DevWellbeingMessageAdminClient(),
    trustedBrowser: new DevTrustedBrowserProvider(),
    runtimeSync: new DevRuntimeSyncClient(),
    isFixtureBacked: true,
  };
}

function buildRealClients(): PcaApiClients {
  // The real, HTTP-backed ServiceAuthClient (./real/realServiceAuthClient.ts)
  // is genuine working code and safe to construct today against
  // config.apiBaseUrl -- it is wired in here first so this factory reflects
  // that it is no longer a stub.
  //
  // KNOWN_BACKEND_INTEGRATION_ACTION: every other interface in this bundle
  // (family authority gateway, family data gateway, device status, requests,
  // wellbeing messages, trusted-browser pairing, runtime sync) still needs a
  // real HTTP/relay-backed implementation once a backend exists (there is
  // currently no backend/ relay and no contracts/schedule-runtime in this
  // repository slice -- that is owned by the agent building the backend
  // relay). Once those land, construct them here the same way and return a
  // full PcaApiClients bundle with isFixtureBacked: false. Until then we
  // still cannot return a fully-real bundle, so we throw.
  const serviceAuth: ServiceAuthClient = new RealServiceAuthClient(config.apiBaseUrl);
  throw new Error(
    'Real (non-fixture) PCA API clients are not fully implemented yet -- ' +
      `serviceAuth is real (${serviceAuth.constructor.name}) but the other clients ` +
      `are pending backend integration at ${config.apiBaseUrl}. ` +
      'See KNOWN_BACKEND_INTEGRATION_ACTIONS in the parent-web build report.',
  );
}

let cached: PcaApiClients | null = null;

export function getApiClients(): PcaApiClients {
  if (cached) return cached;
  cached = config.demoMode ? buildDevClients() : safeBuildReal();
  return cached;
}

function safeBuildReal(): PcaApiClients {
  try {
    return buildRealClients();
  } catch {
    // No real backend exists yet in this repository slice; fall back to
    // fixtures so the app remains usable for UI review, but the demo
    // banner logic (src/components/common/DemoBanner.tsx) still keys off
    // `isFixtureBacked`, not off config.demoMode, so this fallback cannot
    // silently masquerade as production data.
    return buildDevClients();
  }
}
