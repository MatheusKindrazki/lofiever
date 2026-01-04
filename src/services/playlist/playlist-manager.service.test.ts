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
  publish: jest.Mock;
};

// Dados de teste
const track1: Track = {
  id: 'track1',
  title: 'A',
  artist: 'X',
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

describe('PlaylistManagerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });
});
