import { act, renderHook, waitFor } from '@testing-library/react';
import { useUserSession } from './useUserSession';

describe('useUserSession', () => {
  beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'signed-guest-token',
        user: {
          id: 'guest_listener',
          name: 'Listener',
          isGuest: true,
        },
      }),
    }) as jest.Mock;
  });

  it('synchronizes a new guest session across hook consumers', async () => {
    const first = renderHook(() => useUserSession());
    const second = renderHook(() => useUserSession());

    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
      expect(second.result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await first.result.current.loginAsGuest('Listener');
    });

    expect(second.result.current.session).toMatchObject({
      userId: 'guest_listener',
      token: 'signed-guest-token',
    });
  });
});
