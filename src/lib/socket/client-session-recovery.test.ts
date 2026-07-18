import { act, renderHook, waitFor } from '@testing-library/react';

const mockIo = jest.fn();

jest.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));

jest.mock('nanoid', () => ({
  customAlphabet: () => () => 'test-id',
}));

import { useSocket } from './client';

type Handler = (...args: unknown[]) => void;
interface FakeSocket {
  connected: boolean;
  id: string;
  auth: Record<string, unknown>;
  io: { on: jest.Mock };
  on: jest.Mock;
  off: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
  emit: jest.Mock;
}

describe('useSocket guest session recovery', () => {
  const handlers = new Map<string, Handler[]>();
  const managerHandlers = new Map<string, Handler[]>();

  const fakeSocket: FakeSocket = {
    connected: false,
    id: 'socket-test',
    auth: {},
    io: {
      on: jest.fn((event: string, handler: Handler) => {
        managerHandlers.set(event, [...(managerHandlers.get(event) || []), handler]);
      }),
    },
    on: jest.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) || []), handler]);
      return fakeSocket;
    }),
    off: jest.fn((event: string, handler?: Handler) => {
      if (!handler) {
        handlers.delete(event);
        return fakeSocket;
      }
      handlers.set(event, (handlers.get(event) || []).filter((candidate) => candidate !== handler));
      return fakeSocket;
    }),
    connect: jest.fn(),
    disconnect: jest.fn(),
    emit: jest.fn(),
  };

  beforeEach(() => {
    handlers.clear();
    managerHandlers.clear();
    jest.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem('lofiever:session', JSON.stringify({
      userId: 'guest_expired',
      username: 'Listener',
      token: 'expired-guest-token',
      isGuest: true,
    }));
    mockIo.mockReturnValue(fakeSocket);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'renewed-guest-token',
        user: {
          id: 'guest_renewed',
          name: 'Listener',
          isGuest: true,
        },
      }),
    }) as jest.Mock;
  });

  it('renews an expired guest token and reconnects automatically', async () => {
    renderHook(() => useSocket());
    renderHook(() => useSocket());

    await waitFor(() => expect(mockIo).toHaveBeenCalledTimes(1));

    await act(async () => {
      const connectErrorHandlers = handlers.get('connect_error') || [];
      for (const handler of connectErrorHandlers) {
        handler(new Error('Authentication error'));
        handler(new Error('Authentication error'));
      }
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/guest', expect.objectContaining({
        method: 'POST',
      }));
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockIo).toHaveBeenCalledTimes(2);
    });
    expect(mockIo).toHaveBeenLastCalledWith(expect.objectContaining({
      auth: expect.objectContaining({ token: 'renewed-guest-token' }),
    }));
  });
});
