import { DatabaseService } from '@/services/database';
import { redis, redisHelpers } from '@/lib/redis';

jest.mock('next/server', () => {
  class MockNextResponse {
    private readonly body: unknown;
    readonly status: number;

    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }

    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }

    async json() {
      return this.body;
    }
  }

  return { NextResponse: MockNextResponse };
});

jest.mock('@/services/database', () => ({
  DatabaseService: {
    getStreamStats: jest.fn(),
  },
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    lrange: jest.fn(),
  },
  redisHelpers: {
    getCurrentTrack: jest.fn(),
    getPlaybackState: jest.fn(),
  },
}));

import { GET } from '../route';

const currentTrack = {
  id: 'track-1',
  title: 'Night Bus',
  artist: 'Cloud Break',
  sourceType: 's3',
  sourceId: 'music/night-bus.mp3',
  duration: 125,
};

describe('GET /api/stream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date(1_000_000));
    (redisHelpers.getCurrentTrack as jest.Mock).mockResolvedValue(currentTrack);
    (redisHelpers.getPlaybackState as jest.Mock).mockResolvedValue({
      isPlaying: true,
      position: 0,
      startedAt: 940_000,
      timestamp: 940_000,
    });
    (DatabaseService.getStreamStats as jest.Mock).mockResolvedValue({
      currentListeners: 4,
      daysActive: 10,
      totalTracksPlayed: 50,
    });
    (redis.lrange as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the current playback position in seconds for synchronized clients', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      currentSong: { id: 'track-1', duration: 125 },
      playback: {
        isPlaying: true,
        position: 60,
        startedAt: 940_000,
        serverTime: 1_000_000,
      },
    });
  });
});
