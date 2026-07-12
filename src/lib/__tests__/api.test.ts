import { addTrackToQueue } from '@/lib/api';

describe('addTrackToQueue', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  it('sends the persisted guest token when adding a catalog track', async () => {
    localStorage.setItem(
      'lofiever:session',
      JSON.stringify({
        userId: 'guest-nightowl',
        username: 'Guest nightowl',
        token: 'signed-guest-token',
        isGuest: true,
      }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ queued: { id: 'track-1' } }),
    } as Response);

    await addTrackToQueue('track-1');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/playlist/queue',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Guest-Token': 'signed-guest-token',
        }),
      }),
    );
  });

  it('renews an expired guest session and retries the queue request once', async () => {
    localStorage.setItem(
      'lofiever:session',
      JSON.stringify({
        userId: 'guest-old',
        username: 'Night Owl',
        token: 'expired-guest-token',
        isGuest: true,
      }),
    );
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Authentication required' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          token: 'renewed-guest-token',
          user: { id: 'guest-new', name: 'Night Owl', isGuest: true },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ queued: { id: 'track-1' } }),
      } as Response);

    await addTrackToQueue('track-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/guest',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'Night Owl' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/playlist/queue',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Guest-Token': 'renewed-guest-token',
        }),
      }),
    );
    expect(JSON.parse(localStorage.getItem('lofiever:session') ?? '{}')).toEqual({
      userId: 'guest-new',
      username: 'Night Owl',
      token: 'renewed-guest-token',
      isGuest: true,
    });
  });
});
