import { prisma, prismaHelpers } from '@/lib/prisma';
import type { Track as PrismaTrack } from '@/lib/prisma';
import { redis, redisHelpers, KEYS } from '@/lib/redis';
import type { Track as RedisTrack } from '@/lib/redis';

// Define tipos para os retornos de playlist
interface PlaylistTrack {
  playlistId: string;
  trackId: string;
  position: number;
  addedBy?: string | null;
  addedAt: Date;
  track: PrismaTrack;
}

interface Playlist {
  id: string;
  version: number;
  createdAt: Date;
  active: boolean;
  tracks: PlaylistTrack[];
}

interface PlaybackHistoryRecord {
  id: string;
  trackId: string;
  startedAt: Date;
  endedAt?: Date | null;
  listenersPeak?: number | null;
  version: number;
}

// Functions for operations that involve both databases
export const DatabaseService = {
  // Synchronize a track between Redis and Postgres
  async syncTrack(track: RedisTrack | PrismaTrack): Promise<void> {
    // Update Redis cache
    await redisHelpers.setCurrentTrack(track as RedisTrack);
    
    // Check if track exists in Postgres
    const existingTrack = await prismaHelpers.getTrackById(track.id);
    
    // Update lastPlayed in Postgres if track exists
    if (existingTrack) {
      await prisma.track.update({
        where: { id: track.id },
        data: { lastPlayed: new Date() },
      });
    }
  },
  
  // Get current track with fallback between Redis and Postgres
  async getCurrentTrack(): Promise<RedisTrack | null> {
    // Try Redis first (faster)
    const redisTrack = await redisHelpers.getCurrentTrack();
    if (redisTrack) return redisTrack;
    
    // Fallback to Postgres if not in Redis
    const recentTrack = await prismaHelpers.getRecentTracks(1);
    if (recentTrack.length > 0) {
      const track = recentTrack[0] as unknown as RedisTrack;
      // Cache in Redis for future requests
      await redisHelpers.setCurrentTrack(track);
      return track;
    }
    
    return null;
  },
  
  // Get active playlist with caching
  async getActivePlaylist(): Promise<Playlist | null> {
    // Try Redis cache first
    const cachedPlaylist = await redis.get(KEYS.PLAYLIST_CACHE);
    if (cachedPlaylist) return JSON.parse(cachedPlaylist) as Playlist;
    
    // Get from Postgres if not cached
    const playlist = await prismaHelpers.getActivePlaylist();
    if (playlist) {
      // Cache the playlist for future requests (expire after 5 minutes)
      await redis.set(KEYS.PLAYLIST_CACHE, JSON.stringify(playlist), 'EX', 300);
      return playlist as Playlist;
    }
    
    return null;
  },
  
  // Create a new playlist and update Redis cache
  async createNewPlaylist(trackIds: string[]): Promise<Playlist> {
    // Get current version from Redis
    const versionStr = await redis.get(KEYS.PLAYLIST_VERSION);
    const version = versionStr ? Number.parseInt(versionStr, 10) + 1 : 1;
    
    // Create playlist in Postgres
    const playlist = await prismaHelpers.createPlaylist(version, trackIds);
    
    // Update Redis
    await redis.set(KEYS.PLAYLIST_VERSION, version.toString());
    await redis.set(KEYS.PLAYLIST_CACHE, JSON.stringify(playlist), 'EX', 300);
    
    return playlist as Playlist;
  },
  
  // Record playback start in Postgres and update Redis
  async startPlayback(trackId: string): Promise<string> {
    // Get version from Redis
    const versionStr = await redis.get(KEYS.PLAYLIST_VERSION);
    const version = versionStr ? Number.parseInt(versionStr, 10) : 1;
    
    // Record in Postgres
    const history = await prismaHelpers.recordPlayback(trackId, version);
    
    // Update Redis playback state
    await redisHelpers.setPlaybackState({
      isPlaying: true,
      timestamp: Date.now(),
    });
    
    return history.id;
  },
  
  // Complete playback record and update stats
  async endPlayback(historyId: string): Promise<void> {
    // Get current listener count
    const listenerCount = await redisHelpers.getListenersCount();
    
    // Update history record
    await prismaHelpers.completePlayback(historyId, listenerCount);
    
    // Update Redis playback state
    await redisHelpers.setPlaybackState({
      isPlaying: false,
      timestamp: Date.now(),
    });
  },
  
  // Metadata and stats methods
  async getStreamStats(): Promise<{
    currentListeners: number;
    totalTracksPlayed: number;
    uniqueTracks: number;
    daysActive: number;
    recentHistory: PlaybackHistoryRecord[];
  }> {
    // Get recent history from Postgres
    const recentHistory = await prisma.playbackHistory.findMany({
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    
    // Calculate stats
    const totalPlayed = await prisma.playbackHistory.count();
    const uniqueTracks = await prisma.track.count();
    const listenerCount = await redisHelpers.getListenersCount();
    
    // Calculate days active (assuming continuous operation since first track)
    const firstPlay = await prisma.playbackHistory.findFirst({
      orderBy: { startedAt: 'asc' },
    });
    
    const daysActive = firstPlay 
      ? Math.ceil((Date.now() - firstPlay.startedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    
    return {
      currentListeners: listenerCount,
      totalTracksPlayed: totalPlayed,
      uniqueTracks,
      daysActive,
      recentHistory: recentHistory as PlaybackHistoryRecord[],
    };
  },
} as const; 