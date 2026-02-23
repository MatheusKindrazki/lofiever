import fs from 'fs/promises';
import path from 'path';
import { config } from '@/lib/config';
import { YouTubeService, normalizeYouTubeVideoId } from './youtube.service';

const downloadLocks = new Map<string, Promise<string>>();

export const YouTubeCacheService = {
  async has(videoId: string): Promise<boolean> {
    try {
      const normalizedVideoId = normalizeYouTubeVideoId(videoId);
      await fs.access(this.getPath(normalizedVideoId));
      return true;
    } catch {
      return false;
    }
  },

  getPath(videoId: string): string {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId);
    return path.join(config.youtube.cacheDir, `${normalizedVideoId}.opus`);
  },

  async ensureCached(videoId: string): Promise<string> {
    const normalizedVideoId = normalizeYouTubeVideoId(videoId);
    const filePath = this.getPath(normalizedVideoId);

    if (await this.has(normalizedVideoId)) {
      const now = new Date();
      await fs.utimes(filePath, now, now);
      return filePath;
    }

    // Check if download is already in progress
    const existing = downloadLocks.get(normalizedVideoId);
    if (existing) {
      return existing;
    }

    // Start download with lock
    const downloadPromise = (async () => {
      try {
        await fs.mkdir(config.youtube.cacheDir, { recursive: true });
        console.log(`[YouTubeCache] Downloading ${normalizedVideoId} to cache...`);
        await YouTubeService.downloadAudio(normalizedVideoId, filePath);
        console.log(`[YouTubeCache] Cached: ${normalizedVideoId}`);
        return filePath;
      } finally {
        downloadLocks.delete(normalizedVideoId);
      }
    })();

    downloadLocks.set(normalizedVideoId, downloadPromise);
    return downloadPromise;
  },

  async cleanup(maxAgeDays?: number): Promise<number> {
    const ttl = maxAgeDays ?? config.youtube.cacheTtlDays;
    const maxAge = ttl * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let removed = 0;

    try {
      const files = await fs.readdir(config.youtube.cacheDir);

      for (const file of files) {
        if (!file.endsWith('.opus')) continue;

        const filePath = path.join(config.youtube.cacheDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.atimeMs;

        if (age > maxAge) {
          await fs.unlink(filePath);
          removed++;
        }
      }
    } catch (error) {
      console.error('[YouTubeCache] Cleanup error:', error);
    }

    if (removed > 0) {
      console.log(`[YouTubeCache] Cleaned up ${removed} stale files`);
    }

    return removed;
  },

  async getStats(): Promise<{ totalFiles: number; totalSizeMB: number }> {
    try {
      const files = await fs.readdir(config.youtube.cacheDir);
      const opusFiles = files.filter((f: string) => f.endsWith('.opus'));

      let totalSize = 0;
      for (const file of opusFiles) {
        const stats = await fs.stat(
          path.join(config.youtube.cacheDir, file),
        );
        totalSize += stats.size;
      }

      return {
        totalFiles: opusFiles.length,
        totalSizeMB: Math.round((totalSize / 1024 / 1024) * 100) / 100,
      };
    } catch {
      return { totalFiles: 0, totalSizeMB: 0 };
    }
  },
};
