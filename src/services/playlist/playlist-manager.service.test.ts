// src/services/playlist/playlist-manager.service.test.ts
import { PlaylistManagerService } from './playlist-manager.service';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import type { Track } from '@prisma/client';

// Mock das dependências
jest.mock('@/lib/prisma', () => ({
  prisma: {
    track: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    trackRequest: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    playlistTrack: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    lpush: jest.fn(),
    rpush: jest.fn(),
    lpop: jest.fn(),
    llen: jest.fn(),
    lrange: jest.fn(),
    eval: jest.fn(),
    publish: jest.fn(),
  },
  redisHelpers: {
    getChatMessages: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('./ai-recommendation.service', () => ({
  recommendNextTrack: jest.fn(),
  determineMoodFromChat: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/services/youtube', () => ({
  YouTubeCacheService: {
    has: jest.fn().mockResolvedValue(false),
    ensureCached: jest.fn().mockResolvedValue('/data/youtube-cache/dQw4w9WgXcQ.opus'),
  },
}));

jest.mock('@/lib/config', () => ({
  config: {
    youtube: {
      enabled: true,
    },
  },
}));

const mockedConfig = jest.requireMock('@/lib/config').config as {
  youtube: { enabled: boolean };
};

// Mocks tipados
const mockedPrisma = prisma as unknown as {
  track: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
  };
  trackRequest: {
    findMany: jest.Mock;
    update: jest.Mock;
  };
  playlistTrack: {
    create: jest.Mock;
  };
};

const mockedRedis = redis as unknown as {
  lpush: jest.Mock;
  rpush: jest.Mock;
  lpop: jest.Mock;
  llen: jest.Mock;
  lrange: jest.Mock;
  eval: jest.Mock;
  publish: jest.Mock;
};

// Dados de teste
const track1: Track = {
  id: 'track1',
  title: 'A',
  artist: 'X',
  origin: 'catalog',
  sourceType: 'local',
  sourceId: 'a.mp3',
  artworkKey: null,
  duration: 180,
  bpm: 80,
  mood: 'chill',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastPlayed: null,
};

const track2: Track = {
  id: 'track2',
  title: 'B',
  artist: 'Y',
  origin: 'catalog',
  sourceType: 'local',
  sourceId: 'b.mp3',
  artworkKey: null,
  duration: 200,
  bpm: 90,
  mood: 'relaxed',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastPlayed: null,
};

const trackYouTube: Track = {
  id: 'track-youtube',
  title: 'YT Track',
  artist: 'YT Artist',
  origin: 'catalog',
  sourceType: 'youtube',
  sourceId: 'dQw4w9WgXcQ',
  artworkKey: null,
  duration: 180,
  bpm: null,
  mood: 'relaxed',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastPlayed: null,
};

describe('PlaylistManagerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.youtube.enabled = true;
  });

  describe('getNextTrack', () => {
    it('should return the next track from the queue', async () => {
      // Setup: Queue has tracks, no need to refill
      mockedRedis.llen.mockResolvedValue(5);
      mockedRedis.lpop.mockResolvedValue(JSON.stringify(track1));
      mockedRedis.lrange.mockResolvedValue([]);
      mockedPrisma.trackRequest.findMany.mockResolvedValue([]);

      const nextTrack = await PlaylistManagerService.getNextTrack();

      expect(mockedRedis.lpop).toHaveBeenCalledWith('lofiever:playlist:upcoming');
      // JSON.parse converts Date to string, so compare key properties
      expect(nextTrack.id).toBe(track1.id);
      expect(nextTrack.title).toBe(track1.title);
    });

    it('should refill queue when it drops below threshold', async () => {
      const { recommendNextTrack } = jest.requireMock('./ai-recommendation.service');
      recommendNextTrack.mockResolvedValue(track2);

      // First call for refillQueue check, second after refill
      mockedRedis.llen.mockResolvedValueOnce(2).mockResolvedValueOnce(5);
      mockedRedis.lrange.mockResolvedValue([]);
      mockedPrisma.trackRequest.findMany.mockResolvedValue([]);
      mockedRedis.lpop.mockResolvedValue(JSON.stringify(track1));

      const nextTrack = await PlaylistManagerService.getNextTrack();

      // Should have called rpush to add AI recommended tracks
      expect(mockedRedis.rpush).toHaveBeenCalled();
      expect(nextTrack.id).toBe(track1.id);
    });

    it('should return fallback track if queue is empty after refill', async () => {
      mockedRedis.llen.mockResolvedValue(5);
      mockedRedis.lpop.mockResolvedValue(null);
      mockedRedis.lrange.mockResolvedValue([]);
      mockedPrisma.trackRequest.findMany.mockResolvedValue([]);
      mockedPrisma.track.findMany.mockResolvedValue([{ id: 'track1' }]);
      mockedPrisma.track.findUnique.mockResolvedValue(track1);

      const fallbackTrack = await PlaylistManagerService.getNextTrack();

      expect(mockedPrisma.track.findMany).toHaveBeenCalled();
      expect(fallbackTrack).toEqual(track1);
    });

    it('getFallbackTrack should restrict to the playable whitelist when YouTube is disabled', async () => {
      mockedConfig.youtube.enabled = false;
      mockedRedis.llen.mockResolvedValue(5);
      mockedRedis.lpop.mockResolvedValue(null);
      mockedRedis.lrange.mockResolvedValue([]);
      mockedPrisma.trackRequest.findMany.mockResolvedValue([]);
      mockedPrisma.track.findMany.mockResolvedValue([{ id: 'track1' }]);
      mockedPrisma.track.findUnique.mockResolvedValue(track1);

      await PlaylistManagerService.getNextTrack();

      expect(mockedPrisma.track.findMany).toHaveBeenCalledWith({
        where: { sourceType: { in: ['r2', 's3', 'local'] } },
        select: { id: true },
      });
    });

    it('getFallbackTrack should include youtube in the whitelist when YouTube is enabled', async () => {
      mockedConfig.youtube.enabled = true;
      mockedRedis.llen.mockResolvedValue(5);
      mockedRedis.lpop.mockResolvedValue(null);
      mockedRedis.lrange.mockResolvedValue([]);
      mockedPrisma.trackRequest.findMany.mockResolvedValue([]);
      mockedPrisma.track.findMany.mockResolvedValue([{ id: 'track1' }]);
      mockedPrisma.track.findUnique.mockResolvedValue(track1);

      await PlaylistManagerService.getNextTrack();

      expect(mockedPrisma.track.findMany).toHaveBeenCalledWith({
        where: { sourceType: { in: ['r2', 's3', 'local', 'youtube'] } },
        select: { id: true },
      });
    });
  });

  describe('addTrackToPlaylist', () => {
    it('should add a track to the end of the queue', async () => {
      mockedPrisma.track.findUnique.mockResolvedValue(track2);

      await PlaylistManagerService.addTrackToPlaylist('track2', 'ai-curator');

      expect(mockedRedis.rpush).toHaveBeenCalledWith(
        'lofiever:playlist:upcoming',
        expect.stringContaining('track2')
      );
      expect(mockedRedis.publish).toHaveBeenCalledWith('lofi-ever:queue-update', 'updated');
    });

    it('should throw an error if track is not found', async () => {
      mockedPrisma.track.findUnique.mockResolvedValue(null);

      await expect(
        PlaylistManagerService.addTrackToPlaylist('invalid-track', 'ai-curator')
      ).rejects.toThrow('Track not found');
    });
  });

  describe('queueTrack', () => {
    it('should add track with priority to the front of the queue', async () => {
      mockedPrisma.track.findUnique.mockResolvedValue(track1);

      await PlaylistManagerService.queueTrack('track1', 'admin', true);

      expect(mockedRedis.lpush).toHaveBeenCalledWith(
        'lofiever:playlist:upcoming',
        expect.stringContaining('track1')
      );
    });

    it('should add track without priority to the end of the queue', async () => {
      mockedPrisma.track.findUnique.mockResolvedValue(track1);

      await PlaylistManagerService.queueTrack('track1', 'admin', false);

      expect(mockedRedis.rpush).toHaveBeenCalledWith(
        'lofiever:playlist:upcoming',
        expect.stringContaining('track1')
      );
    });

    it('should trigger YouTube prefetch for YouTube tracks', async () => {
      const { YouTubeCacheService } = jest.requireMock('@/services/youtube');
      mockedPrisma.track.findUnique.mockResolvedValue(trackYouTube);

      await PlaylistManagerService.queueTrack('track-youtube', 'admin', false);
      await Promise.resolve();
      await Promise.resolve();

      expect(YouTubeCacheService.has).toHaveBeenCalledWith('dQw4w9WgXcQ');
      expect(YouTubeCacheService.ensureCached).toHaveBeenCalledWith('dQw4w9WgXcQ');
    });
  });

  describe('queueTrackWithinNext', () => {
    it('places a direct request in the third upcoming position after the buffered audio', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      mockedPrisma.track.findUnique.mockResolvedValue({ ...track1, origin: 'generated_user' });
      mockedRedis.llen.mockResolvedValue(2);
      mockedRedis.lrange.mockResolvedValue([]);
      mockedRedis.eval.mockResolvedValue(0);

      const result = await PlaylistManagerService.queueTrackWithinNext(
        'track1',
        'Listener',
        'listener-1',
        3,
        5,
        'generation-1',
      );

      expect(result).toEqual({ targetPosition: 3, effectivePosition: 3 });
      expect(mockedRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('LINSERT'"),
        2,
        'lofiever:playlist:upcoming',
        'lofiever:playlist:priority:generation-1',
        expect.stringContaining('generatedRequest'),
        '0',
      );
      jest.restoreAllMocks();
    });

    it('does not create a run of three listener-generated tracks', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      mockedPrisma.track.findUnique.mockResolvedValue({ ...track1, origin: 'generated_user' });
      mockedRedis.llen.mockResolvedValue(2);
      mockedRedis.lrange
        .mockResolvedValueOnce([
          JSON.stringify({ id: 'generated-a', origin: 'generated_user' }),
          JSON.stringify({ id: 'generated-b', origin: 'generated_user' }),
        ])
        .mockResolvedValueOnce([
          JSON.stringify({ id: 'catalog-a', origin: 'catalog' }),
        ]);
      mockedRedis.eval.mockResolvedValue(1);

      const result = await PlaylistManagerService.queueTrackWithinNext(
        'track1',
        'Listener',
        'listener-1',
        3,
        5,
        'generation-2',
      );

      expect(result.effectivePosition).toBe(4);
      expect(mockedRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        'lofiever:playlist:upcoming',
        'lofiever:playlist:priority:generation-2',
        expect.any(String),
        '1',
      );
      jest.restoreAllMocks();
    });
  });
});
