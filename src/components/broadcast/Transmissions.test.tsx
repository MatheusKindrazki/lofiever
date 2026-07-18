import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { signIn } from 'next-auth/react';
import { createElement } from 'react';
import { useChat, useSocket } from '@/lib/socket/client';
import { Transmissions } from './Transmissions';

jest.mock('next-auth/react', () => ({
  signIn: jest.fn(),
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

jest.mock('@/lib/socket/client', () => ({
  useChat: jest.fn(),
  useSocket: jest.fn(),
}));

const mockedUseChat = useChat as jest.MockedFunction<typeof useChat>;
const mockedUseSocket = useSocket as jest.MockedFunction<typeof useSocket>;
const mockedSignIn = signIn as jest.MockedFunction<typeof signIn>;

describe('Transmissions original music request', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseChat.mockReturnValue({
      messages: [],
      isLoadingAI: false,
      chatError: null,
      hasPendingMessage: false,
      addPendingMessage: jest.fn(),
      confirmPendingMessage: jest.fn(),
      retryMessage: jest.fn(),
      removeFailedMessage: jest.fn(),
    });
    mockedUseSocket.mockReturnValue({
      socket: null,
      isConnected: true,
      userId: 'guest_listener',
      username: 'Listener',
      token: 'signed-guest-token',
      requestSync: jest.fn(),
      sendChatMessage: jest.fn(),
      voteForTrack: jest.fn(),
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        authenticated: false,
        ageConfirmed: false,
        remainingToday: 1,
        globalRemainingToday: 20,
      }),
    }) as jest.Mock;
  });

  it('opens adult confirmation for a verified guest instead of redirecting to GitHub', async () => {
    render(createElement(Transmissions, { accent: '#c7ff6b' }));

    const originalButton = await screen.findByText('quickActions.original');
    fireEvent.click(originalButton);

    await waitFor(() => {
      expect(screen.getByText('originalMusic.adultNotice')).toBeInTheDocument();
    });
    expect(mockedSignIn).not.toHaveBeenCalled();
  });
});
