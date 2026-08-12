// Factory that wires the typed API interfaces to their current
// implementation. Every consumer imports only the interfaces from
// ./interfaces (plus this factory), so swapping implementations never
// requires a UI change.
//
// Two families of implementation exist today:
//  - DEVELOPMENT_ONLY fixtures (src/api/dev/*) -- used ONLY when
//    config.demoMode is explicitly true.
//  - "Real" implementations (src/api/real/*) -- used whenever demo mode is
//    off. For ServiceAuthClient this is genuine HTTP-backed code
//    (RealServiceAuthClient). For every other interface, no real backend
//    exists yet in this repository slice (there is no backend/ relay and no
//    contracts/schedule-runtime here -- that is owned by the agent building
//    the backend relay), so an explicit "unavailable" provider
//    (src/api/real/unavailableProviders.ts) is used instead. Those
//    providers never fabricate fixture data and never grant permissions --
//    they surface a genuine UNAVAILABLE/NOT_IMPLEMENTED condition to the
//    UI. This is deliberately NOT the same thing as falling back to
//    fixtures: a real-but-not-yet-implemented backend must never
//    masquerade as a working demo.
//
// KNOWN_BACKEND_INTEGRATION_ACTION: as each interface in
// src/api/real/unavailableProviders.ts gets a genuine HTTP/relay-backed
// implementation, replace its construction below the same way
// RealServiceAuthClient already is, and delete the corresponding
// Unavailable* class once nothing constructs it anymore.
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
import {
  UnavailableDeviceStatusClient,
  UnavailableFamilyAuthorityGateway,
  UnavailableParentFamilyDataGateway,
  UnavailableRequestClient,
  UnavailableRuntimeSyncClient,
  UnavailableTrustedBrowserProvider,
  UnavailableWellbeingMessageAdminClient,
} from './real/unavailableProviders';

export interface PcaApiClients {
  serviceAuth: ServiceAuthClient;
  familyAuthority: FamilyAuthorityGateway;
  parentFamilyData: ParentFamilyDataGateway;
  deviceStatus: DeviceStatusClient;
  requests: RequestClient;
  wellbeingMessages: WellbeingMessageAdminClient;
  trustedBrowser: TrustedBrowserProvider;
  runtimeSync: ParentRuntimeSyncClient;
  /** True only when DEVELOPMENT_ONLY fixtures are actually in use (config.demoMode === true). Never true as a side effect of a real-client construction failure. */
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

/**
 * Builds the strongest actually-available real implementation for each
 * interface. serviceAuth is genuinely HTTP-backed and reachable today --
 * it is never discarded just because sibling interfaces aren't implemented
 * yet. Every not-yet-implemented interface gets an explicit "unavailable"
 * provider (see src/api/real/unavailableProviders.ts), never a fixture.
 * Deliberately has no try/catch: if constructing any of these ever throws
 * (a genuine programmer error, not an expected condition), that must
 * propagate to the caller rather than being swallowed -- see
 * getApiClients() below and src/components/common/AppErrorBoundary.tsx for
 * where that surfaces.
 */
function buildRealClients(): PcaApiClients {
  return {
    serviceAuth: new RealServiceAuthClient(config.apiBaseUrl),
    familyAuthority: new UnavailableFamilyAuthorityGateway(),
    parentFamilyData: new UnavailableParentFamilyDataGateway(),
    deviceStatus: new UnavailableDeviceStatusClient(),
    requests: new UnavailableRequestClient(),
    wellbeingMessages: new UnavailableWellbeingMessageAdminClient(),
    trustedBrowser: new UnavailableTrustedBrowserProvider(),
    runtimeSync: new UnavailableRuntimeSyncClient(),
    isFixtureBacked: false,
  };
}

let cached: PcaApiClients | null = null;

/**
 * Demo-mode fixtures are constructed ONLY when config.demoMode is
 * explicitly true. There is deliberately no catch-all here: a construction
 * failure while demo mode is off is a real defect and must be visible (see
 * AppErrorBoundary), never silently masked by a working-looking fixture
 * bundle. Callers that need resilience against a specific interface being
 * unavailable should handle that interface's typed error, not rely on this
 * factory to hide it.
 */
export function getApiClients(): PcaApiClients {
  if (cached) return cached;
  cached = config.demoMode ? buildDevClients() : buildRealClients();
  return cached;
}
