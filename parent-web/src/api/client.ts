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
import type { TrustedBrowserProvider } from '../domain/trustedBrowser';
import { DevServiceAuthClient } from './dev/devServiceAuthClient';
import { DevFamilyAuthorityGateway } from './dev/devFamilyAuthorityGateway';
import { DevParentFamilyDataGateway } from './dev/devParentFamilyDataGateway';
import { DevDeviceStatusClient } from './dev/devDeviceStatusClient';
import { DevRequestClient } from './dev/devRequestClient';
import { DevWellbeingMessageAdminClient } from './dev/devWellbeingMessageAdminClient';
import { DevTrustedBrowserProvider } from './dev/devTrustedBrowserProvider';

export interface PcaApiClients {
  serviceAuth: ServiceAuthClient;
  familyAuthority: FamilyAuthorityGateway;
  parentFamilyData: ParentFamilyDataGateway;
  deviceStatus: DeviceStatusClient;
  requests: RequestClient;
  wellbeingMessages: WellbeingMessageAdminClient;
  trustedBrowser: TrustedBrowserProvider;
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
    isFixtureBacked: true,
  };
}

function buildRealClients(): PcaApiClients {
  // KNOWN_BACKEND_INTEGRATION_ACTION: implement real HTTP-backed classes
  // satisfying each interface in ./interfaces (using config.apiBaseUrl),
  // and swap this function in once the backend HTTP API exists. Until then
  // the app always uses fixtures regardless of demoMode being false in a
  // build that has no backend to talk to yet.
  throw new Error(
    'Real (non-fixture) PCA API clients are not implemented yet. ' +
      `Backend integration pending at ${config.apiBaseUrl}. ` +
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
