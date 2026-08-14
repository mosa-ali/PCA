// Test-only PlatformAdminAlertPort: records every notifyAppOwners call for
// assertion instead of logging or paging anyone.
export function createInMemoryPlatformAdminAlertPort() {
  const events = [];
  return {
    events,
    async notifyAppOwners(event) {
      events.push(event);
    },
  };
}
