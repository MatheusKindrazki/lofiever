import { renderHook, waitFor } from '@testing-library/react';

const mockIo = jest.fn();

jest.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));

jest.mock('nanoid', () => ({
  customAlphabet: () => () => 'test-id',
}));

import { useSocket } from './client';

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

describe('useSocket initial guest session', () => {
  const fakeSocket: FakeSocket = {
    connected: false,
    id: 'socket-test',
    auth: {},
    io: { on: jest.fn() },
    on: jest.fn(() => fakeSocket),
    off: jest.fn(() => fakeSocket),
    connect: jest.fn(),
    disconnect: jest.fn(),
    emit: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockIo.mockReturnValue(fakeSocket);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'initial-guest-token',
        user: {
          id: 'guest_initial',
          name: 'Guest initial',
          isGuest: true,
        },
      }),
    }) as jest.Mock;
  });

  it('creates only one guest identity when several consumers mount together', async () => {
    renderHook(() => useSocket());
    renderHook(() => useSocket());

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/auth/guest', expect.objectContaining({
        method: 'POST',
      }));
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockIo).toHaveBeenCalledTimes(1);
    });
    expect(mockIo).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({ token: 'initial-guest-token' }),
    }));
  });
});
