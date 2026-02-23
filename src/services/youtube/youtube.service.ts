import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '@/lib/config';

const execFileAsync = promisify(execFile);

export interface YouTubeTrackInfo {
  videoId: string;
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl: string;
}

interface YtDlpJsonOutput {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  artist?: string;
  track?: string;
}

export class InvalidYouTubeVideoIdError extends Error {
  constructor(videoId: string) {
    super(`Invalid YouTube video ID: ${videoId}`);
    this.name = 'InvalidYouTubeVideoIdError';
  }
}

export class YouTubeCommandError extends Error {
  constructor(action: string, cause?: unknown) {
    super(`Failed to ${action} on YouTube`);
    this.name = 'YouTubeCommandError';
    if (cause) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

function getBaseArgs(): string[] {
  const args: string[] = [];
  if (config.youtube.cookiesPath) {
    args.push('--cookies', config.youtube.cookiesPath);
  }
  args.push('--no-warnings', '--no-update');
  return args;
}

const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

function validateVideoId(videoId: string): string {
  if (!YOUTUBE_VIDEO_ID_REGEX.test(videoId)) {
    throw new InvalidYouTubeVideoIdError(videoId);
  }
  return videoId;
}

export function normalizeYouTubeVideoId(input: string): string {
  const candidate = input.trim();
  if (!candidate) {
    throw new InvalidYouTubeVideoIdError(input);
  }

  if (YOUTUBE_VIDEO_ID_REGEX.test(candidate)) {
    return candidate;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new InvalidYouTubeVideoIdError(input);
  }

  let maybeId = '';
  const host = parsed.hostname.toLowerCase();
  if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
    maybeId = parsed.pathname.replace(/^\/+/, '').split('/')[0] || '';
  } else if (host.includes('youtube.com')) {
    maybeId = parsed.searchParams.get('v') || '';

    if (!maybeId && parsed.pathname.startsWith('/shorts/')) {
      maybeId = parsed.pathname.split('/')[2] || '';
    }

    if (!maybeId && parsed.pathname.startsWith('/embed/')) {
      maybeId = parsed.pathname.split('/')[2] || '';
    }
  }

  return validateVideoId(maybeId);
}

function parseTrackInfo(data: YtDlpJsonOutput): YouTubeTrackInfo {
  const videoId = validateVideoId(data.id || '');
  const artist = (data.artist || data.uploader || data.channel || 'Unknown artist').trim();
  const title = (data.track || data.title || 'Unknown title').trim();
  const duration = Number.isFinite(data.duration) && (data.duration as number) > 0
    ? Math.round(data.duration as number)
    : 0;

  return {
    videoId,
    title,
    artist,
    duration,
    thumbnailUrl: data.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
  };
}

export const YouTubeService = {
  async getTrackInfo(videoId: string): Promise<YouTubeTrackInfo> {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId);
    const args = [
      ...getBaseArgs(),
      '--dump-json',
      '--no-download',
      `https://www.youtube.com/watch?v=${normalizedVideoId}`,
    ];

    try {
      const { stdout } = await execFileAsync('yt-dlp', args, {
        timeout: 30_000,
      });

      const data: YtDlpJsonOutput = JSON.parse(stdout);
      return parseTrackInfo(data);
    } catch (error) {
      throw new YouTubeCommandError(`fetch metadata for ${normalizedVideoId}`, error);
    }
  },

  async downloadAudio(videoId: string, outputPath: string): Promise<void> {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId);
    const args = [
      ...getBaseArgs(),
      '-x',
      '--audio-format', config.youtube.audioFormat,
      '--audio-quality', config.youtube.audioQuality,
      '-o', outputPath,
      '--no-playlist',
      '--no-part',
      `https://www.youtube.com/watch?v=${normalizedVideoId}`,
    ];

    try {
      await execFileAsync('yt-dlp', args, {
        timeout: 120_000,
      });
    } catch (error) {
      throw new YouTubeCommandError(`download audio for ${normalizedVideoId}`, error);
    }
  },

  async getDirectAudioUrl(videoId: string): Promise<string> {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId);
    const args = [
      ...getBaseArgs(),
      '-f', 'bestaudio',
      '--get-url',
      `https://www.youtube.com/watch?v=${normalizedVideoId}`,
    ];

    try {
      const { stdout } = await execFileAsync('yt-dlp', args, {
        timeout: 30_000,
      });

      return stdout.trim();
    } catch (error) {
      throw new YouTubeCommandError(`resolve direct audio URL for ${normalizedVideoId}`, error);
    }
  },

  async search(query: string, limit: number = 5): Promise<YouTubeTrackInfo[]> {
    const args = [
      ...getBaseArgs(),
      '--dump-json',
      '--no-download',
      `ytsearch${limit}:${query}`,
    ];

    try {
      const { stdout } = await execFileAsync('yt-dlp', args, {
        timeout: 30_000,
      });

      const results = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line: string) => {
          const data: YtDlpJsonOutput = JSON.parse(line);
          return parseTrackInfo(data);
        });

      return results;
    } catch (error) {
      throw new YouTubeCommandError(`search tracks for query "${query}"`, error);
    }
  },
};
