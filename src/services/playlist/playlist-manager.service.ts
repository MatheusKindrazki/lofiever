import fs from 'node:fs';
import path from 'node:path';
import { requestRecommendedTrack } from './ai-recommendation.service';

const queue: string[] = [];
const musicDir = path.join(process.cwd(), 'public', 'music');

function getFallbackTrack(): string {
  const files = fs
    .readdirSync(musicDir)
    .filter(f => f.endsWith('.mp3') || f.endsWith('.ogg') || f.endsWith('.wav'));
  if (files.length === 0) {
    throw new Error('No fallback tracks available');
  }
  const file = files[Math.floor(Math.random() * files.length)];
  return path.join(musicDir, file);
}

export const PlaylistManagerService = {
  async getNextTrack(current?: string): Promise<string> {
    try {
      if (queue.length === 0) {
        const next = await requestRecommendedTrack(current);
        queue.push(next);
      }
    } catch (err) {
      console.error('Failed to get track from AI service:', err);
      return getFallbackTrack();
    }
    const track = queue.shift();
    return track ?? getFallbackTrack();
  },
};
