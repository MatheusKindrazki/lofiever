/* eslint-disable @typescript-eslint/no-explicit-any */
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { YouTubeCacheService } from '@/services/youtube';

// Mock NextResponse before importing the route
jest.mock('next/server', () => {
  class MockNextResponse {
    private body: string;
    private init: any;
    constructor(body: string, init?: any) {
      this.body = body;
      this.init = init || {};
    }
    async text() {
      return this.body;
    }
    get status() {
      return this.init.status || 200;
    }
    get headers() {
      return new Map(Object.entries(this.init.headers || {}));
    }
  }
  return { NextResponse: MockNextResponse };
});

jest.mock('@/services/playlist/playlist-manager.service');
jest.mock('@/services/youtube', () => ({
  YouTubeCacheService: {
    ensureCached: jest.fn(),
  },
  normalizeYouTubeVideoId: jest.fn((videoId: string) => videoId),
}));
jest.mock('@/lib/prisma', () => ({
  prisma: { playbackHistory: { create: jest.fn() } },
}));
jest.mock('@/lib/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue('1'),
    set: jest.fn().mockResolvedValue('OK'),
    rpush: jest.fn().mockResolvedValue(1),
  },
  redisHelpers: {},
}));
jest.mock('@/lib/r2', () => ({
  R2Lib: { getPresignedUrl: jest.fn() },
}));
jest.mock('@/lib/config', () => ({
  config: {
    youtube: { enabled: true },
    app: { internalUrl: 'http://app:3000' },
  },
}));

// Import route after all mocks are set up
import { GET } from '../route';

describe('GET /api/next-track (YouTube)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return YouTube serve URL for YouTube tracks', async () => {
    const mockTrack = {
      id: 'track-1',
      title: 'Lofi Beat',
      artist: 'Artist',
      sourceType: 'youtube',
      sourceId: 'dQw4w9WgXcQ',
      duration: 180,
      bpm: null,
      mood: 'relaxed',
      artworkKey: null,
    };

    (PlaylistManagerService.getNextTrack as jest.Mock).mockResolvedValue(mockTrack);
    (YouTubeCacheService.ensureCached as jest.Mock).mockResolvedValue('/data/youtube-cache/dQw4w9WgXcQ.opus');

    const request = {
      headers: new Map([
        ['x-forwarded-proto', 'http'],
        ['host', 'app:3000'],
      ]),
      nextUrl: { protocol: 'http:' },
    } as any;

    const response = await GET(request);
    const text = await response.text();

    expect(text).toContain('/api/youtube/serve/dQw4w9WgXcQ');
    expect(YouTubeCacheService.ensureCached).toHaveBeenCalledWith('dQw4w9WgXcQ');
  });
});
