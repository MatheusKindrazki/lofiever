/* eslint-disable @typescript-eslint/no-explicit-any */
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { recommendNextTrack } from '@/services/playlist/ai-recommendation.service';
import { YouTubeCacheService } from '@/services/youtube';
import { R2Lib } from '@/lib/r2';
import { config } from '@/lib/config';
import { prisma } from '@/lib/prisma';

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
jest.mock('@/services/playlist/ai-recommendation.service', () => ({
  recommendNextTrack: jest.fn(),
}));
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

const mockedRecommendNextTrack = recommendNextTrack as jest.Mock;
const mockedConfig = config as unknown as { youtube: { enabled: boolean } };

// Import route after all mocks are set up
import { GET } from '../route';

const youtubeQueueTrack = {
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

const r2Track = {
  id: 'r2-track',
  title: 'R2 Lofi',
  artist: 'R2 Artist',
  sourceType: 's3',
  sourceId: 'tracks/r2-lofi.mp3',
  duration: 200,
  bpm: 85,
  mood: 'relaxed',
  artworkKey: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastPlayed: null,
};

const buildRequest = () =>
  ({
    headers: new Map([
      ['x-forwarded-proto', 'http'],
      ['host', 'app:3000'],
    ]),
    nextUrl: { protocol: 'http:' },
  }) as any;

describe('GET /api/next-track (YouTube)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.youtube.enabled = true;
  });

  it('should return YouTube serve URL for YouTube tracks', async () => {
    (PlaylistManagerService.getNextTrack as jest.Mock).mockResolvedValue(youtubeQueueTrack);
    (YouTubeCacheService.ensureCached as jest.Mock).mockResolvedValue('/data/youtube-cache/dQw4w9WgXcQ.opus');

    const response = await GET(buildRequest());
    const text = await response.text();

    expect(text).toContain('/api/youtube/serve/dQw4w9WgXcQ');
    expect(YouTubeCacheService.ensureCached).toHaveBeenCalledWith('dQw4w9WgXcQ');
  });

  it('should re-select an R2/S3/local track (not example.mp3) when YouTube resolve throws', async () => {
    (PlaylistManagerService.getNextTrack as jest.Mock).mockResolvedValue(youtubeQueueTrack);
    (YouTubeCacheService.ensureCached as jest.Mock).mockRejectedValue(new Error('yt-dlp bot challenge'));
    mockedRecommendNextTrack.mockResolvedValue(r2Track);
    (R2Lib.getPresignedUrl as jest.Mock).mockResolvedValue('https://r2.example/signed/r2-lofi.mp3');

    const response = await GET(buildRequest());
    const text = await response.text();

    expect(mockedRecommendNextTrack).toHaveBeenCalledTimes(1);
    expect(text).toBe('https://r2.example/signed/r2-lofi.mp3');
    expect(text).not.toContain('/music/example.mp3');
    // The served track (headers/buffer) must be the re-selected playable track.
    expect(response.headers.get('X-Track-Id')).toBe('r2-track');
  });

  it('should re-select an R2/S3/local track (not example.mp3) when YouTube is disabled', async () => {
    mockedConfig.youtube.enabled = false;
    (PlaylistManagerService.getNextTrack as jest.Mock).mockResolvedValue(youtubeQueueTrack);
    mockedRecommendNextTrack.mockResolvedValue(r2Track);
    (R2Lib.getPresignedUrl as jest.Mock).mockResolvedValue('https://r2.example/signed/r2-lofi.mp3');

    const response = await GET(buildRequest());
    const text = await response.text();

    // YouTube resolve must NOT be attempted when disabled.
    expect(YouTubeCacheService.ensureCached).not.toHaveBeenCalled();
    expect(mockedRecommendNextTrack).toHaveBeenCalledTimes(1);
    expect(text).toBe('https://r2.example/signed/r2-lofi.mp3');
    expect(text).not.toContain('/music/example.mp3');
  });

  it('should fall back to the last-resort placeholder only when re-selection yields nothing', async () => {
    mockedConfig.youtube.enabled = false;
    (PlaylistManagerService.getNextTrack as jest.Mock).mockResolvedValue(youtubeQueueTrack);
    // Re-selection finds no playable track (empty catalog edge case).
    mockedRecommendNextTrack.mockRejectedValue(new Error('no playable tracks'));

    const response = await GET(buildRequest());
    const text = await response.text();

    expect(mockedRecommendNextTrack).toHaveBeenCalledTimes(1);
    expect(text).toBe('/music/example.mp3');
  });

  it('should not re-select for a directly playable R2 track', async () => {
    (PlaylistManagerService.getNextTrack as jest.Mock).mockResolvedValue(r2Track);
    (R2Lib.getPresignedUrl as jest.Mock).mockResolvedValue('https://r2.example/signed/r2-lofi.mp3');

    const response = await GET(buildRequest());
    const text = await response.text();

    expect(mockedRecommendNextTrack).not.toHaveBeenCalled();
    expect(YouTubeCacheService.ensureCached).not.toHaveBeenCalled();
    expect(text).toBe('https://r2.example/signed/r2-lofi.mp3');
    expect(prisma.playbackHistory.create).not.toHaveBeenCalled();
  });
});
