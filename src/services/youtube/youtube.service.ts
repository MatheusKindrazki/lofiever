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
  id: string;
  title: string;
  channel: string;
  uploader: string;
  duration: number;
  thumbnail: string;
  artist?: string;
  track?: string;
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
    throw new Error(`Invalid YouTube video ID: ${videoId}`);
  }
  return videoId;
}

function parseTrackInfo(data: YtDlpJsonOutput): YouTubeTrackInfo {
  const artist = data.artist || data.uploader || data.channel;
  const title = data.track || data.title;

  return {
    videoId: data.id,
    title,
    artist,
    duration: Math.round(data.duration),
    thumbnailUrl: data.thumbnail || `https://img.youtube.com/vi/${data.id}/maxresdefault.jpg`,
  };
}

export const YouTubeService = {
  async getTrackInfo(videoId: string): Promise<YouTubeTrackInfo> {
    validateVideoId(videoId);
    const args = [
      ...getBaseArgs(),
      '--dump-json',
      '--no-download',
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    const { stdout } = await execFileAsync('yt-dlp', args, {
      timeout: 30_000,
    });

    const data: YtDlpJsonOutput = JSON.parse(stdout);
    return parseTrackInfo(data);
  },

  async downloadAudio(videoId: string, outputPath: string): Promise<void> {
    validateVideoId(videoId);
    const args = [
      ...getBaseArgs(),
      '-x',
      '--audio-format', config.youtube.audioFormat,
      '--audio-quality', config.youtube.audioQuality,
      '-o', outputPath,
      '--no-playlist',
      '--no-part',
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    await execFileAsync('yt-dlp', args, {
      timeout: 120_000,
    });
  },

  async getDirectAudioUrl(videoId: string): Promise<string> {
    validateVideoId(videoId);
    const args = [
      ...getBaseArgs(),
      '-f', 'bestaudio',
      '--get-url',
      `https://www.youtube.com/watch?v=${videoId}`,
    ];

    const { stdout } = await execFileAsync('yt-dlp', args, {
      timeout: 30_000,
    });

    return stdout.trim();
  },

  async search(query: string, limit: number = 5): Promise<YouTubeTrackInfo[]> {
    const args = [
      ...getBaseArgs(),
      '--dump-json',
      '--no-download',
      '--flat-playlist',
      `ytsearch${limit}:${query}`,
    ];

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
  },
};
