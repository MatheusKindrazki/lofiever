import Redis from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is not defined');
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  sourceType: 'spotify' | 'youtube';
  sourceId: string;
  duration: number;
  bpm?: number;
  mood?: string;
}

export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 3) {
      return null;
    }
    return Math.min(times * 50, 2000);
  },
});

export const KEYS = {
  // Playback related keys
  CURRENT_TRACK: 'lofiever:current_track',
  PLAYBACK_STATE: 'lofiever:playback_state',
  LISTENERS_COUNT: 'lofiever:listeners_count',
  
  // Playlist related keys
  ACTIVE_PLAYLIST: 'lofiever:active_playlist',
  PLAYLIST_VERSION: 'lofiever:playlist_version',
  
  // User related keys
  USER_SESSIONS: 'lofiever:user_sessions',
  CHAT_MESSAGES: 'lofiever:chat_messages',
  
  // Cache related keys
  TRACK_CACHE: 'lofiever:track_cache',
  PLAYLIST_CACHE: 'lofiever:playlist_cache',
} as const;

// Helper functions for common Redis operations
export const redisHelpers = {
  async getCurrentTrack(): Promise<Track | null> {
    const track = await redis.get(KEYS.CURRENT_TRACK);
    return track ? JSON.parse(track) : null;
  },
  
  async setCurrentTrack(track: Track): Promise<void> {
    await redis.set(KEYS.CURRENT_TRACK, JSON.stringify(track));
  },
  
  async getPlaybackState(): Promise<{ isPlaying: boolean; timestamp: number }> {
    const state = await redis.get(KEYS.PLAYBACK_STATE);
    return state ? JSON.parse(state) : { isPlaying: false, timestamp: Date.now() };
  },
  
  async setPlaybackState(state: { isPlaying: boolean; timestamp: number }): Promise<void> {
    await redis.set(KEYS.PLAYBACK_STATE, JSON.stringify(state));
  },
  
  async incrementListeners(): Promise<number> {
    return redis.incr(KEYS.LISTENERS_COUNT);
  },
  
  async decrementListeners(): Promise<number> {
    return redis.decr(KEYS.LISTENERS_COUNT);
  },
  
  async getListenersCount(): Promise<number> {
    const count = await redis.get(KEYS.LISTENERS_COUNT);
    return count ? Number.parseInt(count, 10) : 0;
  },
} as const; 