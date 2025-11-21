// src/services/playlist/liquidsoap-integration.service.test.ts
import { LiquidsoapIntegrationService } from './liquidsoap-integration.service';
import { PlaylistManagerService } from './playlist-manager.service';
import { redisHelpers } from '@/lib/redis';
import { config } from '@/lib/config';
import type { Track as PrismaTrack } from '@prisma/client';
import type { Track as RedisTrack } from '@/lib/redis';

// Mock das dependências
jest.mock('./playlist-manager.service', () => ({
  PlaylistManagerService: {
    getNextTrack: jest.fn(),
  },
}));

jest.mock('@/lib/redis', () => ({
  redisHelpers: {
    getCurrentTrack: jest.fn(),
    setCurrentTrack: jest.fn(),
  },
}));

jest.mock('@/lib/config', () => ({
    config: {
        liquidsoap: {
            musicDir: '/test/music',
            fallback: 'fallback.mp3'
        }
    }
}));


// Mocks tipados
const mockedPlaylistManager = PlaylistManagerService as jest.Mocked<typeof PlaylistManagerService>;
const mockedRedisHelpers = redisHelpers as jest.Mocked<typeof redisHelpers>;

const currentRedisTrack: RedisTrack = { id: 'track1', title: 'A', artist: 'X', sourceType: 'local', sourceId: 'a.mp3', duration: 180 };
const nextPrismaTrack: PrismaTrack = { id: 'track2', title: 'B', artist: 'Y', sourceType: 'local', sourceId: 'b.mp3', duration: 200, bpm: 90, mood: 'relaxed', createdAt: new Date(), updatedAt: new Date(), lastPlayed: null };

describe('LiquidsoapIntegrationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getNextTrackUri', () => {
    it('should get the next track and return a correctly formatted URI for local files', async () => {
      mockedRedisHelpers.getCurrentTrack.mockResolvedValue(currentRedisTrack);
      mockedPlaylistManager.getNextTrack.mockResolvedValue(nextPrismaTrack);

      const uri = await LiquidsoapIntegrationService.getNextTrackUri();

      expect(mockedRedisHelpers.getCurrentTrack).toHaveBeenCalled();
      expect(mockedPlaylistManager.getNextTrack).toHaveBeenCalledWith('track1');
      expect(mockedRedisHelpers.setCurrentTrack).toHaveBeenCalled();
      expect(uri).toBe('/test/music/b.mp3');
    });

    it('should return a direct URL for S3 sources', async () => {
        const s3Track: PrismaTrack = { ...nextPrismaTrack, sourceType: 's3', sourceId: 'https://my-bucket.s3.amazonaws.com/track.mp3' };
        mockedRedisHelpers.getCurrentTrack.mockResolvedValue(currentRedisTrack);
        mockedPlaylistManager.getNextTrack.mockResolvedValue(s3Track);
  
        const uri = await LiquidsoapIntegrationService.getNextTrackUri();
  
        expect(uri).toBe('https://my-bucket.s3.amazonaws.com/track.mp3');
    });

    it('should return a fallback URI if an error occurs', async () => {
      mockedRedisHelpers.getCurrentTrack.mockRejectedValue(new Error('Redis is down'));

      const uri = await LiquidsoapIntegrationService.getNextTrackUri();

      expect(uri).toBe('/test/music/fallback.mp3');
    });

    it('should correctly map the Prisma Track to a Redis Track when calling setCurrentTrack', async () => {
        mockedRedisHelpers.getCurrentTrack.mockResolvedValue(currentRedisTrack);
        mockedPlaylistManager.getNextTrack.mockResolvedValue(nextPrismaTrack);
  
        await LiquidsoapIntegrationService.getNextTrackUri();

        const expectedRedisTrack = {
            id: nextPrismaTrack.id,
            title: nextPrismaTrack.title,
            artist: nextPrismaTrack.artist,
            duration: nextPrismaTrack.duration,
            sourceId: nextPrismaTrack.sourceId,
            sourceType: nextPrismaTrack.sourceType as 'spotify' | 'youtube',
            mood: nextPrismaTrack.mood ?? undefined,
            bpm: nextPrismaTrack.bpm ?? undefined,
        };
  
        expect(mockedRedisHelpers.setCurrentTrack).toHaveBeenCalledWith(expectedRedisTrack);
    });
  });
});
