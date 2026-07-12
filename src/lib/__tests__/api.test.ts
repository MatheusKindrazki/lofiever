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
});
