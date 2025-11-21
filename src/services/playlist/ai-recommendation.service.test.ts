// src/services/playlist/ai-recommendation.service.test.ts
import { processChatMessageAndAddTrack, requestRecommendedTrack } from './ai-recommendation.service';
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
    },
  },
}));

// Mocks tipados
const mockedPlaylistManagerService = PlaylistManagerService as jest.Mocked<typeof PlaylistManagerService>;
const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

const sampleTrack: Track = {
  id: 'track1',
  title: 'Sunset',
  artist: 'Lofi Vibes',
  sourceType: 'local',
  sourceId: 'sunset.mp3',
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
        const result = await processChatMessageAndAddTrack(message);
        expect(mockedPrisma.track.findFirst).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });
  });

  describe('requestRecommendedTrack', () => {
    it("should return a random track with the specified mood", async () => {
        const mood = "relaxed";
        const relaxedTracks: Track[] = [sampleTrack, {...sampleTrack, id: 'track2'}];
        mockedPrisma.track.findMany.mockResolvedValue(relaxedTracks);

        const result = await requestRecommendedTrack(mood);

        expect(mockedPrisma.track.findMany).toHaveBeenCalledWith({
            where: {
                mood: {
                    equals: mood,
                    mode: 'insensitive'
                }
            }
        });
        expect(relaxedTracks).toContain(result);
    });

    it("should return a random track from all tracks if no track with the specified mood is found", async () => {
        const mood = "upbeat";
        const allTracks: Track[] = [sampleTrack, {...sampleTrack, id: 'track2'}];
        mockedPrisma.track.findMany
            .mockResolvedValueOnce([]) // Primeira chamada para o mood 'upbeat'
            .mockResolvedValueOnce(allTracks); // Segunda chamada (fallback)

        const result = await requestRecommendedTrack(mood);

        expect(mockedPrisma.track.findMany).toHaveBeenCalledTimes(2);
        expect(allTracks).toContain(result);
    });

    it("should return null if no tracks exist in the database", async () => {
        mockedPrisma.track.findMany.mockResolvedValue([]);
        const result = await requestRecommendedTrack();
        expect(result).toBeNull();
    });
  });
});
