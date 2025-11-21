import { prisma, prismaHelpers } from '@/lib/prisma';
import type { Track, Playlist, PlaylistTrack, PlaybackHistory } from '@prisma/client';
import { redis, redisHelpers, KEYS } from '@/lib/redis';
import type { Track as RedisTrack } from '@/lib/redis';

// Define o tipo para o objeto de playlist que inclui as faixas e os detalhes da faixa
type FullPlaylist = Playlist & {
  tracks: (PlaylistTrack & {
    track: Track;
  })[];
};

// Functions for operations that involve both databases
export const DatabaseService = {
  // Synchronize a track between Redis and Postgres
  async syncTrack(track: RedisTrack | Track): Promise<void> {
    await redisHelpers.setCurrentTrack(track as RedisTrack);
    const existingTrack = await prismaHelpers.getTrackById(track.id);
    if (existingTrack) {
      await prisma.track.update({
        where: { id: track.id },
        data: { lastPlayed: new Date() },
      });
    }
  },
  
  // Get current track with fallback between Redis and Postgres
  async getCurrentTrack(): Promise<RedisTrack | null> {
    const redisTrack = await redisHelpers.getCurrentTrack();
    if (redisTrack) return redisTrack;
    
    const recentTrack = await prismaHelpers.getRecentTracks(1);
    if (recentTrack.length > 0) {
      const track = recentTrack[0] as unknown as RedisTrack;
      await redisHelpers.setCurrentTrack(track);
      return track;
    }
    
    return null;
  },
  
  // Get active playlist with caching
  async getActivePlaylist(): Promise<FullPlaylist | null> {
    const cachedPlaylist = await redis.get(KEYS.PLAYLIST_CACHE);
    if (cachedPlaylist) {
      const playlist = JSON.parse(cachedPlaylist) as FullPlaylist;
      if (playlist && playlist.tracks) {
        playlist.tracks.forEach(pt => {
          if (pt.track) {
            pt.track.createdAt = new Date(pt.track.createdAt);
            pt.track.updatedAt = new Date(pt.track.updatedAt);
            if (pt.track.lastPlayed) {
              pt.track.lastPlayed = new Date(pt.track.lastPlayed);
            }
          }
        });
      }
      return playlist;
    }
    
    const playlist = await prismaHelpers.getActivePlaylist();
    if (playlist) {
      await redis.set(KEYS.PLAYLIST_CACHE, JSON.stringify(playlist), 'EX', 300);
      return playlist;
    }
    
    return null;
  },
  
  // Create a new playlist and update Redis cache
  async createNewPlaylist(trackIds: string[]): Promise<FullPlaylist> {
    const versionStr = await redis.get(KEYS.PLAYLIST_VERSION);
    const version = versionStr ? parseInt(versionStr, 10) + 1 : 1;
    
    const playlist = await prismaHelpers.createPlaylist(version, trackIds);
    
    await redis.set(KEYS.PLAYLIST_VERSION, version.toString());
    await redis.set(KEYS.PLAYLIST_CACHE, JSON.stringify(playlist), 'EX', 300);
    
    return playlist;
  },
  
  async invalidatePlaylistCache(): Promise<void> {
    await redis.del(KEYS.PLAYLIST_CACHE);
  },

  // Record playback start in Postgres and update Redis
  async startPlayback(trackId: string): Promise<string> {
    const versionStr = await redis.get(KEYS.PLAYLIST_VERSION);
    const version = versionStr ? parseInt(versionStr, 10) : 1;
    const history = await prismaHelpers.recordPlayback(trackId, version);
    
    await redisHelpers.setPlaybackState({
      isPlaying: true,
      timestamp: Date.now(),
      position: 0,
      startedAt: Date.now()
    });
    
    return history.id;
  },
  
  // Complete playback record and update stats
  async endPlayback(historyId: string): Promise<void> {
    const listenerCount = await redisHelpers.getListenersCount();
    await prismaHelpers.completePlayback(historyId, listenerCount);
    
    await redisHelpers.setPlaybackState({
        isPlaying: false,
        timestamp: Date.now(),
        position: 0,
        startedAt: Date.now()
      });
  },
  
  // Metadata and stats methods
  async getStreamStats(): Promise<{
    currentListeners: number;
    totalTracksPlayed: number;
    uniqueTracks: number;
    daysActive: number;
    recentHistory: PlaybackHistory[];
  }> {
    const [
      totalPlayed,
      uniqueTracks,
      listenerCount,
      firstPlay,
      recentHistory,
    ] = await Promise.all([
      prisma.playbackHistory.count(),
      prisma.track.count(),
      redisHelpers.getListenersCount(),
      prisma.playbackHistory.findFirst({ orderBy: { startedAt: 'asc' } }),
      prisma.playbackHistory.findMany({ orderBy: { startedAt: 'desc' }, take: 100 }),
    ]);
    
    const daysActive = firstPlay 
      ? Math.ceil((Date.now() - firstPlay.startedAt.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    
    return {
      currentListeners: listenerCount,
      totalTracksPlayed: totalPlayed,
      uniqueTracks,
      daysActive,
      recentHistory,
    };
  },
} as const;