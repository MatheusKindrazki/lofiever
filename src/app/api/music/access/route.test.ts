import type { NextRequest } from 'next/server';
import { validateRequest } from '@/lib/api-security';
import { getSessionOrGuestToken } from '@/lib/auth/tokens';
import { MusicGenerationService } from '@/services/music-generation/service';
import { GET, POST } from './route';

jest.mock('next/server', () => {
  class MockNextResponse {
    private readonly body: unknown;
    private readonly init: { status?: number };

    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.init = init || {};
    }

    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }

    get status() {
      return this.init.status ?? 200;
    }

    async json() {
      return this.body;
    }
  }

  return { NextResponse: MockNextResponse };
});

jest.mock('@/lib/api-security', () => ({
  RATE_LIMITS: { api: { windowMs: 60_000, maxRequests: 30 } },
  validateRequest: jest.fn(),
}));

jest.mock('@/lib/auth/tokens', () => ({
  getSessionOrGuestToken: jest.fn(),
}));

jest.mock('@/services/music-generation/service', () => ({
  MusicGenerationService: {
    confirmAdult: jest.fn(),
    getAccess: jest.fn(),
  },
}));

const mockedValidateRequest = validateRequest as jest.MockedFunction<typeof validateRequest>;
const mockedGetToken = getSessionOrGuestToken as jest.MockedFunction<typeof getSessionOrGuestToken>;
const mockedConfirmAdult = MusicGenerationService.confirmAdult as jest.MockedFunction<
  typeof MusicGenerationService.confirmAdult
>;
const mockedGetAccess = MusicGenerationService.getAccess as jest.MockedFunction<
  typeof MusicGenerationService.getAccess
>;

const access = {
  enabled: true,
  authenticated: true,
  ageConfirmed: false,
  remainingToday: 1,
  globalRemainingToday: 20,
};

describe('/api/music/access guest session', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedValidateRequest.mockResolvedValue(null);
    mockedGetToken.mockResolvedValue({
      sub: 'guest_listener',
      name: 'Listener',
      isGuest: true,
    });
    mockedGetAccess.mockResolvedValue(access);
    mockedConfirmAdult.mockResolvedValue();
  });

  it('returns access for a verified guest token', async () => {
    const request = {
      headers: new Map([['X-Guest-Token', 'signed-guest-token']]),
    } as unknown as NextRequest;

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockedGetToken).toHaveBeenCalledWith(request);
    expect(mockedGetAccess).toHaveBeenCalledWith('guest_listener');
    await expect(response.json()).resolves.toMatchObject({ authenticated: true });
  });

  it('stores adult confirmation for a verified guest token', async () => {
    const request = {
      headers: new Map([
        ['Content-Type', 'application/json'],
        ['X-Guest-Token', 'signed-guest-token'],
      ]),
      json: jest.fn().mockResolvedValue({ confirmed: true }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockedConfirmAdult).toHaveBeenCalledWith('guest_listener', 'Listener');
    expect(mockedGetAccess).toHaveBeenCalledWith('guest_listener');
  });
});
