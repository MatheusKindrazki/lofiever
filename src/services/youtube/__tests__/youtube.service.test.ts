import {
  InvalidYouTubeVideoIdError,
  normalizeYouTubeVideoId,
  YouTubeAuthenticationError,
  YouTubeService,
} from '../youtube.service';
import { execFile } from 'child_process';

// Mock config before importing the module that uses it
jest.mock('@/lib/config', () => ({
  config: {
    youtube: {
      cookiesPath: '/data/youtube-cookies.txt',
      cacheDir: '/data/youtube-cache',
      cacheTtlDays: 7,
      audioFormat: 'opus',
      audioQuality: '0',
      enabled: true,
    },
  },
}));

// Mock child_process
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: (fn: unknown) => fn,
}));

const mockExecFile = execFile as unknown as jest.Mock;

describe('YouTubeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTrackInfo', () => {
    it('should parse yt-dlp JSON output correctly', async () => {
      const mockOutput = JSON.stringify({
        id: 'dQw4w9WgXcQ',
        title: 'Chill Lofi Beat',
        channel: 'LofiChannel',
        uploader: 'LofiChannel',
        duration: 180,
        thumbnail: 'https://example.com/thumb.jpg',
      });

      mockExecFile.mockResolvedValue({ stdout: mockOutput });

      const result = await YouTubeService.getTrackInfo('dQw4w9WgXcQ');

      expect(result).toEqual({
        videoId: 'dQw4w9WgXcQ',
        title: 'Chill Lofi Beat',
        artist: 'LofiChannel',
        duration: 180,
        thumbnailUrl: 'https://example.com/thumb.jpg',
      });
    });

    it('should prefer artist/track metadata fields from YouTube Music', async () => {
      const mockOutput = JSON.stringify({
        id: 'jNQXAC9IVRw',
        title: 'Artist - Track Name (Official)',
        channel: 'ArtistVEVO',
        uploader: 'ArtistVEVO',
        duration: 240,
        thumbnail: 'https://example.com/thumb.jpg',
        artist: 'Real Artist',
        track: 'Track Name',
      });

      mockExecFile.mockResolvedValue({ stdout: mockOutput });

      const result = await YouTubeService.getTrackInfo('jNQXAC9IVRw');

      expect(result.artist).toBe('Real Artist');
      expect(result.title).toBe('Track Name');
    });
  });

  describe('search', () => {
    it('should parse multiple JSON lines from search results', async () => {
      const mockOutput = [
        JSON.stringify({ id: 'dQw4w9WgXcQ', title: 'Track A', channel: 'Ch1', uploader: 'Ch1', duration: 120, thumbnail: '' }),
        JSON.stringify({ id: 'jNQXAC9IVRw', title: 'Track B', channel: 'Ch2', uploader: 'Ch2', duration: 180, thumbnail: '' }),
      ].join('\n');

      mockExecFile.mockResolvedValue({ stdout: mockOutput });

      const results = await YouTubeService.search('lofi', 2);

      expect(results).toHaveLength(2);
      expect(results[0].videoId).toBe('dQw4w9WgXcQ');
      expect(results[1].videoId).toBe('jNQXAC9IVRw');
    });

    it('should retry search without cookies when auth challenge happens', async () => {
      const signInError = new Error('sign in required') as Error & { stderr?: string };
      signInError.stderr = "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies";

      const mockOutput = JSON.stringify({
        id: 'dQw4w9WgXcQ',
        title: 'Track A',
        channel: 'Ch1',
        uploader: 'Ch1',
        duration: 120,
        thumbnail: '',
      });

      mockExecFile
        .mockRejectedValueOnce(signInError)
        .mockResolvedValueOnce({ stdout: mockOutput });

      const results = await YouTubeService.search('lofi', 1);

      expect(results).toHaveLength(1);
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockExecFile.mock.calls[1]?.[1]).not.toContain('--cookies');
    });

    it('should throw YouTubeAuthenticationError when auth challenge persists', async () => {
      const signInError = new Error('sign in required') as Error & { stderr?: string };
      signInError.stderr = "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies";

      mockExecFile
        .mockRejectedValueOnce(signInError)
        .mockRejectedValueOnce(signInError);

      await expect(YouTubeService.search('lofi', 1))
        .rejects
        .toBeInstanceOf(YouTubeAuthenticationError);
    });
  });

  describe('normalizeYouTubeVideoId', () => {
    it('should parse a regular YouTube URL', () => {
      const result = normalizeYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result).toBe('dQw4w9WgXcQ');
    });

    it('should parse a short youtu.be URL', () => {
      const result = normalizeYouTubeVideoId('https://youtu.be/jNQXAC9IVRw');
      expect(result).toBe('jNQXAC9IVRw');
    });

    it('should throw for invalid IDs', () => {
      expect(() => normalizeYouTubeVideoId('invalid-id')).toThrow(InvalidYouTubeVideoIdError);
    });
  });
});
