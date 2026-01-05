import Redis from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { config } from './config';

// Define key prefixes and fully-qualified keys
export const REDIS_PREFIXES = {
  PLAYBACK: 'lofiever:playback:',
  PLAYLIST: 'lofiever:playlist:',
  USER: 'lofiever:user:',
  CHAT: 'lofiever:chat:',
  CACHE: 'lofiever:cache:',
  ANALYTICS: 'lofiever:analytics:',
} as const;

export const KEYS = {
  // Playback related keys
  CURRENT_TRACK: `${REDIS_PREFIXES.PLAYBACK}current_track`,
  PLAYBACK_STATE: `${REDIS_PREFIXES.PLAYBACK}state`,
  PLAYBACK_POSITION: `${REDIS_PREFIXES.PLAYBACK}position`,
  LISTENERS_COUNT: `${REDIS_PREFIXES.ANALYTICS}listeners_count`,
  LISTENERS_SET: `${REDIS_PREFIXES.ANALYTICS}listeners_zset`, // Changed to zset for timestamp-based tracking

  // Playlist related keys
  ACTIVE_PLAYLIST: `${REDIS_PREFIXES.PLAYLIST}active`,
  PLAYLIST_VERSION: `${REDIS_PREFIXES.PLAYLIST}version`,
  PLAYLIST_HISTORY: `${REDIS_PREFIXES.PLAYLIST}history`,
  PLAYLIST_UPCOMING: `${REDIS_PREFIXES.PLAYLIST}upcoming`,
  PLAYLIST_VOTE: `${REDIS_PREFIXES.PLAYLIST}vote`,

  // User related keys
  USER_SESSIONS: `${REDIS_PREFIXES.USER}sessions`,
  USER_PREFERENCES: `${REDIS_PREFIXES.USER}preferences`,

  // Chat related keys
  CHAT_MESSAGES: `${REDIS_PREFIXES.CHAT}messages`,
  CHAT_USERS_ACTIVE: `${REDIS_PREFIXES.CHAT}users_active`,

  // Cache related keys
  TRACK_CACHE: `${REDIS_PREFIXES.CACHE}tracks`,
  PLAYLIST_CACHE: `${REDIS_PREFIXES.CACHE}playlists`,
} as const;

// Type definitions for stored data
export interface Track {
  id: string;
  title: string;
  artist: string;
  sourceType: 'spotify' | 'youtube';
  sourceId: string;
  duration: number;
  bpm?: number;
  mood?: string;
  artworkUrl?: string;
  genre?: string;
  addedBy?: string;
  requestId?: string;
}

export interface PlaybackState {
  isPlaying: boolean;
  timestamp: number;
  position: number;
  startedAt: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  content: string;
  timestamp: number;
  type: 'user' | 'system' | 'ai';
  isPrivate?: boolean;
  targetUserId?: string;
  meta?: {
    title?: string;
    artist?: string;
    artworkUrl?: string;
  };
  locale?: 'pt' | 'en';
}

// Check if we're in build time (no Redis available)
const isBuildTime = process.env.NODE_ENV === 'production' && !process.env.REDIS_URL;

// Redis client singleton
class RedisManager {
  private static instance: RedisManager;
  private client: RedisClient | null = null;
  private subscriberClient: RedisClient | null = null;
  private isConnected = false;

  private constructor() {
    // Don't connect during build time
    if (isBuildTime) {
      console.log('Redis: Skipping connection during build time');
      return;
    }
  }

  private initializeClient(): RedisClient {
    if (this.client) return this.client;

    this.client = new Redis(config.redis.url, {
      maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error(`Redis connection failed after ${times} attempts`);
          return null; // Stop retrying
        }
        return Math.min(times * 50, 2000);
      },
      connectionName: 'lofiever:main',
      enableReadyCheck: true,
      enableOfflineQueue: true,
      lazyConnect: true,
    });

    this.setupEventHandlers();
    return this.client;
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('connect', () => {
      console.log('Redis client connected');
    });

    this.client.on('ready', () => {
      console.log('Redis client ready');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      console.error('Redis client error:', err);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      console.log('Redis client disconnected');
      this.isConnected = false;
    });

    this.client.on('reconnecting', (delay: number) => {
      console.log(`Redis client reconnecting in ${delay}ms`);
    });
  }

  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  public getClient(): RedisClient {
    if (isBuildTime) {
      // Return a mock client during build time that throws on actual use
      throw new Error('Redis is not available during build time');
    }
    return this.initializeClient();
  }

  public async getSubscriberClient(): Promise<RedisClient> {
    if (isBuildTime) {
      throw new Error('Redis is not available during build time');
    }

    if (!this.subscriberClient) {
      this.subscriberClient = new Redis(config.redis.url, {
        connectionName: 'lofiever:subscriber',
        maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
        lazyConnect: true,
      });

      this.subscriberClient.on('error', (err) => {
        console.error('Redis subscriber client error:', err);
      });
    }
    return this.subscriberClient;
  }

  public isReady(): boolean {
    return this.isConnected;
  }

  public async ping(): Promise<string | null> {
    if (isBuildTime || !this.client) {
      return null;
    }
    try {
      return await this.client.ping();
    } catch (error) {
      console.error('Redis ping failed:', error);
      return null;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
    if (this.subscriberClient) {
      await this.subscriberClient.quit();
    }
  }
}

// Export the Redis client instance
export const redisManager = RedisManager.getInstance();

// Lazy redis client - only connects when actually used
export const getRedis = (): RedisClient => redisManager.getClient();

// For backwards compatibility, use a getter that lazily initializes
// This will throw during build time if actually used
let _redis: RedisClient | null = null;
export const redis = new Proxy({} as RedisClient, {
  get(_, prop) {
    if (isBuildTime) {
      // During build, return no-op functions to prevent crashes
      if (typeof prop === 'string') {
        return () => Promise.resolve(null);
      }
      return undefined;
    }
    if (!_redis) {
      _redis = redisManager.getClient();
    }
    const value = (_redis as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(_redis);
    }
    return value;
  },
});

// Helper functions for common Redis operations
export const redisHelpers = {
  // Playback related helpers
  async getCurrentTrack(): Promise<Track | null> {
    const track = await redis.get(KEYS.CURRENT_TRACK);
    return track ? JSON.parse(track) : null;
  },

  async setCurrentTrack(track: Track): Promise<void> {
    await redis.set(KEYS.CURRENT_TRACK, JSON.stringify(track));
  },

  async getPlaybackState(): Promise<PlaybackState> {
    const state = await redis.get(KEYS.PLAYBACK_STATE);
    return state
      ? JSON.parse(state)
      : { isPlaying: false, timestamp: Date.now(), position: 0, startedAt: Date.now() };
  },

  async setPlaybackState(state: PlaybackState): Promise<void> {
    await redis.set(KEYS.PLAYBACK_STATE, JSON.stringify(state));
  },

  async addListener(socketId: string): Promise<number> {
    // Use ZSET with timestamp as score for automatic expiration tracking
    const timestamp = Date.now();
    await redis.zadd(KEYS.LISTENERS_SET, timestamp, socketId);
    return redis.zcard(KEYS.LISTENERS_SET);
  },

  async removeListener(socketId: string): Promise<number> {
    await redis.zrem(KEYS.LISTENERS_SET, socketId);
    return redis.zcard(KEYS.LISTENERS_SET);
  },

  async refreshListener(socketId: string): Promise<void> {
    // Update listener timestamp to keep connection alive
    const timestamp = Date.now();
    await redis.zadd(KEYS.LISTENERS_SET, timestamp, socketId);
  },

  async cleanupInactiveListeners(timeoutMs: number = 30000): Promise<number> {
    // Remove listeners that haven't sent heartbeat in the last timeoutMs milliseconds
    const cutoffTime = Date.now() - timeoutMs;
    const removed = await redis.zremrangebyscore(KEYS.LISTENERS_SET, '-inf', cutoffTime);
    return removed;
  },

  async getListenersCount(): Promise<number> {
    return redis.zcard(KEYS.LISTENERS_SET);
  },

  async getAllListeners(): Promise<string[]> {
    return redis.zrange(KEYS.LISTENERS_SET, 0, -1);
  },

  // Playlist related helpers
  async getActivePlaylist(): Promise<Track[]> {
    const playlist = await redis.get(KEYS.ACTIVE_PLAYLIST);
    return playlist ? JSON.parse(playlist) : [];
  },

  async setActivePlaylist(playlist: Track[]): Promise<void> {
    await redis.set(KEYS.ACTIVE_PLAYLIST, JSON.stringify(playlist));
  },

  async incrementPlaylistVersion(): Promise<number> {
    return redis.incr(KEYS.PLAYLIST_VERSION);
  },

  async getPlaylistVersion(): Promise<number> {
    const version = await redis.get(KEYS.PLAYLIST_VERSION);
    return version ? Number.parseInt(version, 10) : 0;
  },

  async addToPlaylistHistory(track: Track): Promise<void> {
    await redis.lpush(KEYS.PLAYLIST_HISTORY, JSON.stringify(track));
    // Trim history to last 100 tracks
    await redis.ltrim(KEYS.PLAYLIST_HISTORY, 0, 99);
  },

  async getPlaylistHistory(limit = 10): Promise<Track[]> {
    const tracks = await redis.lrange(KEYS.PLAYLIST_HISTORY, 0, limit - 1);
    return tracks.map(track => JSON.parse(track));
  },

  // Chat related helpers
  async addChatMessage(message: ChatMessage): Promise<void> {
    await redis.lpush(KEYS.CHAT_MESSAGES, JSON.stringify(message));
    // Trim chat history to last 100 messages
    await redis.ltrim(KEYS.CHAT_MESSAGES, 0, 99);
  },

  async getChatMessages(limit = 50): Promise<ChatMessage[]> {
    const messages = await redis.lrange(KEYS.CHAT_MESSAGES, 0, limit - 1);
    return messages.map(message => JSON.parse(message));
  },

  async clearChatHistory(): Promise<void> {
    await redis.del(KEYS.CHAT_MESSAGES);
    await redis.del(KEYS.CHAT_USERS_ACTIVE);
  },

  async markUserActive(userId: string): Promise<void> {
    await redis.sadd(KEYS.CHAT_USERS_ACTIVE, userId);
    // Set expiry to auto-remove inactive users after 5 minutes
    await redis.expire(KEYS.CHAT_USERS_ACTIVE, 300);
  },

  async getActiveUsers(): Promise<string[]> {
    return redis.smembers(KEYS.CHAT_USERS_ACTIVE);
  },

  async clearUserSessions(): Promise<void> {
    const pattern = `${KEYS.USER_SESSIONS}*`;
    const keys = await redis.keys(pattern);
    if (keys.length === 0) return;
    await redis.del(...keys);
  },

  async setUserName(userId: string, username: string): Promise<void> {
    const key = `${KEYS.USER_PREFERENCES}:${userId}`;
    console.log(`[Redis] Setting username for ${userId} (Key: ${key}) to ${username}`);
    await redis.hset(key, { username });
  },

  async getUserName(userId: string): Promise<string | null> {
    const key = `${KEYS.USER_PREFERENCES}:${userId}`;
    const username = await redis.hget(key, 'username');
    console.log(`[Redis] Getting username for ${userId} (Key: ${key}) -> ${username}`);

    // If username not in Redis, this will be handled by the caller
    // which should check the database as fallback
    return username;
  },

  /**
   * Get username with database fallback
   * First checks Redis, then falls back to Prisma database
   */
  async getUserNameWithFallback(userId: string, prismaClient: any): Promise<string | null> {
    // 1. Try Redis first (fastest)
    const key = `${KEYS.USER_PREFERENCES}:${userId}`;
    const cachedUsername = await redis.hget(key, 'username');

    if (cachedUsername) {
      console.log(`[Redis] Username found in cache for ${userId}: ${cachedUsername}`);
      return cachedUsername;
    }

    // 2. Fallback to database
    try {
      const user = await prismaClient.user.findUnique({
        where: { id: userId },
        select: { username: true }
      });

      if (user?.username) {
        console.log(`[Redis] Username found in DB for ${userId}: ${user.username}, caching...`);
        // Cache it in Redis for future lookups with TTL to keep cache fresh (24 hours)
        await redis.hset(key, { username: user.username });
        await redis.expire(key, 86400); // 24 hours TTL
        return user.username;
      }
    } catch (error) {
      console.error(`[Redis] Error fetching username from DB for ${userId}:`, error);
    }

    return null;
  },

  async setUserLocale(userId: string, locale: 'pt' | 'en'): Promise<void> {
    const key = `${KEYS.USER_PREFERENCES}:${userId}`;
    console.log(`[Redis] Setting locale for ${userId} (Key: ${key}) to ${locale}`);
    await redis.hset(key, { locale });
  },

  async getUserLocale(userId: string): Promise<'pt' | 'en' | null> {
    const key = `${KEYS.USER_PREFERENCES}:${userId}`;
    const locale = await redis.hget(key, 'locale');
    console.log(`[Redis] Getting locale for ${userId} (Key: ${key}) -> ${locale}`);
    return locale === 'pt' || locale === 'en' ? locale : null;
  },

  // Cache related helpers
  async cacheTrack(track: Track, ttlSeconds = 3600): Promise<void> {
    const key = `${KEYS.TRACK_CACHE}:${track.id}`;
    await redis.set(key, JSON.stringify(track));
    await redis.expire(key, ttlSeconds);
  },

  async getCachedTrack(trackId: string): Promise<Track | null> {
    const key = `${KEYS.TRACK_CACHE}:${trackId}`;
    const track = await redis.get(key);
    return track ? JSON.parse(track) : null;
  },

  async cacheObject<T>(key: string, data: T, ttlSeconds = 3600): Promise<void> {
    const cacheKey = `${REDIS_PREFIXES.CACHE}${key}`;
    await redis.set(cacheKey, JSON.stringify(data));
    await redis.expire(cacheKey, ttlSeconds);
  },

  async getCachedObject<T>(key: string): Promise<T | null> {
    const cacheKey = `${REDIS_PREFIXES.CACHE}${key}`;
    const data = await redis.get(cacheKey);
    return data ? JSON.parse(data) : null;
  },

  async invalidateCache(pattern: string): Promise<void> {
    const keys = await redis.keys(`${REDIS_PREFIXES.CACHE}${pattern}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  },
} as const;

// Export methods to test the Redis connection
export const redisTest = {
  async testConnection(): Promise<boolean> {
    try {
      const pong = await redisManager.ping();
      return pong === 'PONG';
    } catch (error) {
      console.error('Redis connection test failed:', error);
      return false;
    }
  },

  async testBasicOperations(): Promise<boolean> {
    try {
      const testKey = `${REDIS_PREFIXES.CACHE}test`;
      const testValue = { test: true, timestamp: Date.now() };

      // Set test value
      await redis.set(testKey, JSON.stringify(testValue));

      // Get test value
      const result = await redis.get(testKey);
      const parsed = result ? JSON.parse(result) : null;

      // Clean up
      await redis.del(testKey);

      return parsed?.test === true;
    } catch (error) {
      console.error('Redis basic operations test failed:', error);
      return false;
    }
  },
}; 
