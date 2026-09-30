import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
const buildServerSource = readFileSync(new URL('../../src/http/buildServer.ts', import.meta.url), 'utf8');

test('production Parent action, session-authorizer, and route paths use one shared registry-backed membership resolver', () => {
  assert.match(mainSource, /new MySqlChildProfileRegistryRepository\(\)/);
  assert.match(
    mainSource,
    /new RegistryBackedChildProfileMembershipResolver\(\{\s*registry:\s*childProfileRegistryRepository,\s*\}\)/,
  );
  assert.doesNotMatch(mainSource, /new UnavailableChildProfileMembershipResolver\(\)/);
  assert.equal((mainSource.match(/const childProfileRegistryRepository = new MySqlChildProfileRegistryRepository\(\);/g) ?? []).length, 1);
  assert.equal((mainSource.match(/const childProfileMembershipResolver = new RegistryBackedChildProfileMembershipResolver/g) ?? []).length, 1);

  const actionServiceStart = mainSource.indexOf('const safeZoneParentActionAuthorization = new ParentActionAuthorizationService(');
  const actionServiceEnd = mainSource.indexOf('\n  );', actionServiceStart);
  assert.ok(actionServiceStart >= 0 && actionServiceEnd > actionServiceStart);
  assert.match(mainSource.slice(actionServiceStart, actionServiceEnd), /childProfileMembershipResolver/);

  const serverCompositionStart = mainSource.indexOf('const app = buildServer({');
  const serverCompositionEnd = mainSource.indexOf('\n  });', serverCompositionStart);
  assert.ok(serverCompositionStart >= 0 && serverCompositionEnd > serverCompositionStart);
  assert.match(mainSource.slice(serverCompositionStart, serverCompositionEnd), /childProfileMembership:\s*childProfileMembershipResolver/);

  const sessionAuthorizerStart = mainSource.indexOf('const parentSessionChildRequestAuthorizer = createParentSessionChildRequestAuthorizer({');
  const sessionAuthorizerEnd = mainSource.indexOf('\n  });', sessionAuthorizerStart);
  assert.ok(sessionAuthorizerStart >= 0 && sessionAuthorizerEnd > sessionAuthorizerStart);
  const sessionAuthorizer = mainSource.slice(sessionAuthorizerStart, sessionAuthorizerEnd);
  assert.match(sessionAuthorizer, /childProfileMembershipResolver/);
  assert.doesNotMatch(sessionAuthorizer, /childProfileRegistryRepository/);

  const childRequestRoutesStart = buildServerSource.indexOf('registerChildRequestRoutes(app, {');
  const childRequestRoutesEnd = buildServerSource.indexOf('\n  });', childRequestRoutesStart);
  assert.ok(childRequestRoutesStart >= 0 && childRequestRoutesEnd > childRequestRoutesStart);
  const childRequestRoutesDeps = buildServerSource.slice(childRequestRoutesStart, childRequestRoutesEnd);
  assert.match(childRequestRoutesDeps, /childProfileMembership:\s*deps\.childProfileMembership/);
  assert.doesNotMatch(childRequestRoutesDeps, /childProfileRegistryRepository/);

  const routeSource = readFileSync(new URL('../../src/http/routes/childRequestRoutes.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(routeSource, /childProfileRegistryRepository/);
  assert.match(routeSource, /childProfileMembership\.resolveMembership\(familyId, childProfileId\)/);
});
