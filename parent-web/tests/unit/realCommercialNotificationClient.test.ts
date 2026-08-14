import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealCommercialNotificationClient } from '../../src/api/real/realCommercialNotificationClient';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealCommercialNotificationClient', () => {
  const apiBaseUrl = 'https://api.example.test';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function client() {
    return new RealCommercialNotificationClient(apiBaseUrl, async () => 'tok', async () => 'fam-1');
  }

  it('fails fast with SERVICE_SESSION_UNAVAILABLE when no bearer token is available', async () => {
    const c = new RealCommercialNotificationClient(apiBaseUrl, async () => null, async () => 'fam-1');
    await expect(c.list()).rejects.toMatchObject({ code: 'SERVICE_SESSION_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('list calls GET .../commercial-notifications with an optional limit query param, no cursor/offset', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        notifications: [
          {
            notificationId: 'n-1',
            eventType: 'QUOTE_READY',
            resourceRef: 'req-1',
            messageKey: 'notif.quoteReady',
            params: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            readAt: null,
            acknowledgedAt: null,
          },
        ],
      }),
    );
    const notifications = await client().list(10);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].eventType).toBe('QUOTE_READY');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/commercial-notifications?limit=10`);
  });

  it('unreadCount calls GET .../commercial-notifications/unread-count', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { unreadCount: 3 }));
    const count = await client().unreadCount();
    expect(count).toBe(3);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/commercial-notifications/unread-count`);
  });

  it('markRead POSTs to .../:notificationId/read and 404s honestly', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'read' }));
    await client().markRead('n-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/commercial-notifications/n-1/read`);
    expect(init.method).toBe('POST');

    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'not_found' }));
    await expect(client().markRead('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('acknowledge POSTs to .../:notificationId/acknowledge', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: 'acknowledged' }));
    await client().acknowledge('n-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${apiBaseUrl}/v1/families/fam-1/commercial-notifications/n-1/acknowledge`);
    expect(init.method).toBe('POST');
  });
});
