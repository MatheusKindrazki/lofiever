// src/services/playlist/ai-recommendation.service.test.ts
import { processChatMessageAndAddTrack, recommendNextTrack } from './ai-recommendation.service';
import { PlaylistManagerService } from './playlist-manager.service';
import { prisma } from '@/lib/prisma';
import type { Track } from '@prisma/client';

// Mock das dependências
jest.mock('./playlist-manager.service', () => ({
  PlaylistManagerService: {
    addTrackToPlaylist: jest.fn(),
  },
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    track: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    playbackHistory: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('ai', () => ({
  generateText: jest.fn(),
}));

// Mocks tipados
const mockedPlaylistManagerService = PlaylistManagerService as jest.Mocked<typeof PlaylistManagerService>;
const mockedPrisma = prisma as unknown as {
  track: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  playbackHistory: {
    findMany: jest.Mock;
  };
};

const sampleTrack: Track = {
  id: 'track1',
  title: 'Sunset',
  artist: 'Lofi Vibes',
  sourceType: 'local',
  sourceId: 'sunset.mp3',
  artworkKey: null,
  duration: 190,
  bpm: 88,
  mood: 'relaxed',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastPlayed: null,
};

describe('AIRecommendationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processChatMessageAndAddTrack', () => {
    it('should find a track by keyword and add it to the playlist', async () => {
      const message = 'can you play the song sunset?';
      mockedPrisma.track.findFirst.mockResolvedValue(sampleTrack);

      const result = await processChatMessageAndAddTrack(message);

      expect(mockedPrisma.track.findFirst).toHaveBeenCalledWith({
        where: {
          title: {
            contains: 'can', // Simplificado para buscar pela primeira palavra
            mode: 'insensitive',
          },
        },
      });
      expect(mockedPlaylistManagerService.addTrackToPlaylist).toHaveBeenCalledWith('track1', 'ai-curator');
      expect(result).toEqual(sampleTrack);
    });

    it('should return null and not add a track if no keyword matches', async () => {
      const message = 'i love this radio!';
      mockedPrisma.track.findFirst.mockResolvedValue(null);

      const result = await processChatMessageAndAddTrack(message);

      expect(mockedPlaylistManagerService.addTrackToPlaylist).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should handle empty messages gracefully', async () => {
      const message = '';
      mockedPrisma.track.findFirst.mockResolvedValue(null);
      const result = await processChatMessageAndAddTrack(message);
      expect(mockedPlaylistManagerService.addTrackToPlaylist).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('recommendNextTrack', () => {
    it('should return a track with the specified mood', async () => {
      const mood = 'relaxed';
      mockedPrisma.playbackHistory.findMany.mockResolvedValue([]);
      mockedPrisma.track.count.mockResolvedValue(1);
      mockedPrisma.track.findMany.mockResolvedValue([sampleTrack]);

      const result = await recommendNextTrack(mood);

      expect(mockedPrisma.track.findMany).toHaveBeenCalled();
      expect(result).toEqual(sampleTrack);
    });

    it('should return a track even if no tracks match the mood', async () => {
      const mood = 'upbeat';
      mockedPrisma.playbackHistory.findMany.mockResolvedValue([]);
      mockedPrisma.track.count
        .mockResolvedValueOnce(0) // First count with mood filter
        .mockResolvedValueOnce(0) // Count without mood
        .mockResolvedValueOnce(1) // Total count
        .mockResolvedValueOnce(1); // Final available count
      mockedPrisma.track.findMany.mockResolvedValue([sampleTrack]);

      const result = await recommendNextTrack(mood);

      expect(result).toEqual(sampleTrack);
    });

    it('should use fallback if main query fails', async () => {
      mockedPrisma.playbackHistory.findMany.mockResolvedValue([]);
      mockedPrisma.track.count.mockResolvedValue(0);
      mockedPrisma.track.findMany.mockResolvedValue([]);
      mockedPrisma.track.findFirst.mockResolvedValue(sampleTrack);

      const result = await recommendNextTrack();

      expect(result).toEqual(sampleTrack);
    });
  });
});
