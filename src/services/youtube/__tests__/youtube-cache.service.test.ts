import { YouTubeCacheService } from '../youtube-cache.service';
import fs from 'fs/promises';

// Mock fs
jest.mock('fs/promises');

jest.mock('@/lib/config', () => ({
  config: {
    youtube: {
      cookiesPath: '',
      cacheDir: '/data/youtube-cache',
      cacheTtlDays: 7,
      audioFormat: 'opus',
      audioQuality: '0',
      enabled: true,
    },
  },
}));

jest.mock('../youtube.service', () => ({
  YouTubeService: {
    downloadAudio: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockFs = fs as jest.Mocked<typeof fs>;

describe('YouTubeCacheService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('has', () => {
    it('should return true when file exists', async () => {
      mockFs.access.mockResolvedValue(undefined);
      expect(await YouTubeCacheService.has('abc123')).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));
      expect(await YouTubeCacheService.has('abc123')).toBe(false);
    });
  });

  describe('getPath', () => {
    it('should sanitize video ID and return .opus path', () => {
      const result = YouTubeCacheService.getPath('abc-123_XY');
      expect(result).toContain('abc-123_XY.opus');
    });

    it('should strip invalid characters', () => {
      const result = YouTubeCacheService.getPath('abc/../evil');
      expect(result).toContain('abcevil.opus');
      expect(result).not.toContain('..');
    });
  });
});
