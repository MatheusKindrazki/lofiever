/* eslint-disable @typescript-eslint/no-explicit-any */
import { ModerationService } from '@/services/moderation/moderation.service';
import { PlaylistManagerService } from '@/services/playlist/playlist-manager.service';
import { YouTubeService } from '@/services/youtube';
import { prisma } from '@/lib/prisma';
import { TextDecoder, TextEncoder } from 'util';

const streamTextMock = jest.fn();

class MockResponse {
  public body: unknown;
  private init: ResponseInit;

  constructor(body: unknown, init?: ResponseInit) {
    this.body = body;
    this.init = init || {};
  }

  async text(): Promise<string> {
    if (typeof this.body === 'string') {
      return this.body;
    }

    const stream = this.body as ReadableStream<Uint8Array>;
    if (!stream?.getReader) {
      return '';
    }

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let result = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        result += decoder.decode(value, { stream: true });
      }
    }

    result += decoder.decode();
    return result;
  }

  get headers() {
    return this.init.headers || {};
  }
}

(global as any).Response = MockResponse;
(global as any).TextDecoder = TextDecoder;
(global as any).TextEncoder = TextEncoder;

jest.mock('ai', () => ({
  streamText: (...args: any[]) => streamTextMock(...args),
  tool: (config: any) => config,
}));

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => () => 'mock-model',
}));

jest.mock('@/services/moderation/moderation.service', () => ({
  ModerationService: {
    checkCooldown: jest.fn(),
    checkRateLimit: jest.fn(),
    checkDuplicate: jest.fn(),
    processTrackRequest: jest.fn(),
    incrementUserStats: jest.fn(),
    getUserStats: jest.fn(),
  },
}));

jest.mock('@/services/playlist/playlist-manager.service', () => ({
  PlaylistManagerService: {
    queueTrack: jest.fn(),
  },
}));

jest.mock('@/services/youtube', () => ({
  YouTubeService: {
    search: jest.fn(),
    getTrackInfo: jest.fn(),
  },
  normalizeYouTubeVideoId: jest.fn((videoId: string) => videoId),
  InvalidYouTubeVideoIdError: class InvalidYouTubeVideoIdError extends Error {},
  YouTubeAuthenticationError: class YouTubeAuthenticationError extends Error {},
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    track: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    trackRequest: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/redis', () => ({
  redisHelpers: {
    getCurrentTrack: jest.fn(),
    getActivePlaylist: jest.fn(),
    setUserName: jest.fn(),
  },
  redis: {
    publish: jest.fn(),
  },
}));

jest.mock('@/lib/api-utils', () => ({
  handleApiError: (error: unknown) => {
    throw error;
  },
}));

jest.mock('@/lib/config', () => ({
  config: {
    youtube: {
      enabled: true,
    },
  },
}));

import { POST } from '../process-message/route';

describe('POST /api/curation/process-message - YouTube fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (ModerationService.checkCooldown as jest.Mock).mockResolvedValue({ approved: true, reason: 'ok' });
    (ModerationService.checkRateLimit as jest.Mock).mockResolvedValue({ approved: true, reason: 'ok' });
    (ModerationService.checkDuplicate as jest.Mock).mockResolvedValue({ approved: true, reason: 'ok' });

    (prisma.track.findMany as jest.Mock).mockResolvedValue([]);
    (YouTubeService.search as jest.Mock).mockResolvedValue([
      {
        videoId: 'dQw4w9WgXcQ',
        title: 'Nujabes - Feather',
        artist: 'Nujabes',
        duration: 215,
        thumbnailUrl: 'https://example.com/thumb.jpg',
      },
    ]);
    (YouTubeService.getTrackInfo as jest.Mock).mockResolvedValue({
      videoId: 'dQw4w9WgXcQ',
      title: 'Nujabes - Feather',
      artist: 'Nujabes',
      duration: 215,
      thumbnailUrl: 'https://example.com/thumb.jpg',
    });

    (prisma.track.upsert as jest.Mock).mockResolvedValue({
      id: 'track-youtube-1',
      title: 'Nujabes - Feather',
      artist: 'Nujabes',
      sourceType: 'youtube',
      sourceId: 'dQw4w9WgXcQ',
      duration: 215,
    });

    streamTextMock.mockImplementation((options: any) => {
      const textStream = (async function* generate() {
        const output = await options.tools.request_track.execute({ query: 'Nujabes Feather' });
        yield output;
      })();

      return {
        textStream,
        toolResults: Promise.resolve([]),
      };
    });
  });

  it('should fallback to YouTube when local catalog has no match', async () => {
    const request = {
      json: async () => ({
        messages: [{ role: 'user', content: 'Toca Nujabes Feather' }],
        data: { userId: 'user-1', username: 'Matheus', isPrivate: false, locale: 'pt' },
      }),
    } as unknown as Request;

    const response = await POST(request);
    const text = await response.text();

    expect(text).toContain('Adicionei');
    expect(YouTubeService.search).toHaveBeenCalledWith('Nujabes Feather', 8);
    expect(PlaylistManagerService.queueTrack).toHaveBeenCalledWith('track-youtube-1', 'Matheus', false, 'user-1');
    expect(ModerationService.incrementUserStats).toHaveBeenCalledWith('user-1', true);
  });

  it('should return explicit auth message when YouTube blocks requests', async () => {
    const { YouTubeAuthenticationError } = jest.requireMock('@/services/youtube');
    (YouTubeService.search as jest.Mock).mockRejectedValue(
      new YouTubeAuthenticationError('auth required'),
    );

    const request = {
      json: async () => ({
        messages: [{ role: 'user', content: 'Toca nujabes' }],
        data: { userId: 'user-1', username: 'Matheus', isPrivate: true, locale: 'pt' },
      }),
    } as unknown as Request;

    const response = await POST(request);
    const text = await response.text();

    expect(text).toContain('autenticação/cookies');
    expect(PlaylistManagerService.queueTrack).not.toHaveBeenCalled();
  });
});
