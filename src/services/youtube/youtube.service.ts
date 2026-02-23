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

export class YouTubeAuthenticationError extends YouTubeCommandError {
  readonly stderr: string;

  constructor(action: string, stderr: string, cause?: unknown) {
    super(action, cause);
    this.name = 'YouTubeAuthenticationError';
    this.stderr = stderr;
  }
}

function getBaseArgs(includeCookies: boolean = true): string[] {
  const args: string[] = [];
  if (includeCookies && config.youtube.cookiesPath) {
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

function getCommandStderr(error: unknown): string {
  if (!error || typeof error !== 'object') return '';

  const maybe = error as { stderr?: unknown; message?: unknown };
  if (typeof maybe.stderr === 'string') return maybe.stderr;
  if (typeof maybe.message === 'string') return maybe.message;
  return '';
}

function isAuthenticationOrCookieChallenge(stderr: string): boolean {
  if (!stderr) return false;
  const lower = stderr.toLowerCase();

  return (
    lower.includes('sign in to confirm you’re not a bot')
    || lower.includes("sign in to confirm you're not a bot")
    || lower.includes('use --cookies-from-browser')
    || lower.includes('use --cookies for the authentication')
    || lower.includes('cookies file')
    || lower.includes('cookie')
  );
}

function wrapYouTubeError(action: string, cause: unknown): YouTubeCommandError {
  const stderr = getCommandStderr(cause);
  if (isAuthenticationOrCookieChallenge(stderr)) {
    return new YouTubeAuthenticationError(action, stderr, cause);
  }

  return new YouTubeCommandError(action, cause);
}

function shouldRetryWithoutCookies(cause: unknown): boolean {
  if (!config.youtube.cookiesPath) return false;
  return isAuthenticationOrCookieChallenge(getCommandStderr(cause));
}

async function executeYtDlpWithOptionalCookieRetry(
  action: string,
  buildArgs: (includeCookies: boolean) => string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('yt-dlp', buildArgs(true), { timeout });
  } catch (error) {
    if (!shouldRetryWithoutCookies(error)) {
      throw wrapYouTubeError(action, error);
    }

    try {
      console.warn(`[YouTube] Retry without cookies after failure while trying to ${action}`);
      return await execFileAsync('yt-dlp', buildArgs(false), { timeout });
    } catch (retryError) {
      if (isAuthenticationOrCookieChallenge(getCommandStderr(retryError))) {
        console.error('[YouTube] Authentication challenge persists after retry without cookies. Refresh the cookies file or disable YOUTUBE_COOKIES_PATH temporarily.');
      }
      throw wrapYouTubeError(action, retryError);
    }
  }
}

export const YouTubeService = {
  async getTrackInfo(videoId: string): Promise<YouTubeTrackInfo> {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId);
    const buildArgs = (includeCookies: boolean) => [
      ...getBaseArgs(includeCookies),
      '--dump-json',
      '--no-download',
      `https://www.youtube.com/watch?v=${normalizedVideoId}`,
    ];

    try {
      const { stdout } = await executeYtDlpWithOptionalCookieRetry(
        `fetch metadata for ${normalizedVideoId}`,
        buildArgs,
        30_000,
      );

      const data: YtDlpJsonOutput = JSON.parse(stdout);
      return parseTrackInfo(data);
    } catch (error) {
      if (error instanceof YouTubeCommandError) {
        throw error;
      }
      throw wrapYouTubeError(`fetch metadata for ${normalizedVideoId}`, error);
    }
  },

  async downloadAudio(videoId: string, outputPath: string): Promise<void> {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId);
    const buildArgs = (includeCookies: boolean) => [
      ...getBaseArgs(includeCookies),
      '-x',
      '--audio-format', config.youtube.audioFormat,
      '--audio-quality', config.youtube.audioQuality,
      '-o', outputPath,
      '--no-playlist',
      '--no-part',
      `https://www.youtube.com/watch?v=${normalizedVideoId}`,
    ];

    try {
      await executeYtDlpWithOptionalCookieRetry(
        `download audio for ${normalizedVideoId}`,
        buildArgs,
        120_000,
      );
    } catch (error) {
      if (error instanceof YouTubeCommandError) {
        throw error;
      }
      throw wrapYouTubeError(`download audio for ${normalizedVideoId}`, error);
    }
  },

  async getDirectAudioUrl(videoId: string): Promise<string> {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId);
    const buildArgs = (includeCookies: boolean) => [
      ...getBaseArgs(includeCookies),
      '-f', 'bestaudio',
      '--get-url',
      `https://www.youtube.com/watch?v=${normalizedVideoId}`,
    ];

    try {
      const { stdout } = await executeYtDlpWithOptionalCookieRetry(
        `resolve direct audio URL for ${normalizedVideoId}`,
        buildArgs,
        30_000,
      );

      return stdout.trim();
    } catch (error) {
      if (error instanceof YouTubeCommandError) {
        throw error;
      }
      throw wrapYouTubeError(`resolve direct audio URL for ${normalizedVideoId}`, error);
    }
  },

  async search(query: string, limit: number = 5): Promise<YouTubeTrackInfo[]> {
    const buildArgs = (includeCookies: boolean) => [
      ...getBaseArgs(includeCookies),
      '--dump-json',
      '--no-download',
      `ytsearch${limit}:${query}`,
    ];

    try {
      const { stdout } = await executeYtDlpWithOptionalCookieRetry(
        `search tracks for query "${query}"`,
        buildArgs,
        30_000,
      );

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
      if (error instanceof YouTubeCommandError) {
        throw error;
      }
      throw wrapYouTubeError(`search tracks for query "${query}"`, error);
    }
  },
};
